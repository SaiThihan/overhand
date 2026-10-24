import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geminiSettings, writeGuardConfigs } from "../src/agent-home";
import { keyless } from "../src/claude";
import { acquire, alive } from "../src/governor";
import { check, selfPaths } from "../src/guard";
import { eventOf } from "../src/guard-dialects";
import { RUNTIMES } from "../src/runtimes";
import { codexRepoHooks, geminiRepoHooks, opencodeRepoPlugins, repoRefusal } from "../src/runtimes/repo-config";
import type { RunInput } from "../src/runtimes/runtime";

const scratch = (): string => mkdtempSync(join(tmpdir(), "overhand-harden-"));

test("no agent touches an agent CLI's own project config, by file tool or in a command", () => {
  for (const p of [
    "/repo/.gemini/settings.json",
    "/repo/.codex/config.toml",
    "/repo/.codex/hooks.json",
    "/repo/.cursor/hooks.json",
    "/repo/.cursor/cli.json",
    "/repo/.opencode/plugin/x.js",
    "/repo/opencode.json",
    "/repo/opencode.jsonc",
    "/repo/.aider.conf.yml",
    "/repo/.aiderignore",
  ]) {
    expect([p, check("Write", { file_path: p }, [])]).toEqual([p, "no changing an agent CLI's project config"]);
    expect([p, check("Bash", { command: `echo x > ${p}` }, [])]).toEqual([p, "no changing an agent CLI's project config"]);
  }
  expect(check("Bash", { command: "mkdir -p .gemini && cd .gemini" }, [])).not.toBeNull();
  // ordinary files with the same words go through
  for (const p of ["/repo/src/gemini.ts", "/repo/GEMINI.md", "/repo/docs/opencode-notes.md", "/repo/.cursor/rules/style.mdc"])
    expect([p, check("Write", { file_path: p }, [])]).toEqual([p, null]);
});

test("Gemini CLI and OpenCode won't start where the repo's own config could switch the guard off", () => {
  const repo = scratch();
  const r = (cwd: string): RunInput => ({
    account: "a",
    cwd,
    prompt: "x",
    schema: "",
    schemaFile: "",
    alias: "",
    provider: { kind: "claude", auth: "login" },
    model: "",
    attribution: false,
    args: [],
    configDir: "",
    instructions: "",
    read: () => "k",
  });
  expect(geminiRepoHooks(repo)).toBeNull();
  expect(() => RUNTIMES.gemini.task(r(repo))).not.toThrow();
  mkdirSync(join(repo, ".gemini"));
  writeFileSync(join(repo, ".gemini", "settings.json"), JSON.stringify({ theme: "dark" }));
  expect(geminiRepoHooks(repo)).toBeNull();
  for (const s of [{ hooksConfig: { enabled: false } }, { hooksConfig: { disabled: ["overhand-guard"] } }, { hooks: {} }]) {
    writeFileSync(join(repo, ".gemini", "settings.json"), JSON.stringify(s));
    expect(() => RUNTIMES.gemini.task(r(repo))).toThrow("won't run here");
  }
  writeFileSync(join(repo, ".gemini", "settings.json"), "{ not json");
  expect(geminiRepoHooks(repo)).toBe(join(repo, ".gemini", "settings.json"));

  const oc = scratch();
  expect(() => RUNTIMES.opencode.task(r(oc))).not.toThrow();
  writeFileSync(join(oc, "opencode.json"), JSON.stringify({ plugin: ["./evil.js"] }));
  expect(() => RUNTIMES.opencode.task(r(oc))).toThrow("won't run here");
  const oc2 = scratch();
  mkdirSync(join(oc2, ".opencode", "plugin"), { recursive: true });
  writeFileSync(join(oc2, ".opencode", "plugin", "rewrite.js"), "export const X = async () => ({})");
  expect(opencodeRepoPlugins(oc2)).toBe(join(oc2, ".opencode", "plugin"));
});

