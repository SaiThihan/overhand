/**
 * The review's findings on the agent sandbox, each held here: git can't be pointed elsewhere for the daemon to obey,
 * an outbox can't be used to read or remove anything outside it, a run's heartbeats are held to the run, its caches
 * and its agent's MCP servers don't outlive it, Codex on watch keeps its own read-only sandbox, and the usage probe
 * starts no MCP server.
 */
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROBE_ARGV } from "../src/claude";
import { type Beat, beatOf, forgetRun, ingestOutboxes, outboxDir, recordSpawn, saveBeat } from "../src/control";
import { gitRefused, OPS, sh } from "../src/env";
import { claudeCode } from "../src/runtimes/claude-code";
import type { RunInput } from "../src/runtimes/runtime";
import { gitPointers, real, sandboxPolicy, sandboxSpawn } from "../src/sandbox";

const scratch = () => real(mkdtempSync(join(tmpdir(), "overhand-review-")));
const git = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdout: "ignore", stderr: "ignore" });
const beat = (id: string, run: string, pid = 0, cwd = "/x"): Beat => ({
  ...{ id, run, project: "", pid, cwd, home: "", transcript: "", startedAt: 1, lastAt: 1, lastTool: "" },
  ...{ files: [], rulesSeen: "", prs: [] },
});

test("the daemon's git never runs a repo's fsmonitor or hooks", () => {
  const repo = scratch();
  git(repo, "init", "-q");
  const fired = join(repo, "fired");
  git(repo, "config", "core.fsmonitor", `touch ${fired}; false`);
  git(repo, "config", "core.hooksPath", join(repo, "hooks"));
  sh(["git", "status"], repo);
  expect(existsSync(fired)).toBe(false);
  // the same command without the daemon's settings does run it: the check is real
  Bun.spawnSync(["git", "status"], { cwd: repo, stdout: "ignore", stderr: "ignore" });
  expect(existsSync(fired)).toBe(true);
});

test("a run that changes where git finds its repository gets that checkout refused for the daemon's git", () => {
  const root = scratch();
  const repo = join(root, "app");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "commit", "-q", "--allow-empty", "-m", "i");
  const wt = join(root, "wt");
  git(repo, "worktree", "add", "-q", "-b", "f", wt);
  const gitDir = join(repo, ".git", "worktrees", "wt");
  const before = gitPointers(wt, gitDir);
  const st = { mode: "off" as const, effective: "off" as const, ok: true, why: "", refuse: false };
  const run = sandboxSpawn({ argv: ["true"], env: {}, cwd: wt, runtime: "codex", configDir: "", run: "T-5", readOnly: false }, st, () =>
    join(repo, ".git"),
  );
  writeFileSync(join(wt, ".git"), `gitdir: ${join(root, "evil")}\n`);
  expect(gitPointers(wt, gitDir)).not.toBe(before);
  run.done(Date.now());
  expect(gitRefused(wt)).toBe(true);
  expect(sh(["git", "status"], wt).err).toContain("Overhand runs no git here");
  expect(gitRefused(repo)).toBe(false);
});

test("the policy keeps where git finds the repository and a checkout's other worktrees out of a run's reach", () => {
  const root = scratch();
  const common = join(root, "app", ".git");
  const wt = join(root, "app", ".claude", "worktrees", "T-1");
  mkdirSync(join(common, "modules", "lib"), { recursive: true });
  const base = { gitCommon: common, runtime: "claude-code" as const, configDir: join(root, "h"), run: "T-1", readOnly: false };
  const ticket = sandboxPolicy({ ...base, cwd: wt, gitDir: join(common, "worktrees", "T-1") }, root, join(root, "ops"));
  for (const p of [join(wt, ".git"), join(common, "worktrees", "T-1", "commondir"), join(common, "worktrees", "T-1", "gitdir")])
    expect(ticket.deny).toContain(real(p));
  const lead = sandboxPolicy({ ...base, cwd: join(root, "app"), gitDir: common }, root, join(root, "ops"));
  for (const p of [join(common, "worktrees"), join(common, "modules", "lib", "config"), join(common, "modules", "lib", "hooks")])
    expect(lead.deny).toContain(real(p));
});

