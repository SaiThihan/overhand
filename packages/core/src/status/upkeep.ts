/**
 * Upkeep a ready-made lead can take on, read from each project's active repos without installing or changing anything:
 * direct dependencies with updates (the repo's own package manager), often-changed source files no test names (git
 * log), and files with TODO notes (the check-up's count). Reads are kept in ops' .upkeep.json, updates for a week and
 * the rest for a day, so a lead watching them wakes at most that often (its brief changes only when a read does), and
 * a restart doesn't read them again. They run in the background: a slow package manager never holds the status.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { FileCount, Outdated } from "@overhand/contract";
import { z } from "zod";
import { activeRepos } from "../agent";
import { TODO_GREP, todoCounts } from "../checkup";
import { CLIENTS, OPS, shAsync } from "../env";
import { projectSh } from "../sandbox";
import type { Run } from "../ship";
import { readJson, writeJsonAtomic } from "../state";

const DAY = 864e5;
/** How long a repo's dependency updates are kept before they're read again: a week, so at most one PR a week. */
export const UPDATES_EVERY = 7 * DAY;
/** How long a repo's untested files and TODO notes are kept: a day. */
export const REPO_EVERY = DAY;
/** A package manager asks its registry: a minute at most. */
// the package manager reads the project's own hooks (.pnpmfile.cjs), the virtualenv's pip is the project's: under its sandbox
const slow =
  (project?: string): Run =>
  (cmd, cwd) =>
    projectSh(cmd, cwd ?? process.cwd(), 60_000, project);
const git: Run = (cmd, cwd) => shAsync(cmd, cwd, 15_000);

type Update = Omit<Outdated, "client" | "repo">;
type Count = Omit<FileCount, "client" | "repo">;

/** How far `to` is from `from`: major (the first number, or the second while it's 0.x), minor, patch; null when not newer. */
export function updateLevel(from: string, to: string): Outdated["update"] | null {
  const parts = (s: string) => (s.match(/\d+(?:\.\d+){0,2}/)?.[0] ?? "").split(".").map(Number);
  const [a, b] = [parts(from), parts(to)];
  for (const i of [0, 1, 2]) {
    const [x, y] = [a[i] ?? 0, b[i] ?? 0];
    if (y < x) return null;
    if (y > x) return i === 0 || (i === 1 && !a[0]) ? "major" : i === 1 ? "minor" : "patch";
  }
  return null;
}

/** The update a package can take: to its latest when that's a patch or minor, else to the newest its range allows; a major only listed. */
function pick(manager: string, pkg: string, current: string, wanted: string, latest: string): Update | null {
  if (!pkg || !current || !latest) return null;
  const toLatest = updateLevel(current, latest);
  if (toLatest && toLatest !== "major") return { manager, package: pkg, current, next: latest, update: toLatest };
  const toWanted = wanted ? updateLevel(current, wanted) : null;
  if (toWanted && toWanted !== "major") return { manager, package: pkg, current, next: wanted, update: toWanted };
  return toLatest ? { manager, package: pkg, current, next: latest, update: "major" } : null;
}

/** `bun outdated`'s table (Package, Current, Update, Latest), which has no JSON form. */
export function bunTable(out: string): Update[] {
  const rows = out
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|[-|\s]+\|$/.test(l))
    .map((l) =>
      l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );
  const [head = [], ...body] = rows;
  const [p, c, u, l] = ["package", "current", "update", "latest"].map((h) => head.findIndex((x) => x.toLowerCase() === h));
  const at = (r: string[], i = -1) => r[i] ?? "";
  return body.flatMap((r) => pick("bun", at(r, p).replace(/\s*\(.*\)$/, ""), at(r, c), at(r, u), at(r, l)) ?? []);
}

const NpmOut = z.record(
  z.string(),
  z.object({ current: z.string().optional(), wanted: z.string().optional(), latest: z.string().optional() }),
);
const PipOut = z.array(z.object({ name: z.string(), version: z.string(), latest_version: z.string() }));
const json = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** `npm outdated --json` or `pnpm outdated --format json`: direct dependencies by name; one not installed has no current. */
export function npmJson(manager: string, out: string): Update[] {
  const r = NpmOut.safeParse(json(out));
  if (!r.success) return [];
  return Object.entries(r.data).flatMap(([pkg, v]) => pick(manager, pkg, v.current ?? "", v.wanted ?? "", v.latest ?? "") ?? []);
}

