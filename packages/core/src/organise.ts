/**
 * Organising your work, the daemon's side: gathers the facts the pure modules read (grouping.ts, lead-scope.ts,
 * suggestions.ts) from git and the config, keeps the suggestions and their dismissals, and carries out the two that touch
 * disk (second clones into worktrees, the optional folder tidy) with an undo log. Nothing here runs a model; nothing moves
 * a folder that has uncommitted work or that an agent, a lead or any program is in.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { Brief, GroupView, Organise } from "@overhand/contract";
import { gitRepos, inUse, liveScope, remoteKey, type Scope, scan } from "./cleanup";
import type { Config, StoredClient } from "./config";
import { gitRefused, safeCmd } from "./env";
import { type GroupUnit, proposeGrouping } from "./grouping";
import { effectiveClients, groupOf } from "./groups";
import { type MemberStats, recommendLeadScope } from "./lead-scope";
import { leadOf, leadPid, loadLeads, lockHolder } from "./leads";
import { parseRemote } from "./onboard";
import { gitEnv } from "./runtimes/runtime";
import { readJson, ticketCache, writeJsonAtomic } from "./state";
import { type OrganiseFacts, type Suggestion, suggestionBrief, suggestions } from "./suggestions";

const DAY = 86_400_000;

const git = (args: string[], cwd: string, timeout = 15_000): { ok: boolean; out: string } => {
  try {
    if (gitRefused(cwd)) return { ok: false, out: "" };
    const r = Bun.spawnSync(safeCmd(["git", ...args]), { cwd, env: gitEnv(), stdout: "pipe", stderr: "pipe", timeout });
    return { ok: r.exitCode === 0, out: r.stdout.toString().trim() };
  } catch {
    return { ok: false, out: "" };
  }
};

/** A repo's last commit (ms, 0 = none) and its commits in the last 30 days. */
function activity(repo: string, now: number): { last: number; commits: number } {
  const last = Number(git(["log", "-1", "--format=%ct"], repo).out) * 1000 || 0;
  const commits = last && now - last < 30 * DAY ? Number(git(["rev-list", "--count", "--since=30.days", "HEAD"], repo).out) || 0 : 0;
  return { last, commits };
}

/** A project's tracker as one key, for telling projects on one tracker apart; "" when it has none. */
export function trackerKey(c: Pick<StoredClient, "tracker" | "prefix">): string {
  if (!c.tracker) return "";
  if (c.tracker.kind === "linear") return `linear:${c.prefix.toLowerCase()}`;
  if (c.tracker.kind === "jira") return `jira:${c.tracker.site.toLowerCase()}/${c.tracker.project.toLowerCase()}`;
  return `github:${c.tracker.repo.toLowerCase()}`;
}

export type ProjectFacts = GroupUnit & MemberStats & { lastCommit: number; dir: string };

/** What each configured project shows: its repos' owners, its tracker and Slack workspace, how big and busy it is. */
export function projectFacts(cfg: Pick<Config, "clients" | "slack">, code: string, now = Date.now()): ProjectFacts[] {
  return cfg.clients.map((c) => {
    const repos = gitRepos(join(code, c.dir));
    const owners = repos.flatMap((r) => {
      const remote = parseRemote(git(["remote", "get-url", "origin"], r).out);
      return remote ? [remote.owner] : [];
    });
    const acts = repos.map((r) => activity(r, now));
    const cached = ticketCache.data[c.name];
    return {
      name: c.name,
      dir: c.dir,
      owners: [...new Set([...owners, ...c.aliases])],
      tracker: trackerKey(c),
      slack: cfg.slack.find((s) => s.client === c.name)?.server ?? "",
      repos: repos.length,
      // ponytail: size isn't measured (du over every repo isn't cheap); commits and tickets carry the advice
      sizeMb: 0,
      commits30d: acts.reduce((n, a) => n + a.commits, 0),
      openTickets: Array.isArray(cached) ? cached.length : 0,
      lastCommit: Math.max(0, ...acts.map((a) => a.last)),
    };
  });
}

/** Lead keys running now: one Overhand started, or a session holding the lead's lock. */
export function runningLeads(cfg: Pick<Config, "godmode">): Set<string> {
  const leads = loadLeads();
  return new Set(cfg.godmode.filter((g) => lockHolder(g) || leadPid(g, leadOf(leads, g.key))).map((g) => g.key));
}

