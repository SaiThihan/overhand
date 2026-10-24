import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_HOMES } from "../src/agent-home";
import type { Config } from "../src/config";
import { applyConfig, CFG } from "../src/env";
import { hostTool, projectSandbox, real, SANDBOX_TOOL, sandboxSpawn, sandboxState } from "../src/sandbox";

const before = structuredClone(CFG);
afterAll(() => applyConfig(before));

const fine = () => ({ ok: true, why: "" });
const broken = () => ({ ok: false, why: "no" });

test("a project set to off runs on the guard only while the sandbox is on, never past a required one", () => {
  for (const project of [undefined, "inherit", "off"] as const)
    for (const mode of ["off", "log", "enforce"] as const)
      for (const required of [false, true]) {
        const st = sandboxState({ mode, required, project }, "darwin", fine);
        const out = project === "off" && mode !== "off" && !required;
        expect(st.guardOnly === true, `${project} ${mode} ${required}`).toBe(out);
        expect(st.effective, `${project} ${mode} ${required}`).toBe(out ? "off" : mode);
      }
  // required and the sandbox can't run: the project set to off still doesn't start
  expect(sandboxState({ mode: "enforce", required: true, project: "off" }, "linux", broken)).toMatchObject({ refuse: true });
  // not required: it runs on the guard only without even probing
  expect(sandboxState({ mode: "enforce", required: false, project: "off" }, "darwin", broken)).toMatchObject({
    refuse: false,
    guardOnly: true,
  });
});

test("Xcode, Swift packages and firebase-tools are found at a project's top or two folders down; nothing else is", () => {
  const dir = (files: string[]) => {
    const root = real(mkdtempSync(join(tmpdir(), "overhand-host-")));
    for (const f of files) {
      mkdirSync(join(root, f, ".."), { recursive: true });
      if (f.endsWith(".xcodeproj")) mkdirSync(join(root, f));
      else writeFileSync(join(root, f), "");
    }
    return root;
  };
  expect(hostTool(dir(["Package.swift"]))).toBe("Xcode");
  expect(hostTool(dir(["app/ios/App.xcodeproj"]))).toBe("Xcode");
  expect(hostTool(dir(["web/firebase.json"]))).toBe("firebase-tools");
  expect(hostTool(dir(["package.json", "node_modules/x/Package.swift", ".build/a/Package.swift"]))).toBe("");
  expect(hostTool(dir(["a/b/c/Package.swift"]))).toBe("");
  expect(hostTool(join(tmpdir(), "overhand-no-such-dir"))).toBe("");
});

test("under enforce, a project set to off spawns without the sandbox while another project still gets it", () => {
  const cwd = real(mkdtempSync(join(tmpdir(), "overhand-sbp-")));
  const ops = join(cwd, "ops");
  const s = {
    cwd,
    runtime: "claude-code" as const,
    configDir: join(AGENT_HOMES, "claude-code"),
    run: "T-2",
    readOnly: false,
    argv: ["claude", "-p", "hi"],
    env: { PATH: "/usr/bin" },
  };
  const off = sandboxSpawn(s, sandboxState({ mode: "enforce", required: false, project: "off" }, "darwin", fine), () => "", ops);
  expect(off).toMatchObject({ argv: s.argv, sandboxed: false, guardOnly: true });
  const on = sandboxSpawn(s, sandboxState({ mode: "enforce", required: false, project: "inherit" }, "darwin", fine), () => "", ops);
  expect(on).toMatchObject({ sandboxed: true, guardOnly: false });
  if (process.platform === "darwin") expect(on.argv[0]).toBe(SANDBOX_TOOL.darwin ?? "");
  expect(on.argv.slice(-3)).toEqual(s.argv);
  on.done(Date.now());
  off.done(Date.now());
});

test("each spawn site asks by project name: the config's setting for that project decides", () => {
  const client: Config["clients"][number] = {
    name: "Mac app",
    dir: "mac-app",
    prefix: "MAC",
    host: "github",
    aliases: [],
    sandbox: "off",
    status: { vercelSecrets: [], sentrySecrets: [] },
  };
  applyConfig({ ...CFG, sandbox: { mode: "enforce", required: false }, clients: [...CFG.clients, client] });
  expect(projectSandbox("Mac app")).toMatchObject({ effective: "off", guardOnly: true });
  applyConfig({ ...CFG, sandbox: { mode: "enforce", required: true } });
  expect(projectSandbox("Mac app").guardOnly).toBeUndefined();
});