const norm = (s: string) => s.toLowerCase().replace(/[_.]+/g, "-");
/** `pip list --outdated --format json`, kept to the packages the repo names itself (`direct`): the rest came with them. */
export function pipJson(out: string, direct: ReadonlySet<string>): Update[] {
  const r = PipOut.safeParse(json(out));
  if (!r.success) return [];
  return r.data.filter((p) => direct.has(norm(p.name))).flatMap((p) => pick("pip", p.name, p.version, "", p.latest_version) ?? []);
}

/** Every word in a Python repo's own dependency files, so a package it names is a direct one. */
function pythonNames(repo: string): Set<string> {
  // ponytail: a word match, not a parser; a package named only in a comment counts too
  const files = readdirSync(repo).filter((f) => /^(?:requirements.*\.txt|pyproject\.toml|setup\.cfg|Pipfile)$/.test(f));
  return new Set(files.flatMap((f) => norm(readFileSync(join(repo, f), "utf8")).split(/[^a-z0-9-]+/)));
}

/** The command that lists a JavaScript repo's outdated direct dependencies, by its lockfile; none without one. */
const JS_OUTDATED: [string, string, string[]][] = [
  ["bun.lock", "bun", ["bun", "outdated"]],
  ["bun.lockb", "bun", ["bun", "outdated"]],
  ["pnpm-lock.yaml", "pnpm", ["pnpm", "outdated", "--format", "json"]],
  ["package-lock.json", "npm", ["npm", "outdated", "--json"]],
];

/**
 * A repo's direct dependencies with updates, from its own package manager: bun, pnpm or npm by its lockfile, and pip
 * where it has a virtualenv (.venv or venv). Nothing is installed; `npm outdated` exits 1 when it finds some, so the
 * output is read whatever the exit. Cargo and Go aren't read (both need their own tools or downloads to say).
 */
export async function repoUpdates(repo: string, run: Run = slow()): Promise<Update[]> {
  const files = new Set(readdirSync(repo));
  const out: Update[] = [];
  const js = JS_OUTDATED.find(([lock]) => files.has(lock));
  if (js) {
    const [, manager, cmd] = js;
    const r = await run(cmd, repo);
    out.push(...(manager === "bun" ? bunTable(r.out) : npmJson(manager, r.out)));
  }
  const pip = [".venv", "venv"].map((d) => join(repo, d, "bin", "pip")).find((p) => existsSync(p));
  if (pip) out.push(...pipJson((await run([pip, "list", "--outdated", "--format", "json"], repo)).out, pythonNames(repo)));
  return out;
}

const SOURCE = /\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|swift|php|cs|vue|svelte)$/;
const TEST = /(?:^|\/)(?:__tests__|tests?|spec)\/|[._-](?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.py$/;
const NOT_SOURCE = /(?:^|\/)(?:node_modules|vendor|dist|build|generated|migrations)\/|\.d\.ts$|\.config\.[^/]+$/;
/** Where a repo's tests are, as git pathspecs: the same places `TEST` names. */
const TEST_PATHS = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/*_test.*",
  "**/test_*.py",
  "**/__tests__/**",
  "**/test/**",
  "**/tests/**",
  "**/spec/**",
].map((g) => `:(glob)${g}`);

/** True for a test file: in a test folder, or named like one (cart.test.ts, cart_test.go, test_cart.py). */
export const isTest = (path: string): boolean => TEST.test(path);
const isSource = (path: string) => SOURCE.test(path) && !TEST.test(path) && !NOT_SOURCE.test(path);
/** The word a test would use for a file: its name without extension, or its folder's for an index file. */
const stem = (path: string) => {
  const s = basename(path).replace(/\.[^.]+$/, "");
  return /^(?:index|__init__|mod)$/.test(s) ? basename(dirname(path)) : s;
};
const testStem = (path: string) =>
  basename(path)
    .replace(/\.[^.]+$/, "")
    .replace(/[._-](?:test|spec)$/, "")
    .replace(/^test_/, "");