/** One project's own rules and what it ends up with. */
function memberView(cfg: Config, c: StoredClient): GroupView["members"][number] {
  const e = effectiveClients({ clients: [c], groups: cfg.groups })[0];
  return {
    name: c.name,
    dir: c.dir,
    own: {
      ...(c.autonomy ? { autonomy: c.autonomy } : {}),
      ...(c.assignedAutonomy ? { assignedAutonomy: c.assignedAutonomy } : {}),
      ...(c.accounts ? { accounts: c.accounts } : {}),
      ...(c.fallbackToAll !== undefined ? { fallbackToAll: c.fallbackToAll } : {}),
    },
    effective: {
      autonomy: e?.autonomy ?? "act",
      assignedAutonomy: e?.assignedAutonomy ?? "act",
      accounts: e?.accounts ?? [],
      fallbackToAll: e?.fallbackToAll ?? true,
    },
  };
}

/** Groups, loose projects and the proposal, for Settings and onboarding. */
export function organiseView(cfg: Config, facts: readonly ProjectFacts[], running: ReadonlySet<string>): Organise {
  const groups: GroupView[] = cfg.groups.map((g) => {
    const members = cfg.clients.filter((c) => g.members.includes(c.name));
    return {
      name: g.name,
      members: members.map((c) => memberView(cfg, c)),
      rules: g.rules,
      lead: g.lead ?? null,
      advice: recommendLeadScope(facts.filter((f) => g.members.includes(f.name))),
      leads: cfg.godmode
        .filter((l) => l.project === g.name || g.members.includes(l.project))
        .map((l) => ({ key: l.key, label: l.label, project: l.project, running: running.has(l.key) })),
    };
  });
  return {
    groups,
    loose: cfg.clients.filter((c) => !groupOf(cfg, c.name)).map((c) => memberView(cfg, c)),
    proposal: proposeGrouping(facts),
  };
}

// ---------- the suggestions store ----------

interface Store {
  at: number;
  suggestions: Suggestion[];
  /** Suggestion id → the fingerprint it was dismissed at. */
  dismissed: Record<string, string>;
}

const storeFile = (ops: string) => join(ops, "organise.json");
const loadStore = (ops: string): Store => ({ at: 0, suggestions: [], dismissed: {}, ...readJson<Partial<Store>>(storeFile(ops), {}) });

/** A lowercase folder name for a group. */
export const folderOf = (group: string): string =>
  group
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "group";

const isLink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** Uncommitted work in any repo under `p` (a project folder may hold several). */
const dirty = (p: string): boolean => gitRepos(p).some((r) => git(["status", "--porcelain"], r).out !== "");

/**
 * The folder tidy's dry run: each grouped project's folder to <code root>/<group>/<folder name>. Skipped: projects already
 * there, folders that are links or don't exist, ones holding or held by another project's folder, a target that exists,
 * uncommitted work, and folders an agent, a lead or any program is in.
 */
export function tidyPlan(cfg: Config, s: Pick<Scope, "code" | "busy" | "cwds" | "src" | "ops">): OrganiseFacts["tidy"] {
  const moves: { from: string; to: string }[] = [];
  const skipped: { path: string; why: string }[] = [];
  const under = (p: string, root: string) => p === root || p.startsWith(`${root}/`);
  for (const c of cfg.clients) {
    const g = groupOf(cfg, c.name);
    if (!g) continue;
    const folder = folderOf(g.name);
    if (c.dir === folder || c.dir.startsWith(`${folder}/`)) continue;
    const from = join(s.code, c.dir);
    const to = join(s.code, folder, basename(c.dir));
    const why = !existsSync(from)
      ? "it isn't there"
      : isLink(from)
        ? "it's a link"
        : existsSync(to)
          ? `${relative(s.code, to)} already exists`
          : cfg.clients.some((o) => o !== c && (under(join(s.code, o.dir), from) || under(from, join(s.code, o.dir))))
            ? "another project's folder is inside it, or it's inside another's"
            : under(s.src, from) || under(s.ops, from)
              ? "Overhand itself lives there"
              : dirty(from)
                ? "it has uncommitted work"
                : inUse(from, s);
    if (why) skipped.push({ path: relative(s.code, from), why });
    else moves.push({ from: relative(s.code, from), to: relative(s.code, to) });
  }
  return { moves, skipped };
}

