/**
 * The third review's findings: the MCP list a run gets (your servers' tokens in it) lives in a private folder, written
 * exclusively and removed after; a run on watch gets none of your servers; the daemon's checks and cleanup key a
 * project's cache the same way runs do, and cleanup leaves it alone while one of those checks runs.
 */
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { liveProjects } from "../src/cleanup";
import { runCacheKey } from "../src/cleanup-sources";
import { CLIENTS } from "../src/env";
import { claudeCode, writeRunFiles } from "../src/runtimes/claude-code";
import type { RunInput } from "../src/runtimes/runtime";
import { checksDir, projectCommand, real } from "../src/sandbox";

const input = (over: Partial<RunInput> = {}): RunInput => ({
  ...{ account: "main", cwd: "/x", prompt: "p", schema: "{}", schemaFile: "/tmp/s.json", alias: "", model: "", attribution: false },
  ...{
    args: [],
    configDir: "/ops/agent-home/claude-code",
    instructions: "",
    read: () => null,
    provider: { kind: "claude", auth: "login" },
  },
  mcpServers: { linear: { command: "linear-mcp", env: { TOKEN: "secret" } } },
  ...over,
});
const mcpFile = (argv: string[]) => argv[argv.indexOf("--mcp-config") + 1] ?? "";

test("the MCP list sits in a private folder of its own, is written exclusively and 0600, and goes with its folder", () => {
  const s = claudeCode.task(input());
  const file = mcpFile(s.argv);
  expect(basename(dirname(file))).toStartWith("overhand-mcp-");
  expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
  const remove = writeRunFiles(s.files);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  remove();
  expect(existsSync(dirname(file))).toBe(false);
  // something planted at the path first (a link to elsewhere) is never written through
  const again = claudeCode.task(input());
  const planted = mcpFile(again.argv);
  const elsewhere = join(mkdtempSync(join(tmpdir(), "elsewhere-")), "x");
  symlinkSync(elsewhere, planted);
  expect(() => writeRunFiles(again.files)).toThrow();
  expect(existsSync(elsewhere)).toBe(false);
});

test("a run on watch starts none of your MCP servers; tasks and leads get yours", () => {
  const watch = claudeCode.task(input({ autonomy: "watch" }));
  expect(JSON.parse(watch.files[mcpFile(watch.argv)] ?? "{}")).toEqual({ mcpServers: {} });
  const act = claudeCode.lead(input());
  expect(Object.keys(JSON.parse(act.files[mcpFile(act.argv)] ?? "{}").mcpServers)).toEqual(["linear"]);
});

test("the daemon's checks key a project's cache by its config name, and cleanup skips it while one runs", () => {
  const c = CLIENTS[0];
  if (!c) throw new Error("the example config has a project");
  const ops = real(mkdtempSync(join(tmpdir(), "checks-")));
  const st = { mode: "enforce" as const, effective: "enforce" as const, ok: true, why: "", refuse: false };
  const cwd = real(mkdtempSync(join(tmpdir(), "repo-")));
  const box = projectCommand(["true"], cwd, st, c.name, ops);
  expect(box.argv.join(" ")).toContain(join(ops, "run-caches", runCacheKey(c.name)));
  expect(liveProjects(ops).has(runCacheKey(c.name))).toBe(true);
  box.done();
  expect(liveProjects(ops).has(runCacheKey(c.name))).toBe(false);
  // a check marker of a process that's gone doesn't count
  mkdirSync(checksDir(ops), { recursive: true });
  writeFileSync(join(checksDir(ops), `${runCacheKey(c.name)}.999999.1`), "");
  expect(liveProjects(ops).has(runCacheKey(c.name))).toBe(false);
});
