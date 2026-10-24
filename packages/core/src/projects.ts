/**
 * Projects from GitHub: the repos you can pick (yours and your orgs', through `gh`), a pasted URL, and getting each one
 * into Overhand's projects folder. A repo you already have on this computer is linked there instead of cloned twice;
 * only the repos you chose are looked for, and only their git remote config is read. Agents never work in that
 * checkout itself: their worktrees go in its `.claude/worktrees`, which `.git/info/exclude` keeps out of `git status`
 * (agent.ts `prepareWorktree`), so your working tree, branch and uncommitted changes stay as they are.
 */
import { type Dirent, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import { shAsync } from "./env";
import { parseRemote } from "./onboard";

/** A repo `gh repo list` returned, as the picker shows it. */
export interface GithubRepo {
  owner: string;
  name: string;
  private: boolean;
  /** ISO time of the last push; "" when it never had one. */
  pushedAt: string;
  language: string;
}

/** Why an owner's repos (or one repo) can't be reached, and the one thing that fixes it. */
export interface Problem {
  owner: string;
  message: string;
  /** A command to run (`gh auth refresh -s read:org`) or a page to open (the org's SSO page); "" when there's none. */
  fix: string;
}

const RepoListSchema = z.array(
  z.object({
    name: z.string(),
    owner: z.object({ login: z.string() }),
    isPrivate: z.boolean(),
    isArchived: z.boolean().default(false),
    pushedAt: z.string().nullish(),
    primaryLanguage: z.object({ name: z.string() }).nullish(),
  }),
);

/** The fields `gh repo list --json` is asked for; `parseRepoList` reads them. */
const REPO_FIELDS = "name,owner,isPrivate,isArchived,pushedAt,primaryLanguage";

/** `gh repo list --json …` output as picker rows, archived repos left out; [] for anything it can't read. */
export function parseRepoList(json: string): GithubRepo[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  const r = RepoListSchema.safeParse(raw);
  if (!r.success) return [];
  return r.data
    .filter((x) => !x.isArchived)
    .map((x) => ({
      owner: x.owner.login,
      name: x.name,
      private: x.isPrivate,
      pushedAt: x.pushedAt ?? "",
      language: x.primaryLanguage?.name ?? "",
    }));
}

/** A repo to add: who owns it, its name, and the URL to clone. */
export interface RepoRef {
  owner: string;
  name: string;
  url: string;
}

/**
 * A pasted repo: an https or ssh URL (with or without .git, a trailing slash or a /tree/… path), or owner/name
 * shorthand for GitHub. Null for anything else. GitHub repos clone over https, through `gh`'s sign-in; another host's
 * URL clones as given.
 */
export function parseRepoInput(input: string): RepoRef | null {
  const s = input.trim();
  const short = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (short?.[1] && short[2] && !s.includes(":")) return github(short[1], short[2]);
  // a GitHub page URL may carry /tree/main/src or /pull/3: the repo is its first two segments
  const page = s.match(/^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (page?.[1] && page[2]) return github(page[1], page[2]);
  const r = parseRemote(s);
  if (!r) return null;
  return r.host === "github" ? github(r.owner, r.name) : { owner: r.owner, name: r.name, url: s };
}

const github = (owner: string, name: string): RepoRef => ({ owner, name, url: `https://github.com/${owner}/${name}.git` });

/** The same repo whatever the URL's form: host/owner/name, lower case. */
export function repoKey(url: string): string {
  const r = parseRemote(url);
  return r ? `${r.host}/${r.owner}/${r.name}`.toLowerCase() : "";
}

/**
 * What a failed `gh` or `git clone` said, in words you can act on. SSO: the org's sign-in page to authorise (the one
 * GitHub named, else the org's). A missing read:org scope: the exact `gh auth refresh`. No access: that the signed-in
 * account can't see it.
 */
export function explainError(err: string, owner: string, repo = ""): Problem {
  const what = repo ? `${owner}/${repo}` : `${owner}'s repositories`;
  const sso = err.match(/https:\/\/github\.com\/orgs\/[\w.-]+\/sso\S*/)?.[0];
  if (sso || /SAML|single sign-on|\bSSO\b/i.test(err))
    return {
      owner,
      message: `${owner} uses single sign-on. Authorise your GitHub sign-in for ${owner}, then try again.`,
      fix: sso ?? `https://github.com/orgs/${owner}/sso`,
    };
  if (/read:org|INSUFFICIENT_SCOPES|missing required scope/i.test(err))
    return {
      owner,
      message: "GitHub's sign-in can't list your organisations yet. Grant it read:org, then try again.",
      fix: "gh auth refresh -s read:org",
    };
  if (
    /not found|could not resolve to a repository|repository .* does not exist|\b40[34]\b|permission denied|access denied|not authorized|could not read from remote repository|does not appear to be a git repository/i.test(
      err,
    )
  )
    return {
      owner,
      message: `The GitHub account you're signed in with can't see ${what}. Check the name, or ask its owner for access.`,
      fix: "",
    };
  if (/could not resolve host|unable to access|network|timed out/i.test(err))
    return { owner, message: `Couldn't reach ${repo ? "the repository" : "GitHub"}. Check the connection and try again.`, fix: "" };
  const last = err.trim().split("\n").at(-1) ?? "";
  return { owner, message: last || `Couldn't get ${what}.`, fix: "" };
}

/**
 * Every repo the signed-in GitHub account can pick: its own and each of its organisations', newest push first. An
 * organisation that can't be read (SSO not authorised, no read:org) becomes a problem with its fix; the rest still list.
 */
export async function listGithubRepos(): Promise<{ repos: GithubRepo[]; problems: Problem[] }> {
  // without the GitHub CLI, or signed out, there's no list to pick from; a public repo's URL still clones with git
  const signedIn = Bun.which("gh") !== null && (await shAsync(["gh", "auth", "status"], undefined, 15_000)).ok;
  if (!signedIn)
    return {
      repos: [],
      problems: [
        Bun.which("gh") === null
          ? {
              owner: "",
              message: "Install GitHub's command tool to pick from your repos. A public repo's URL works without it.",
              fix: "https://cli.github.com",
            }
          : {
              owner: "",
              message: "Sign in to GitHub to pick from your repos. A public repo's URL works without it.",
              fix: "gh auth login",
            },
      ],
    };
  const list = (owner: string[]) => shAsync(["gh", "repo", "list", ...owner, "--limit", "1000", "--json", REPO_FIELDS], undefined, 60_000);
  const [mine, orgs] = await Promise.all([
    list([]),
    shAsync(["gh", "api", "user/orgs", "--paginate", "-q", ".[].login"], undefined, 30_000),
  ]);
  const problems: Problem[] = [];
  if (!mine.ok) problems.push(explainError(mine.err, "you"));
  if (!orgs.ok) problems.push(explainError(orgs.err, "your organisations"));
  const logins = orgs.ok ? orgs.out.split("\n").filter(Boolean) : [];
  const theirs = await Promise.all(logins.map(async (o) => ({ o, r: await list([o]) })));
  for (const { o, r } of theirs) if (!r.ok) problems.push(explainError(r.err, o));
  const repos = [mine, ...theirs.map((t) => t.r)].flatMap((r) => (r.ok ? parseRepoList(r.out) : []));
  return { repos: repos.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt)), problems };
}