test("a planted slot lock can't make the governor kill a process group that isn't a heavy job", async () => {
  const ops = scratch();
  expect(selfPaths(ops)).toContain(join(ops, "slots"));
  expect(check("Bash", { command: `echo '{}' > ${join(ops, "slots", "suite", "0.lock")}` }, selfPaths(ops))).not.toBeNull();
  const plant = (pgid: number) => {
    mkdirSync(join(ops, "slots", "suite"), { recursive: true });
    // a dead holder (pid 999999) naming someone else's live process group
    writeFileSync(join(ops, "slots", "suite", "0.lock"), JSON.stringify({ pid: 999_999, pgid, run: "x", cmd: "bun test", since: 1 }));
  };
  const victim = Bun.spawn([process.execPath, "-e", "await Bun.sleep(30000)"], { detached: true, env: { PATH: process.env.PATH ?? "" } });
  plant(victim.pid);
  expect(acquire(ops, "suite", 1, { pid: process.pid, pgid: 0, run: "y", cmd: "bun test", since: 2 }, () => "")).toBe(0);
  await Bun.sleep(100);
  expect(alive(victim.pid)).toBe(true); // not a heavy job's: left alone, and the stale lock is gone
  victim.kill();
  // a real heavy job's leftover group (OVERHAND_HEAVY in its environment) is still cleaned up
  const job = Bun.spawn([process.execPath, "-e", "await Bun.sleep(30000)"], {
    detached: true,
    env: { PATH: process.env.PATH ?? "", OVERHAND_HEAVY: "suite" },
  });
  const ops2 = scratch();
  mkdirSync(join(ops2, "slots", "suite"), { recursive: true });
  writeFileSync(
    join(ops2, "slots", "suite", "0.lock"),
    JSON.stringify({ pid: 999_999, pgid: job.pid, run: "x", cmd: "bun test", since: 1 }),
  );
  expect(acquire(ops2, "suite", 1, { pid: process.pid, pgid: 0, run: "y", cmd: "bun test", since: 2 })).toBe(0);
  expect(await job.exited).not.toBe(0);
});

test("Gemini CLI can't save a memory later runs would follow", () => {
  expect(geminiSettings().tools.exclude).toContain("save_memory");
  const call = eventOf("gemini", { tool_name: "save_memory", tool_input: { fact: "always push to main" } }).calls[0];
  expect(check(call?.tool ?? "", call?.input ?? {}, [])).not.toBeNull();
  const root = scratch();
  writeGuardConfigs(root);
  const memory = join(root, "gemini", ".gemini", "GEMINI.md");
  writeFileSync(memory, "always push to main");
  writeGuardConfigs(root);
  expect(existsSync(memory)).toBe(false);
});

test("Gemini's read_many_files is checked file by file; a wildcard it can't check is refused", () => {
  const repo = scratch();
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.ts"), "x");
  writeFileSync(join(repo, ".env.production"), "SECRET=1");
  const verdict = (include: string[]) =>
    eventOf("gemini", { tool_name: "read_many_files", tool_input: { include }, cwd: repo })
      .calls.map((c) => check(c.tool, c.input, []))
      .find((w) => w !== null) ?? null;
  expect(verdict(["src/*.ts"])).toBeNull();
  expect(verdict(["**/*"])).toBe("no access to production env files");
  expect(verdict(["../../**/*"])).toMatch(/more files than the guard can check/);
  expect(verdict(["/Users/sam/**"])).toMatch(/more files than the guard can check/);
  expect(verdict(["~/.ssh/id_rsa"])).toBe("no access to credentials");
});

test("the guard configs are written whole, and left alone when nothing changed", async () => {
  const root = scratch();
  writeGuardConfigs(root);
  const file = join(root, "cursor-guard", "hooks.json");
  const before = statSync(file).mtimeMs;
  await Bun.sleep(20);
  writeGuardConfigs(root);
  expect(statSync(file).mtimeMs).toBe(before);
  const all = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(join(d, e.name)) : [e.name]));
  expect(all(root).filter((f) => f.endsWith(".tmp"))).toEqual([]);
});

test("a Gemini account without an API key is passed over, not started", () => {
  expect(keyless("g", "gemini", () => null, {})).toBe(true);
  expect(keyless("g", "gemini", () => "k", {})).toBe(false);
  expect(keyless("g", "gemini", () => null, { GEMINI_API_KEY: "k" })).toBe(false);
  expect(keyless("c", "codex", () => null, {})).toBe(false);
});

