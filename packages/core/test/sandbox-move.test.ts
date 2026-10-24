/**
 * The move off your own agent config never breaks a run: an account stays on it until its own folder has a sign-in,
 * then moves by itself; under the enforced sandbox it waits instead of running against your config. Caches belong to
 * the project, not the run; a sandboxed run's request to your session says which run sent it.
 */
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plainWords } from "@overhand/themes";
import { AGENT_HOMES, runHome } from "../src/agent-home";
import { type Config, parseConfig, saveConfig } from "../src/config";
import { runAskNotice } from "../src/control-api";
import { finishMoves } from "../src/daemon";
import { applyConfig, CFG, OPS } from "../src/env";
import { projectCache, real, runCacheEnv, sandboxSpawn } from "../src/sandbox";

const saved: Config = CFG;
afterEach(() => applyConfig(saveConfig(OPS, saved)));

const withExisting = () =>
  parseConfig({
    ...CFG,
    accounts: [...CFG.accounts, "main"],
    providers: { ...CFG.providers, main: { kind: "claude", auth: "login", existing: "" } },
  });

test("an account on your own config stays there until its own folder has a sign-in, then moves by itself", async () => {
  applyConfig(withExisting());
  expect(runHome("main")).toBe("");
  expect(await finishMoves(async () => false)).toEqual([]);
  expect(runHome("main")).toBe("");
  expect(await finishMoves(async () => true)).toEqual(["main"]);
  expect(runHome("main")).toBe(join(AGENT_HOMES, "accounts", "main"));
  // saved, so a restart keeps it moved
  expect(parseConfig(JSON.parse(await Bun.file(join(OPS, "overhand.config.json")).text())).providers.main).toMatchObject({
    movedAt: expect.any(Number),
  });
});

test("under the enforced sandbox a run on your own config waits; off and log go ahead as before", () => {
  const run = {
    argv: ["true"],
    env: {},
    cwd: real(mkdtempSync(join(tmpdir(), "mv-"))),
    runtime: "claude-code" as const,
    run: "T-1",
    readOnly: false,
  };
  const st = (effective: "off" | "log" | "enforce") => ({ mode: effective, effective, ok: true, why: "", refuse: false });
  expect(() => sandboxSpawn({ ...run, configDir: "" }, st("enforce"), () => "")).toThrow(plainWords.movedWaitsSandbox);
  expect(() => sandboxSpawn({ ...run, configDir: "" }, st("off"), () => "")).not.toThrow();
  expect(() => sandboxSpawn({ ...run, configDir: "" }, st("log"), () => "")).not.toThrow();
  expect(() => sandboxSpawn({ ...run, configDir: join(AGENT_HOMES, "claude-code") }, st("enforce"), () => "")).not.toThrow();
});

test("a sandboxed run's caches are its project's, kept across runs; Maven, Gradle and Composer included", () => {
  const cache = projectCache("App", OPS);
  const env = runCacheEnv("/t", cache, { MAVEN_OPTS: "-Xmx1g" });
  expect(env.BUN_INSTALL_CACHE_DIR).toBe(join(cache, "bun"));
  expect(env.GRADLE_USER_HOME).toBe(join(cache, "gradle"));
  expect(env.COMPOSER_CACHE_DIR).toBe(join(cache, "composer"));
  expect(env.MAVEN_OPTS).toBe(`-Xmx1g -Dmaven.repo.local=${join(cache, "m2")}`);
  const st = { mode: "enforce" as const, effective: "enforce" as const, ok: true, why: "", refuse: false };
  const cwd = real(mkdtempSync(join(tmpdir(), "mv-")));
  const s = sandboxSpawn(
    { argv: ["true"], env: { OVERHAND_PROJECT: "App" }, cwd, runtime: "cursor", configDir: "", run: "T-2", readOnly: false },
    st,
    () => "",
  );
  mkdirSync(join(cache, "bun", "pkg"), { recursive: true });
  s.done(Date.now());
  expect(existsSync(join(cache, "bun", "pkg"))).toBe(true); // the project's cache outlives the run
  expect(s.env.TMPDIR?.startsWith(join(tmpdir(), "overhand-run-")) || s.env.TMPDIR?.includes("overhand-run-")).toBe(true);
});

test("a sandboxed run's request to your own session says it came from a sandboxed run, and which", () => {
  const n = runAskNotice("HONEY-12", "main", "stop the dev server");
  expect(n.title).toContain("sandboxed agent run");
  expect(n.title).toContain("HONEY-12");
  expect(n.body).toContain("sandboxed agent run HONEY-12");
  expect(n.body).toContain("stop the dev server");
});