/** The `top` source files changed most in a `git log --name-only` (still tracked), most first. */
export function mostChanged(log: string, tracked: ReadonlySet<string>, top = 20): Count[] {
  const n = new Map<string, number>();
  for (const p of log.split("\n")) if (tracked.has(p) && isSource(p)) n.set(p, (n.get(p) ?? 0) + 1);
  return [...n]
    .map(([path, k]) => ({ path, n: k }))
    .sort((a, b) => b.n - a.n || a.path.localeCompare(b.path))
    .slice(0, top);
}

/**
 * Of a repo's 20 source files changed most in the last 30 days, the ones no test names: no test file is called after
 * it (cart.ts and cart.test.ts) and none mentions its name as a word (an import of "./cart" does). A repo with no
 * tests at all gives none: its first test setup is a bigger choice than a lead makes on its own.
 */
export async function repoUntested(repo: string, run: Run = git, now = Date.now()): Promise<Count[]> {
  const [log, files] = await Promise.all([
    run(["git", "log", `--since=${new Date(now - 30 * DAY).toISOString()}`, "--no-merges", "--name-only", "--format="], repo),
    run(["git", "ls-files"], repo),
  ]);
  if (!log.ok || !files.ok) return [];
  const tracked = files.out.split("\n");
  const tests = tracked.filter(isTest);
  if (!tests.length) return [];
  const named = new Set(tests.map(testStem));
  const out: Count[] = [];
  for (const f of mostChanged(log.out, new Set(tracked))) {
    const s = stem(f.path);
    if (named.has(s)) continue;
    // git grep exits 1 when nothing matches
    const hit = await run(["git", "grep", "-l", "-w", "-F", "-e", s, "--", ...TEST_PATHS], repo);
    if (!hit.out) out.push(f);
  }
  return out;
}

/** A repo's files with TODO, FIXME, HACK or XXX notes, counted the way the check-up counts them. */
export async function repoTodos(repo: string, run: Run = git): Promise<Count[]> {
  const r = await run(TODO_GREP, repo);
  return r.ok ? todoCounts(r.out) : [];
}

/** One repo's upkeep as last read, and when each part was. */
interface Kept {
  client: string;
  repo: string;
  updatesAt: number;
  updates: Update[];
  repoAt: number;
  untested: Count[];
  todos: Count[];
}
const FILE = join(OPS, ".upkeep.json");

/** Reads what's due on every active repo, one repo at a time, keeping each as soon as it's read. */
async function readDue(now = Date.now()): Promise<void> {
  for (const c of CLIENTS)
    for (const path of activeRepos(c)) {
      const was = readJson<Record<string, Kept>>(FILE, {})[path];
      const e: Kept = { updatesAt: 0, updates: [], repoAt: 0, untested: [], todos: [], ...was, client: c.name, repo: basename(path) };
      if (now - e.repoAt >= REPO_EVERY) Object.assign(e, { repoAt: now, untested: await repoUntested(path), todos: await repoTodos(path) });
      if (now - e.updatesAt >= UPDATES_EVERY) Object.assign(e, { updatesAt: now, updates: await repoUpdates(path, slow(c.name)) });
      writeJsonAtomic(FILE, { ...readJson<Record<string, Kept>>(FILE, {}), [path]: e });
    }
}

/** Each kept repo's upkeep as status lists, for the projects there are now. */
export function upkeepLists(kept: Readonly<Record<string, Kept>>, clients: readonly string[]) {
  const rows = Object.values(kept).filter((e) => clients.includes(e.client));
  const own = <T>(f: (e: Kept) => T[]) => rows.flatMap((e) => f(e).map((x) => ({ client: e.client, repo: e.repo, ...x })));
  return { outdated: own((e) => e.updates), untested: own((e) => e.untested), todos: own((e) => e.todos) };
}

let reading = false;
let failed = "";
/**
 * Every project's upkeep as last read, at once; whatever is due is read in the background and shows on a later
 * refresh. `error` is why the last background read stopped, if it did.
 */
export function upkeep(): ReturnType<typeof upkeepLists> & { error: string } {
  if (!reading) {
    reading = true;
    void readDue()
      .then(() => {
        failed = "";
      })
      .catch((e: unknown) => {
        failed = String(e).slice(0, 160);
      })
      .finally(() => {
        reading = false;
      });
  }
  return {
    ...upkeepLists(
      readJson<Record<string, Kept>>(FILE, {}),
      CLIENTS.map((c) => c.name),
    ),
    error: failed,
  };
}