/** Everything the checks read, gathered now. Busy folders and running programs come from the janitor's scope. */
export function gatherFacts(cfg: Config, code: string, ops: string, src: string, now = Date.now()): OrganiseFacts {
  const scope = liveScope(cfg, code, ops, src);
  const projects = projectFacts(cfg, code, now);
  const clones = new Map<string, { remote: string; keep: string; extra: string[] }>();
  for (const it of scan("clones", scope)) {
    if (!it.keep) continue;
    const remote = remoteKey(git(["remote", "get-url", "origin"], it.path).out) || basename(it.path);
    const was = clones.get(it.keep) ?? { remote, keep: it.keep, extra: [] };
    clones.set(it.keep, { ...was, extra: [...was.extra, it.path] });
  }
  return {
    now,
    groups: cfg.groups,
    projects,
    leads: cfg.godmode.map((l) => ({ key: l.key, project: l.project, supervised: l.supervised })),
    clones: [...clones.values()],
    tidy: tidyPlan(cfg, scope),
  };
}

/** Works out the suggestions again and keeps them (the daemon's timer and the dashboard both call this). */
export function refreshSuggestions(cfg: Config, code: string, ops: string, src: string): Suggestion[] {
  const store = loadStore(ops);
  const all = suggestions(gatherFacts(cfg, code, ops, src));
  writeJsonAtomic(storeFile(ops), { ...store, at: Date.now(), suggestions: all });
  return all.filter((s) => store.dismissed[s.id] !== s.fingerprint);
}

/** The open suggestions as decision cards; worked out first when none were kept in the last `maxAgeMs`. */
export function suggestionBriefs(cfg: Config, code: string, ops: string, src: string, maxAgeMs = 30 * 60_000): Brief[] {
  const store = loadStore(ops);
  const now = Date.now();
  const open =
    now - store.at > maxAgeMs
      ? refreshSuggestions(cfg, code, ops, src)
      : store.suggestions.filter((s) => store.dismissed[s.id] !== s.fingerprint);
  return open.map((s) => suggestionBrief(s, store.at || now));
}

/** One kept suggestion by id (open or dismissed). */
export const keptSuggestion = (ops: string, id: string): Suggestion | undefined => loadStore(ops).suggestions.find((s) => s.id === id);

/** Leaves a suggestion until its facts change. */
export function dismissSuggestion(ops: string, s: Suggestion): void {
  const store = loadStore(ops);
  writeJsonAtomic(storeFile(ops), { ...store, dismissed: { ...store.dismissed, [s.id]: s.fingerprint } });
}

// ---------- moves on disk, with an undo log ----------

/** One step a disk change made, enough to put it back. */
type UndoStep =
  | { kind: "move"; from: string; to: string; dirs: { lead: boolean; name: string; before: string; after: string }[] }
  | { kind: "worktree"; keep: string; path: string; kept: string };

export interface UndoLog {
  id: string;
  at: number;
  what: string;
  steps: UndoStep[];
}

const undoDir = (ops: string) => join(ops, "organise", "undo");
const undoFile = (ops: string, id: string) => join(undoDir(ops), `${id}.json`);

function saveUndo(ops: string, log: UndoLog): void {
  mkdirSync(undoDir(ops), { recursive: true });
  writeJsonAtomic(undoFile(ops, log.id), log);
}

/** Saved undo logs, newest first. */
export function undoLogs(ops: string): UndoLog[] {
  if (!existsSync(undoDir(ops))) return [];
  return readdirSync(undoDir(ops))
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<UndoLog | null>(join(undoDir(ops), f), null))
    .filter((l): l is UndoLog => l !== null)
    .sort((a, b) => b.at - a.at);
}

/** The worktrees git knows for a repo, besides the repo itself. */
const linkedWorktrees = (repo: string): string[] =>
  git(["worktree", "list", "--porcelain"], repo)
    .out.split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length))
    .slice(1);

/** After a folder moved: every repo in it finds its worktrees again (and they it), wherever they sit. */
function repairMoved(from: string, to: string, worktrees: ReadonlyMap<string, string[]>): void {
  for (const [repo, wts] of worktrees) {
    const now = join(to, relative(from, repo));
    const moved = wts.filter((w) => w === from || w.startsWith(`${from}/`)).map((w) => join(to, relative(from, w)));
    git(["worktree", "repair", ...moved], now);
  }
}

