import { expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blankConfig, type Config, type StoredClient } from "../src/config";
import { applyDedupe, applyTidy, folderOf, freeKept, projectFacts, tidyPlan, trackerKey, undo, undoLogs } from "../src/organise";

const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
};
const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), "overhand-organise-")));

/** A repo with one commit, its origin set to `remote` (a bare repo it's pushed to, when given). */
function repo(path: string, remote = "https://github.com/acme/x.git", bare = ""): string {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q", "-b", "main");
  writeFileSync(join(path, "README.md"), "hi\n");
  git(path, "add", ".");
  git(path, "commit", "-qm", "first");
  git(path, "remote", "add", "origin", bare || remote);
  if (bare) git(path, "push", "-q", "origin", "main");
  return path;
}

const project = (name: string, dir: string): StoredClient => ({
  name,
  dir,
  prefix: name.toUpperCase(),
  host: "github",
  tracker: { kind: "github", repo: `acme/${name.toLowerCase()}` },
  aliases: [],
  status: { vercelSecrets: [], sentrySecrets: [] },
});

const cfgOf = (clients: StoredClient[], groups: Config["groups"]): Config => ({ ...blankConfig("alex"), clients, groups });

test("facts: each project's owners, tracker, workspace and activity", () => {
  const code = scratch();
  repo(join(code, "acme", "web"), "git@github.com:AcmeCo/web.git");
  const [f] = projectFacts({ clients: [project("Web", "acme")], slack: [{ server: "acme-ws", client: "Web" }] }, code);
  expect(f).toMatchObject({ name: "Web", owners: ["AcmeCo"], tracker: "github:acme/web", slack: "acme-ws", repos: 1, commits30d: 1 });
  expect(f?.lastCommit).toBeGreaterThan(Date.now() - 60_000);
  expect(trackerKey({ prefix: "EW", tracker: { kind: "linear", secret: "" } })).toBe("linear:ew");
  expect(folderOf("Acme Labs!")).toBe("acme-labs");
});

test("tidy: a dry run that skips dirty and busy folders, moves the rest with a link back, and undoes it all", () => {
  const code = scratch();
  const ops = scratch();
  const web = repo(join(code, "web"));
  repo(join(code, "api"));
  writeFileSync(join(code, "api", "wip.txt"), "uncommitted");
  repo(join(code, "ios"));
  repo(join(code, "acme", "site"));
  // a linked worktree inside the repo, as agents make them (kept out of git status)
  writeFileSync(join(web, ".git", "info", "exclude"), ".wt/\n");
  git(web, "worktree", "add", "-q", join(web, ".wt", "T-1"), "-b", "T-1");
  const cfg: Config = {
    ...cfgOf(
      [project("Web", "web"), project("Api", "api"), project("Ios", "ios"), project("Site", "acme/site"), project("Kite", "kite")],
      [{ name: "Acme", members: ["Web", "Api", "Ios", "Site"], rules: {} }],
    ),
    godmode: [],
  };
  const scope = { code, ops, src: "/nowhere", busy: [join(code, "ios")], cwds: [] };
  const plan = tidyPlan(cfg, scope);
  expect(plan.moves).toEqual([{ from: "web", to: "acme/web" }]);
  expect(plan.skipped).toEqual([
    { path: "api", why: "it has uncommitted work" },
    { path: "ios", why: "an agent or lead is working there" },
  ]);
  const done = applyTidy(cfg, scope, 1000);
  if (!done) throw new Error("it moved");
  expect(done.cfg.clients.find((c) => c.name === "Web")?.dir).toBe("acme/web");
  expect(lstatSync(join(code, "web")).isSymbolicLink()).toBe(true);
  expect(readlinkSync(join(code, "web"))).toBe(join(code, "acme", "web"));
  // the moved repo and its worktree still know each other
  expect(git(join(code, "acme", "web"), "worktree", "list")).toContain(join(code, "acme", "web", ".wt", "T-1"));
  expect(git(join(code, "acme", "web", ".wt", "T-1"), "rev-parse", "--abbrev-ref", "HEAD")).toBe("T-1");
  expect(undoLogs(ops).map((l) => l.id)).toEqual(["tidy-1000"]);
  const back = undo(done.cfg, ops, "tidy-1000");
  expect(back.cfg.clients.find((c) => c.name === "Web")?.dir).toBe("web");
  expect(lstatSync(join(code, "web")).isDirectory()).toBe(true);
  expect(existsSync(join(code, "acme", "web"))).toBe(false);
  expect(git(join(code, "web", ".wt", "T-1"), "status", "--porcelain")).toBe("");
  expect(undoLogs(ops)).toEqual([]);
});

test("second clones: made worktrees of the one kept, undone, and freed only when asked", () => {
  const code = scratch();
  const ops = scratch();
  const bare = join(code, "origin.git");
  git(code, "init", "-q", "--bare", bare);
  const keep = repo(join(code, "web"), "", bare);
  const extra = join(code, "old", "web");
  mkdirSync(join(code, "old"));
  git(join(code, "old"), "clone", "-q", bare, "web");
  const dirtyClone = join(code, "older", "web");
  mkdirSync(join(code, "older"));
  git(join(code, "older"), "clone", "-q", bare, "web");
  writeFileSync(join(dirtyClone, "wip.txt"), "x");
  const scope = { ops, busy: [], cwds: [] };
  const r = applyDedupe({ keep, extra: [extra, dirtyClone] }, scope, 2000);
  expect(r.lines.some((l) => l.startsWith(`skipped ${dirtyClone}`))).toBe(true);
  expect(r.log?.id).toBe("dedupe-2000");
  // the old path is now a worktree of the kept clone (detached: its branch is checked out in the kept one)
  expect(git(keep, "worktree", "list")).toContain(extra);
  expect(existsSync(join(extra, ".git")) && lstatSync(join(extra, ".git")).isFile()).toBe(true);
  expect(existsSync(join(dirtyClone, "wip.txt"))).toBe(true);
  const back = undo(blankConfig("alex"), ops, "dedupe-2000");
  expect(back.lines).toEqual([`${extra} is a full clone again`]);
  expect(lstatSync(join(extra, ".git")).isDirectory()).toBe(true);
  // again, then free the set-aside copy
  const again = applyDedupe({ keep, extra: [extra] }, scope, 3000);
  const kept = again.log?.steps[0];
  expect(kept?.kind).toBe("worktree");
  expect(freeKept(ops, "dedupe-3000")).toHaveLength(1);
  if (kept?.kind === "worktree") expect(existsSync(kept.kept)).toBe(false);
  expect(undoLogs(ops)).toEqual([]);
});

test("a busy clone is never touched", () => {
  const code = scratch();
  const bare = join(code, "origin.git");
  git(code, "init", "-q", "--bare", bare);
  const keep = repo(join(code, "web"), "", bare);
  mkdirSync(join(code, "old"));
  git(join(code, "old"), "clone", "-q", bare, "web");
  const extra = join(code, "old", "web");
  const r = applyDedupe({ keep, extra: [extra] }, { ops: scratch(), busy: [extra], cwds: [] }, 1);
  expect(r.log).toBeNull();
  expect(lstatSync(join(extra, ".git")).isDirectory()).toBe(true);
});