// ---------- copies already on this computer ----------

/** Where people keep their code, under home. Only the repos you chose are looked for in them. */
const COMMON_ROOTS = [
  "Code",
  "code",
  "Projects",
  "projects",
  "Developer",
  "dev",
  "src",
  "GitHub",
  "Documents/GitHub",
  "repos",
  "workspace",
];

/** A checkout of a chosen repo found on this computer. */
export interface LocalCopy {
  path: string;
  /** Unix seconds of its last commit; 0 when it has none. */
  committed: number;
  /** Its checked-out branch, and the default branch of its origin ("" when unknown). */
  branch: string;
  defaultBranch: string;
  /** Uncommitted or untracked changes in it. */
  dirty: boolean;
}

/** The remote URLs in a git config file's text: every remote, not just origin. */
export function remoteUrls(config: string): string[] {
  return [...config.matchAll(/^\s*url\s*=\s*(.+?)\s*$/gm)].flatMap((m) => (m[1] ? [m[1]] : []));
}

/**
 * Checkouts of the wanted repos (keys from `repoKey`) under `roots`, up to 4 levels down: hidden folders and
 * node_modules are skipped, a repo isn't entered, and each repo's `.git/config` is the only file read (`read` is
 * injectable so tests can prove it). It stops at the time budget and says so.
 */
