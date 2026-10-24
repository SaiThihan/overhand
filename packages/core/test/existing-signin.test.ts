import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existingHome, finishMove, inboxHome, ownSignInHome, pendingMove, runHome } from "../src/agent-home";
import { blankConfig, saveConfig } from "../src/config";
import { configFromSetup, geminiGoogleLogin, SetupSchema } from "../src/onboard";
import { RUNTIMES } from "../src/runtimes";
import { existingClaudeSignIn } from "../src/runtimes/claude-code";
import type { RunInput } from "../src/runtimes/runtime";

/**
 * A fake `claude` for a fixture home: `auth status` exits 0 only where a marker says Claude Code is signed in, the way
 * the real one keys its login to CLAUDE_CONFIG_DIR (or to its being unset). It logs each config folder it was asked about.
 */
function fakeClaude(signedIn: { unset?: boolean; dirs?: string[] }): { bin: string; asked: string } {
  const fixture = mkdtempSync(join(tmpdir(), "existing-claude-"));
  const asked = join(fixture, "asked");
  const dirs = (signedIn.dirs ?? []).map((d) => `[ "$CLAUDE_CONFIG_DIR" = '${d}' ] && exit 0`).join("\n");
  const script = [
    "#!/bin/sh",
    `echo "\${CLAUDE_CONFIG_DIR-<unset>}" >> '${asked}'`,
    `[ -z "\${CLAUDE_CONFIG_DIR+x}" ] && exit ${signedIn.unset ? 0 : 1}`,
    dirs,
    "exit 1",
  ].join("\n");
  const bin = join(fixture, "claude");
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return { bin, asked };
}

test("the Claude Code in your terminal counts as signed in when Claude Code says so, with the variable left unset", async () => {
  const yes = fakeClaude({ unset: true });
  expect(await existingClaudeSignIn({}, "/ops/agent-home", yes.bin)).toBe("");
  // a CLAUDE_CONFIG_DIR you set is asked about as is
  const custom = fakeClaude({ dirs: ["/me/claude-work"] });
  expect(await existingClaudeSignIn({ CLAUDE_CONFIG_DIR: "/me/claude-work" }, "/ops/agent-home", custom.bin)).toBe("/me/claude-work");
  expect(await existingClaudeSignIn({}, "/ops/agent-home", fakeClaude({}).bin)).toBeNull();
  // one of Overhand's own folders is never "yours"
  const own = fakeClaude({ dirs: ["/ops/agent-home/accounts/main"] });
  expect(await existingClaudeSignIn({ CLAUDE_CONFIG_DIR: "/ops/agent-home/accounts/main" }, "/ops/agent-home", own.bin)).toBeNull();
  // not installed
  expect(await existingClaudeSignIn({}, "/ops/agent-home", "/nonexistent/claude")).toBeNull();
});

test("setup's first account points at the sign-in you already have; accounts added later keep folders of their own", () => {
  const base = blankConfig("me");
  const setup = SetupSchema.parse({ owner: "Me", codeRoot: "/code", credential: { kind: "login", value: "" } });
  const dir = mkdtempSync(join(tmpdir(), "existing-setup-"));
  const c = saveConfig(dir, configFromSetup(setup, base, ""));
  expect(c.providers.main).toEqual({ kind: "claude", auth: "login", existing: "" });
  expect(existingHome("main", c)).toBe("");
  // it signs in once in a folder of its own; until then its runs stay on your config, nothing breaks
  expect(ownSignInHome("main", c, "/h")).toBe("/h/accounts/main");
  expect(pendingMove("main", c)).toBe(true);
  expect(runHome("main", c, "/h")).toBe("");
  // signed in there: runs move, the Slack inbox stays on your config until Slack is signed in there too
  const moved = finishMove(c, "main", 5);
  expect(moved.providers.main).toEqual({ kind: "claude", auth: "login", existing: "", movedAt: 5 });
  expect(pendingMove("main", moved)).toBe(false);
  expect(runHome("main", moved, "/h")).toBe("/h/accounts/main");
  expect(inboxHome("main", moved, "/h")).toBe("");
  const slack = {
    ...moved,
    providers: { main: { kind: "claude" as const, auth: "login" as const, existing: "", movedAt: 5, slackMoved: true } },
  };
  expect(inboxHome("main", slack, "/h")).toBe("/h/accounts/main");
  // without one: today's own folder, no provider written
  expect(configFromSetup(setup, base)).toMatchObject({ providers: {} });
  const two = saveConfig(dir, { ...c, accounts: ["main", "work"] });
  expect(existingHome("work", two)).toBeUndefined();
  expect(ownSignInHome("work", two, "/h")).toBe("/h/accounts/work");
  // a CLAUDE_CONFIG_DIR of your own is kept as the folder
  expect(saveConfig(dir, configFromSetup(setup, base, "/me/claude-work")).providers.main).toMatchObject({ existing: "/me/claude-work" });
  // another agent CLI ignores it
  expect(configFromSetup({ ...setup, agent: "codex" }, base, "")).toMatchObject({ providers: {} });
});

test("a run on your own Claude Code config leaves it alone: no variable, no files, guard and instructions by flag", () => {
  const input: RunInput = {
    account: "main",
    cwd: "",
    prompt: "Fix it",
    schema: "{}",
    schemaFile: "/tmp/s.json",
    alias: "",
    provider: { kind: "claude", auth: "login", existing: "" },
    model: "",
    attribution: false,
    args: [],
    configDir: "",
    mcpServers: {},
    hooks: { PreToolUse: [] },
    instructions: "/ops/agent-home/claude-code/CLAUDE.md",
    read: () => null,
  };
  const s = RUNTIMES["claude-code"].task(input);
  expect(s.env.CLAUDE_CONFIG_DIR).toBeUndefined();
  // only Overhand's strict list of MCP servers, none for this run: nothing written to your config
  expect(Object.values(s.files)).toEqual(['{"mcpServers":{}}']);
  expect(Object.keys(s.files).every((f) => !f.startsWith("/ops/"))).toBe(true);
  expect(s.argv.join(" ")).toContain("--append-system-prompt-file /ops/agent-home/claude-code/CLAUDE.md");
  const settings = s.argv[s.argv.indexOf("--settings") + 1] ?? "";
  expect(JSON.parse(settings)).toMatchObject({ hooks: { PreToolUse: [] } });
  // a folder of your own: set as is, and still nothing written into it
  const custom = RUNTIMES["claude-code"].task({ ...input, configDir: "/me/claude-work" });
  expect(custom.env.CLAUDE_CONFIG_DIR).toBe("/me/claude-work");
  expect(Object.values(custom.files)).toEqual(['{"mcpServers":{}}']);
});

test("a cached Gemini CLI Google sign-in is noticed by its file alone", () => {
  const home = mkdtempSync(join(tmpdir(), "existing-gemini-"));
  expect(geminiGoogleLogin(home)).toBe(false);
  mkdirSync(join(home, ".gemini"));
  writeFileSync(join(home, ".gemini", "oauth_creds.json"), "{}");
  expect(geminiGoogleLogin(home)).toBe(true);
  expect(readdirSync(join(home, ".gemini"))).toEqual(["oauth_creds.json"]);
});