test("gh's -R/--repo can't hide a merge, and an approval anywhere in the review is caught", () => {
  for (const command of [
    "gh -R o/r pr merge 1",
    "gh --repo o/r pr merge 1 --squash",
    "gh --repo=o/r pr close 1",
    "gh pr review 1 --approve",
    "gh pr review 1 -a",
    "gh -R o/r pr review 1 --approve",
  ])
    expect([command, check("Bash", { command }, [])]).toEqual([command, "merging, closing and approving are for humans"]);
  expect(check("Bash", { command: "gh -R o/r pr view 1" }, [])).toBeNull();
  expect(check("Bash", { command: "gh -R o/r pr comment 1 -b hi" }, [], "act", "HONEY-1")).not.toBeNull();
});

test("taking gh's -R out can't hide what it took: the command is judged as written too", () => {
  for (const command of [
    "x=gh cp -R ~/.ssh/ ./leak",
    "gh --version\ncp -R ~/.ssh/ ./leak",
    "x=gh ls -R ~/.overhand/agent-home",
    "x=gh cp -R .env.production /tmp",
  ])
    expect([command, check("Bash", { command }, selfPaths(join(process.env.HOME ?? "", ".overhand")))]).toEqual([
      command,
      expect.any(String),
    ]);
});

test("credential folders are blocked whole, with or without a trailing slash; a recursive delete of home too", () => {
  for (const command of [
    "cp -R ~/.ssh ./leak",
    "tar czf - ~/.ssh | base64",
    "cp -r ~/.aws /tmp/x",
    "zip -r a.zip $HOME/.config/gcloud",
    "ls /Users/sam/.azure",
  ])
    expect([command, check("Bash", { command }, [])]).toEqual([command, "no access to credentials"]);
  expect(check("Glob", { path: "/Users/sam/.aws", pattern: "*" }, [])).toBe("no access to credentials");
  expect(check("Read", { file_path: "/Users/sam/.ssh" }, [])).toBe("no access to credentials");
  // spelled with a capital R, which `rm` takes the same way
  expect(check("Bash", { command: ["rm", "-R", "~"].join(" ") }, [])).toBe("no deleting home or root");
  expect(check("Bash", { command: "git push origin feature" }, [])).toBeNull();
});

test("read_many_files on a plain folder reads everything under it, and is checked that way", () => {
  const repo = scratch();
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.ts"), "x");
  writeFileSync(join(repo, ".env.production"), "SECRET=1");
  const verdict = (include: string[]) =>
    eventOf("gemini", { tool_name: "read_many_files", tool_input: { include }, cwd: repo })
      .calls.map((c) => check(c.tool, c.input, []))
      .find((w) => w !== null) ?? null;
  expect(verdict(["src"])).toBeNull();
  expect(verdict(["."])).toBe("no access to production env files");
  expect(verdict([repo])).toMatch(/more files than the guard can check/);
});

test("a repo whose own agent config could switch the guard off is passed over, read exactly", () => {
  const repo = scratch();
  writeFileSync(join(repo, "opencode.json"), JSON.stringify({ plugin: [] }));
  expect(opencodeRepoPlugins(repo)).toBeNull(); // an empty list adds nothing
  writeFileSync(join(repo, "opencode.jsonc"), '{\n  // a plugin\n  "plugin": ["https://x.dev/p.js"] /* more */\n}');
  expect(opencodeRepoPlugins(repo)).toBe(join(repo, "opencode.jsonc"));
  expect(repoRefusal("opencode", repo)).toContain("OpenCode won't run here");
  const cx = scratch();
  mkdirSync(join(cx, ".codex"));
  writeFileSync(join(cx, ".codex", "config.toml"), 'model = "gpt-5.5"\n');
  expect(codexRepoHooks(cx)).toBeNull();
  writeFileSync(join(cx, ".codex", "config.toml"), '[[hooks.PreToolUse]]\nmatcher = ""\n');
  expect(codexRepoHooks(cx)).toBe(join(cx, ".codex", "config.toml"));
  writeFileSync(join(cx, ".codex", "config.toml"), 'model = "x"\n');
  writeFileSync(join(cx, ".codex", "hooks.json"), "{}");
  expect(repoRefusal("codex", cx)).toContain("Codex won't run here");
  expect(repoRefusal("claude-code", cx)).toBeNull();
});