export async function findCopies(
  wanted: ReadonlySet<string>,
  roots: readonly string[],
  budgetMs = 3_000,
  read: (path: string) => Promise<string> = (p) => readFile(p, "utf8"),
): Promise<{ found: Map<string, string[]>; partial: boolean }> {
  const deadline = Date.now() + budgetMs;
  const found = new Map<string, string[]>();
  const seen = new Set<string>();
  let partial = false;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (Date.now() >= deadline) {
      partial = true;
      return;
    }
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === ".git" && e.isDirectory())) {
      const urls = await read(join(dir, ".git", "config")).then(remoteUrls, () => []);
      for (const k of new Set(urls.map(repoKey)))
        if (k && wanted.has(k) && !found.get(k)?.includes(dir)) found.set(k, [...(found.get(k) ?? []), dir]);
      return; // a repo's own folders are its business
    }
    if (depth >= 4) return;
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
        .map((e) => walk(join(dir, e.name), depth + 1)),
    );
  };
  for (const root of roots) {
    // ~/Code and ~/code are one folder on a case-insensitive disk: walk it once
    let id = root;
    try {
      const st = statSync(root);
      id = `${st.dev}:${st.ino}`;
    } catch {
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    await walk(root, 0);
  }
  return { found, partial };
}

/** What a found copy looks like now: its last commit, branch, origin's default branch and whether it has changes. */
export async function describeCopy(path: string): Promise<LocalCopy> {
  const git = (...a: string[]) => shAsync(["git", ...a], path, 10_000);
  const [log, head, origin, status] = await Promise.all([
    git("log", "-1", "--format=%ct"),
    git("symbolic-ref", "--short", "HEAD"),
    git("symbolic-ref", "--short", "refs/remotes/origin/HEAD"),
    git("status", "--porcelain"),
  ]);
  return {
    path,
    committed: Number(log.out) || 0,
    branch: head.out,
    defaultBranch: origin.out.replace(/^origin\//, ""),
    dirty: status.out !== "",
  };
}

/** The copy to use when there are several: the most recently committed. */
export const newest = (copies: readonly LocalCopy[]): LocalCopy | undefined => [...copies].sort((a, b) => b.committed - a.committed)[0];

// ---------- adding: link a copy you have, else clone ----------

/** One repo on its way into the projects folder. */
export interface Addition {
  owner: string;
  name: string;
  url: string;
  state: "looking" | "cloning" | "ready" | "failed";
  /** Where it is: your own copy (linked) or Overhand's clone. */
  via: "copy" | "clone" | "";
  /** The copy in use, and any others found. */
  copy: LocalCopy | null;
  others: string[];
  problem: Problem | null;
}

/** What's being added, by owner/name: the picker polls it for progress. In memory: a restart forgets finished ones. */
const ADDING = new Map<string, Addition>();

/** Every repo added since the daemon started, oldest first. */
export const additions = (): Addition[] => [...ADDING.values()];

/** Forgets every addition (tests). */
export const forgetAdditions = (): void => ADDING.clear();

/** Where a repo lives in the projects folder: <projects>/<owner>/<name>. */
export const destOf = (projects: string, r: Pick<RepoRef, "owner" | "name">): string => join(projects, r.owner, r.name);

/**
 * A full clone (no --depth, so worktrees and every branch work) into `dest`, without blocking the daemon. GitHub
 * clones authenticate through `gh` for that one command (your git config is left alone), and nothing may prompt: a
 * daemon has no terminal to answer in.
 */
export async function cloneInto(url: string, dest: string): Promise<{ ok: boolean; err: string }> {
  mkdirSync(dirname(dest), { recursive: true });
  const r = await shAsync(
    [
      "env",
      "GIT_TERMINAL_PROMPT=0",
      "GIT_SSH_COMMAND=ssh -o BatchMode=yes",
      "git",
      "-c",
      "credential.https://github.com.helper=",
      "-c",
      "credential.https://github.com.helper=!gh auth git-credential",
      "clone",
      "--quiet",
      url,
      dest,
    ],
    dirname(dest),
    30 * 60_000,
  );
  if (!r.ok) rmSync(dest, { recursive: true, force: true });
  return { ok: r.ok, err: r.err };
}

/** True for a symlink (never followed: removing it must not touch what it points at). */
const isLink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * Adds repos to the projects folder in the background. First it looks for copies you already have (only these repos,
 * in `roots`, within the time budget): one found is linked in, the most recently committed when there are several.
 * Otherwise, or with `fresh`, Overhand clones its own. Poll `additions()` for progress.
 */
export async function addRepos(refs: readonly RepoRef[], projects: string, roots: readonly string[], fresh = false): Promise<void> {
  const todo = refs.filter((r) => {
    const cur = ADDING.get(`${r.owner}/${r.name}`.toLowerCase());
    return !cur || cur.state === "failed" || fresh;
  });
  for (const r of todo)
    ADDING.set(`${r.owner}/${r.name}`.toLowerCase(), { ...r, state: "looking", via: "", copy: null, others: [], problem: null });
  const set = (r: RepoRef, patch: Partial<Addition>) => {
    const k = `${r.owner}/${r.name}`.toLowerCase();
    const cur = ADDING.get(k);
    if (cur) ADDING.set(k, { ...cur, ...patch });
  };
  const keys = new Set(todo.map((r) => repoKey(r.url)));
  const { found } = fresh ? { found: new Map<string, string[]>() } : await findCopies(keys, roots);
  await Promise.all(
    todo.map(async (r) => {
      const dest = destOf(projects, r);
      // already in the projects folder (an earlier add, or the folder is where your code was all along)
      if (!fresh && existsSync(join(dest, ".git"))) {
        set(r, { state: "ready", via: isLink(dest) ? "copy" : "clone", copy: isLink(dest) ? await describeCopy(dest) : null });
        return;
      }
      const paths = (found.get(repoKey(r.url)) ?? []).filter((p) => p !== dest);
      const copies = await Promise.all(paths.map(describeCopy));
      const use = newest(copies);
      if (use) {
        mkdirSync(dirname(dest), { recursive: true });
        if (isLink(dest)) unlinkSync(dest);
        symlinkSync(use.path, dest, "dir");
        set(r, { state: "ready", via: "copy", copy: use, others: paths.filter((p) => p !== use.path) });
        return;
      }
      // a fresh copy instead of the one you had: only Overhand's link goes, never your checkout
      if (isLink(dest)) unlinkSync(dest);
      else if (existsSync(dest) && readdirSync(dest).length) {
        set(r, { state: "failed", problem: { owner: r.owner, message: `${dest} already exists and isn't this repo.`, fix: "" } });
        return;
      }
      set(r, { state: "cloning", via: "clone", copy: null, others: [] });
      const c = await cloneInto(r.url, dest);
      set(r, c.ok ? { state: "ready" } : { state: "failed", problem: explainError(c.err, r.owner, r.name) });
    }),
  );
}

/** Where to look for copies you already have: the common code folders under home, and your code root. */
export const copyRoots = (codeRoot: string, home = homedir()): string[] => [...COMMON_ROOTS.map((d) => join(home, d)), codeRoot];

/** A path for a person: under home as ~/…. */
export const tilde = (p: string, home = homedir()): string => (p.startsWith(`${home}/`) ? `~/${relative(home, p)}` : p);