test("an outbox swapped for a symlink, or holding symlinks or huge files, is never followed, read or cleared", () => {
  const ops = scratch();
  const log = join(ops, "guardrails.jsonl");
  saveBeat(ops, beat("yours", ""));
  const realSessions = join(ops, "control", "sessions");
  const box = outboxDir(ops, "T-1");
  // the box itself a symlink to Overhand's own sessions
  mkdirSync(join(ops, "from-runs"), { recursive: true });
  symlinkSync(join(ops, "control"), box);
  ingestOutboxes(ops, log);
  expect(existsSync(join(realSessions, "yours.json"))).toBe(true);
  // inside a real box: a symlinked log and an oversized one
  const box2 = outboxDir(ops, "T-2");
  mkdirSync(box2);
  writeFileSync(log, "keep\n");
  symlinkSync(log, join(box2, "guardrails.jsonl"));
  ingestOutboxes(ops, log);
  expect(readFileSync(log, "utf8")).toBe("keep\n");
  const box3 = outboxDir(ops, "T-3");
  mkdirSync(join(box3, "control"), { recursive: true });
  symlinkSync(realSessions, join(box3, "control", "sessions"));
  ingestOutboxes(ops, log);
  expect(existsSync(join(realSessions, "yours.json"))).toBe(true);
  const box4 = outboxDir(ops, "T-4");
  mkdirSync(box4);
  writeFileSync(join(box4, "guardrails.jsonl"), "x".repeat(1_100_000));
  ingestOutboxes(ops, log);
  expect(readFileSync(log, "utf8")).toBe("keep\n");
});

test("a run's heartbeat is held to the process and folder Overhand started it with", () => {
  const ops = OPS;
  recordSpawn(ops, { pid: process.pid, exited: new Promise(() => {}) }, { OVERHAND_RUN: "T-8" }, true, "/code/app/wt");
  saveBeat(outboxDir(ops, "T-8"), beat("s-t8", "T-8", 1, "/"));
  ingestOutboxes(ops, join(ops, "guardrails.jsonl"));
  expect(beatOf(ops, "s-t8")).toMatchObject({ pid: process.pid, cwd: "/code/app/wt" });
  forgetRun(ops, process.pid);
});

test("every Claude Code run takes its MCP servers strictly from Overhand, so none left in .claude.json starts", () => {
  const base: RunInput = {
    ...{ account: "main", cwd: "/x", prompt: "p", schema: "{}", schemaFile: "/tmp/s.json", alias: "", model: "", attribution: false },
    ...{
      args: [],
      configDir: "/ops/agent-home/claude-code",
      instructions: "",
      read: () => null,
      provider: { kind: "claude", auth: "login" },
    },
  };
  for (const r of [base, { ...base, configDir: "" }, { ...base, mcpServers: { linear: { command: "x" } } }]) {
    for (const spawn of [claudeCode.task(r), claudeCode.lead(r)]) {
      expect(spawn.argv).toContain("--strict-mcp-config");
      const file = spawn.argv[spawn.argv.indexOf("--mcp-config") + 1] ?? "";
      expect(JSON.parse(spawn.files[file] ?? "null")).toEqual({ mcpServers: r.mcpServers ?? {} });
    }
  }
  // a run that names its own servers strictly (the inbox) keeps to those
  expect(
    claudeCode
      .task({ ...base, args: ["--mcp-config", "slack.json", "--strict-mcp-config"] })
      .argv.filter((a) => a === "--strict-mcp-config"),
  ).toHaveLength(1);
});

test("Codex on watch runs under our sandbox, its project read-only, and waits under enforce like any run", () => {
  const root = scratch();
  const p = sandboxPolicy(
    { cwd: root, gitCommon: "", gitDir: "", runtime: "codex", configDir: join(root, "h"), run: "W-1", readOnly: true },
    join(root, "home"),
    join(root, "ops"),
  );
  expect(p.write).not.toContain(real(root));
  const st = { mode: "enforce" as const, effective: "enforce" as const, ok: true, why: "", refuse: false };
  const run = { argv: ["codex"], env: {}, cwd: root, runtime: "codex" as const, run: "W-1", readOnly: true };
  expect(() => sandboxSpawn({ ...run, configDir: "" }, st, () => "")).toThrow();
});

test("the usage probe starts no MCP server and no tool", () => {
  expect(PROBE_ARGV).toContain("--strict-mcp-config");
  expect(PROBE_ARGV.slice(PROBE_ARGV.indexOf("--mcp-config") + 1)[0]).toBe('{"mcpServers":{}}');
  expect(PROBE_ARGV.slice(PROBE_ARGV.indexOf("--tools") + 1)[0]).toBe("");
});

test("the policy hides browser profiles and locks the outbox's own entry", () => {
  const root = scratch();
  const p = sandboxPolicy(
    { cwd: root, gitCommon: "", gitDir: "", runtime: "cursor", configDir: "", run: "T-1", readOnly: false },
    root,
    join(root, "ops"),
  );
  // Linux browsers from snap and flatpak too
  for (const b of ["snap/chromium", "snap/firefox", ".var/app/org.mozilla.firefox", ".var/app/com.google.Chrome"])
    expect(p.hide).toContain(real(join(root, b)));
  // no shared temp folder is the run's to write: it gets its own
  for (const t of ["/tmp", "/private/tmp", real(tmpdir())]) expect(p.write).not.toContain(t);
  expect(p.hide).toContain(real(join(root, "Library", "Application Support", "Google", "Chrome")));
  expect(p.hide).toContain(real(join(root, ".mozilla")));
  expect(p.lock).toContain(real(outboxDir(join(root, "ops"), "T-1")));
  expect(p.deny).toContain(real(join(root, ".cursor", "extensions")));
});