/** Every stored project and lead folder under `from`, as it reads after the move to `to`. */
function dirChanges(cfg: Config, code: string, from: string, to: string): Extract<UndoStep, { kind: "move" }>["dirs"] {
  const rel = relative(code, from);
  const relTo = relative(code, to);
  const moved = (d: string) => (d === rel ? relTo : d.startsWith(`${rel}/`) ? `${relTo}${d.slice(rel.length)}` : null);
  return [
    ...cfg.clients.flatMap((c) => {
      const after = moved(c.dir);
      return after ? [{ lead: false, name: c.name, before: c.dir, after }] : [];
    }),
    ...cfg.godmode.flatMap((l) => {
      const after = moved(l.dir);
      return after ? [{ lead: true, name: l.key, before: l.dir, after }] : [];
    }),
  ];
}

/** The config with project and lead folders set as a step says (`back` restores them). */
function withDirs(cfg: Config, dirs: Extract<UndoStep, { kind: "move" }>["dirs"], back = false): Config {
  const pick = (d: (typeof dirs)[number]) => (back ? d.before : d.after);
  return {
    ...cfg,
    clients: cfg.clients.map((c) => {
      const d = dirs.find((x) => !x.lead && x.name === c.name);
      return d ? { ...c, dir: pick(d) } : c;
    }),
    godmode: cfg.godmode.map((l) => {
      const d = dirs.find((x) => x.lead && x.name === l.key);
      return d ? { ...l, dir: pick(d) } : l;
    }),
  };
}

/**
 * Carries out the folder tidy: each move checked again right before it (still clean, still idle), the folder renamed
 * into place, a link left at the old path so anything pointing there still works, its repos' worktrees repaired, and the
 * config's folders updated. Returns the new config and the undo log (saved), or null when nothing moved.
 */
