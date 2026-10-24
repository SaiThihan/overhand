import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkup, ciOf, ciTask, prsWaiting, stackOf, staleBranches, todoHotspot } from "../src/checkup";
import type { Client } from "../src/config";
import { clientOfRepo } from "../src/firstwin";

const DAY = 864e5;

/** A fixture git repo from relative path → contents, with one commit. */
function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "checkup-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return dir;
}

test("stackOf names the language, framework and package manager from what's there", () => {
  expect(stackOf(["package.json", "tsconfig.json", "bun.lock"], { next: "15.0.0", react: "19.0.0" })).toBe("TypeScript · Next.js · bun");
  expect(stackOf(["package.json", "pnpm-lock.yaml"], { vue: "3" })).toBe("JavaScript · Vue · pnpm");
  expect(stackOf(["go.mod"])).toBe("Go");
  expect(stackOf(["pyproject.toml"])).toBe("Python");
  expect(stackOf(["notes.txt"])).toBe("");
});

test("ciOf sees workflows and other CI configs", () => {
  expect(ciOf([], ["ci.yml"])).toBe(true);
  expect(ciOf([".gitlab-ci.yml"], [])).toBe(true);
  expect(ciOf(["README.md"], ["notes.md"])).toBe(false);
});

test("staleBranches keeps the default and current branch, and recent ones", () => {
  const now = 1_800_000_000_000;
  const at = (days: number) => Math.round((now - days * DAY) / 1000);
  const refs = [`main ${at(400)}`, `old-spike ${at(200)}`, `fresh ${at(3)}`, `wip ${at(120)}`].join("\n");
  expect(staleBranches(refs, ["main", "wip"], now)).toEqual(["old-spike"]);
});

test("todoHotspot picks the file with the most marks, at least five, outside builds", () => {
  expect(todoHotspot("src/a.ts:3\nsrc/b.ts:9\nsrc/c.ts:6\ndist/x.js:40")).toEqual({ path: "src/b.ts", n: 9 });
  expect(todoHotspot("src/a.ts:4")).toBeNull();
  expect(todoHotspot("")).toBeNull();
});

test("prsWaiting counts open PRs and the quiet ones", () => {
  const now = Date.parse("2026-10-20T00:00:00Z");
  const json = JSON.stringify([{ updatedAt: "2026-10-19T00:00:00Z" }, { updatedAt: "2026-09-01T00:00:00Z" }]);
  expect(prsWaiting(json, now)).toEqual({ open: 2, quiet: 1 });
  expect(prsWaiting("not json", now)).toBeNull();
});

test("ciTask wires the repo's own scripts", () => {
  const t = ciTask("app", { test: "vitest", lint: "biome check .", dev: "vite" });
  expect(t.kind).toBe("ci");
  expect(t.brief).toContain("`lint`, `test`");
  expect(t.brief).not.toContain("dev");
});

test("a bare repo: no README, no CI, no CONTRIBUTING, no tests, a TODO hot spot, each with a task where an agent can help", async () => {
  const dir = repo({
    "package.json": JSON.stringify({ name: "app", scripts: { build: "tsc" }, dependencies: { react: "19.0.0" } }),
    "src/app.ts": Array.from({ length: 6 }, (_, i) => `// TODO: thing ${i}`).join("\n"),
  });
  const r = await checkup(dir, Date.now() + 10_000);
  const ids = r.findings.map((f) => f.id);
  expect(r.stack).toBe("JavaScript · React");
  expect(ids).toEqual(expect.arrayContaining(["readme", "ci", "contributing", "tests", "todo"]));
  expect(r.findings.find((f) => f.id === "readme")?.task?.kind).toBe("readme");
  expect(r.findings.find((f) => f.id === "todo")?.title).toBe("6 TODOs in src/app.ts: work left unfinished");
  expect(r.findings.find((f) => f.id === "tests")?.task).toBeNull();
  // every finding with a task has its full brief behind it, and none without
  for (const f of r.findings) expect(Boolean(r.tasks[f.id])).toBe(f.task !== null);
  // worst first
  expect(r.findings.at(-1)?.tone).not.toBe("bad");
});

test("a tidy repo says what's fine", async () => {
  const dir = repo({
    "README.md":
      "# App\n\nA small app that books rooms for the clinic and sends reminders to patients the day before.\n\n## Install\n\n`npm install`\n",
    "CONTRIBUTING.md": "# Contributing\n",
    ".github/workflows/ci.yml": "on: push\n",
    "package.json": JSON.stringify({ name: "app", scripts: { test: "vitest" } }),
  });
  const r = await checkup(dir, Date.now() + 10_000);
  expect(r.findings.filter((f) => f.task)).toEqual([]);
  expect(r.findings.find((f) => f.id === "readme")?.tone).toBe("ok");
});

test("clientOfRepo finds the project whose folder holds the repo", () => {
  const c = (name: string, dir: string) => ({ name, dir }) as Client;
  const clients = [c("Acme", "acme"), c("Acme Labs", "acme-labs")];
  expect(clientOfRepo("/code/acme-labs/web", clients, "/code")?.name).toBe("Acme Labs");
  expect(clientOfRepo("/code/acme", clients, "/code")?.name).toBe("Acme");
  expect(clientOfRepo("/code/other/web", clients, "/code")).toBeUndefined();
});