export function applyTidy(
  cfg: Config,
  s: Pick<Scope, "code" | "busy" | "cwds" | "src" | "ops">,
  now = Date.now(),
): { cfg: Config; log: UndoLog; lines: string[] } | null {
  const plan = tidyPlan(cfg, s);
  const steps: UndoStep[] = [];
  const lines = plan.skipped.map((x) => `skipped ${x.path}: ${x.why}`);
  let next = cfg;
  for (const m of plan.moves) {
    const from = join(s.code, m.from);
    const to = join(s.code, m.to);
    if (dirty(from) || inUse(from, s)) {
      lines.push(`skipped ${m.from}: it became busy`);
      continue;
    }
    const worktrees = new Map(gitRepos(from).map((r) => [r, linkedWorktrees(r)]));
    try {
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
    } catch (e) {
      lines.push(`skipped ${m.from}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    symlinkSync(to, from);
    repairMoved(from, to, worktrees);
    const dirs = dirChanges(next, s.code, from, to);
    next = withDirs(next, dirs);
    steps.push({ kind: "move", from, to, dirs });
    lines.push(`moved ${m.from} → ${m.to}`);
  }
  if (!steps.length) return null;
  const log: UndoLog = { id: `tidy-${now}`, at: now, what: `Tidied ${steps.length} folders`, steps };
  saveUndo(s.ops, log);
  return { cfg: next, log, lines };
}

/** The checks a second clone must still pass to become a worktree: clean, fully pushed, no stash, no worktrees of its own. */
function cloneClean(p: string): boolean {
  return (
    git(["status", "--porcelain"], p).out === "" &&
    git(["rev-list", "--count", "--branches", "--not", "--remotes"], p).out === "0" &&
    git(["stash", "list"], p).out === "" &&
    linkedWorktrees(p).length === 0
  );
}

/**
 * Second full clones into worktrees of the one kept: each checked again (still clean and pushed, still idle, still the
 * same remote), set aside under Overhand's folder (not deleted: undo puts it back), and a worktree of the kept clone made
 * at its path on the same commit, then on its branch where git allows. A clone whose worktree can't be made is put back.
 */
export function applyDedupe(
  set: { keep: string; extra: readonly string[] },
  s: Pick<Scope, "busy" | "cwds" | "ops">,
  now = Date.now(),
): { log: UndoLog | null; lines: string[] } {
  const steps: UndoStep[] = [];
  const lines: string[] = [];
  const remoteOf = (p: string) => remoteKey(git(["remote", "get-url", "origin"], p).out);
  for (const p of set.extra) {
    if (!existsSync(p) || remoteOf(p) !== remoteOf(set.keep) || !cloneClean(p) || inUse(p, s)) {
      lines.push(`skipped ${p}: it has work of its own now, or something is using it`);
      continue;
    }
    const head = git(["rev-parse", "HEAD"], p).out;
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], p).out;
    const kept = join(s.ops, "organise", "kept", String(now), `${basename(p)}-${steps.length}`);
    try {
      mkdirSync(dirname(kept), { recursive: true });
      renameSync(p, kept);
    } catch (e) {
      lines.push(`skipped ${p}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    // the commit is pushed, so the kept clone can fetch it if it hasn't yet
    if (!git(["cat-file", "-e", head], set.keep).ok) git(["fetch", "--quiet", "origin"], set.keep, 120_000);
    if (!git(["worktree", "add", "--detach", p, head], set.keep, 120_000).ok) {
      renameSync(kept, p);
      lines.push(`skipped ${p}: git couldn't make a worktree there; left as it was`);
      continue;
    }
    if (branch && branch !== "HEAD") git(["switch", branch], p);
    steps.push({ kind: "worktree", keep: set.keep, path: p, kept });
    lines.push(`${p} is now a worktree of ${set.keep}; the old clone is kept at ${kept} until you free it`);
  }
  if (!steps.length) return { log: null, lines };
  const log: UndoLog = { id: `dedupe-${now}`, at: now, what: `Made ${steps.length} clones worktrees of ${set.keep}`, steps };
  saveUndo(s.ops, log);
  return { log, lines };
}

/**
 * Puts one undo log's changes back, newest step first: a moved folder returns (its link removed, its worktrees repaired,
 * the config's folders restored); a worktree made from a second clone is removed, if it's still clean, and the clone set
 * aside comes back. Steps that can't be undone safely are left and said. Returns the config to save.
 */
export function undo(cfg: Config, ops: string, id: string): { cfg: Config; lines: string[] } {
  const log = readJson<UndoLog | null>(undoFile(ops, id), null);
  if (!log) throw new Error("that change can't be undone any more");
  let next = cfg;
  const lines: string[] = [];
  const left: UndoStep[] = [];
  for (const st of [...log.steps].reverse()) {
    if (st.kind === "move") {
      const linked = isLink(st.from) && readlinkSync(st.from) === st.to;
      if (!linked || !existsSync(st.to) || dirty(st.to)) {
        lines.push(`left ${st.to}: it changed since the tidy`);
        left.push(st);
        continue;
      }
      const worktrees = new Map(gitRepos(st.to).map((r) => [r, linkedWorktrees(r)]));
      rmSync(st.from);
      renameSync(st.to, st.from);
      repairMoved(st.to, st.from, worktrees);
      next = withDirs(next, st.dirs, true);
      lines.push(`moved ${st.to} back to ${st.from}`);
    } else {
      if (!existsSync(st.kept) || git(["status", "--porcelain"], st.path).out !== "") {
        lines.push(`left ${st.path}: it has new work, or the old clone is gone`);
        left.push(st);
        continue;
      }
      if (!git(["worktree", "remove", st.path], st.keep).ok) {
        lines.push(`left ${st.path}: git wouldn't remove the worktree (files it doesn't track are in it)`);
        left.push(st);
        continue;
      }
      renameSync(st.kept, st.path);
      lines.push(`${st.path} is a full clone again`);
    }
  }
  if (left.length) writeJsonAtomic(undoFile(ops, id), { ...log, steps: left.reverse() });
  else rmSync(undoFile(ops, id), { force: true });
  return { cfg: next, lines };
}

/** Deletes the second clones a dedupe set aside (frees their disk; that change can't be undone afterwards). */
export function freeKept(ops: string, id: string): string[] {
  const log = readJson<UndoLog | null>(undoFile(ops, id), null);
  if (!log) return [];
  const freed = log.steps.flatMap((st) => (st.kind === "worktree" && existsSync(st.kept) ? [st.kept] : []));
  for (const p of freed) rmSync(p, { recursive: true, force: true });
  const rest = log.steps.filter((st) => st.kind !== "worktree");
  if (rest.length) writeJsonAtomic(undoFile(ops, id), { ...log, steps: rest });
  else rmSync(undoFile(ops, id), { force: true });
  return freed;
}
