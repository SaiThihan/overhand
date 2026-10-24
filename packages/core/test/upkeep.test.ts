import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { shAsync } from "../src/env";
import type { Run } from "../src/ship";
import { bunTable, isTest, npmJson, pipJson, repoTodos, repoUntested, repoUpdates, updateLevel, upkeepLists } from "../src/status/upkeep";

/** A folder with these files; with `commits`, a git repo whose history touches each path that many times. */
function fixture(files: Record<string, string>, commits: Record<string, number> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "upkeep-"));
  const put = (path: string, body: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  };
  for (const [path, body] of Object.entries(files)) put(path, body);
  if (!Object.keys(commits).length) return dir;
  const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  for (const [path, n] of Object.entries(commits))
    for (let i = 0; i < n; i++) {
      put(path, `${files[path] ?? ""}\n// ${i}`);
      git("commit", "-q", "-am", `touch ${path} ${i}`);
    }
  return dir;
}

/** A package manager that answers from a script, never the network: each command's output by its first word. */
const fake =
  (answers: Record<string, string>, seen: string[][] = []): Run =>
  async (cmd) => {
    seen.push(cmd);
    const out = answers[cmd[0]?.split("/").pop() ?? ""] ?? "";
    // npm outdated exits 1 when it finds something
    return { ok: !out, out, err: "" };
  };

test("updateLevel: a change in the first number is major, and so is the second while it's 0.x", () => {
  expect(updateLevel("1.2.3", "1.2.4")).toBe("patch");
  expect(updateLevel("1.2.3", "1.4.0")).toBe("minor");
  expect(updateLevel("1.2.3", "2.0.0")).toBe("major");
  expect(updateLevel("0.3.1", "0.4.0")).toBe("major");
  expect(updateLevel("^1.2.3", "v1.2.9")).toBe("patch");
  expect(updateLevel("1.2.3", "1.2.3")).toBeNull();
  expect(updateLevel("2.0.0", "1.9.0")).toBeNull();
});

test("each package manager's own list, read without installing: patch and minor to take, a major to list", () => {
  const table = [
    "bun outdated v1.3.11",
    "|---------------------------------------------------|",
    "| Package               | Current | Update | Latest |",
    "|-----------------------|---------|--------|--------|",
    "| zod                   | 4.1.5   | 4.1.12 | 4.1.12 |",
    "|-----------------------|---------|--------|--------|",
    "| next (dev)            | 15.5.4  | 15.5.6 | 16.0.1 |",
    "|-----------------------|---------|--------|--------|",
    "| react                 | 19.0.0  | 19.0.0 | 20.0.0 |",
    "|---------------------------------------------------|",
  ].join("\n");
  expect(bunTable(table).map((u) => [u.package, u.next, u.update])).toEqual([
    ["zod", "4.1.12", "patch"],
    // the latest is a major, so it takes the newest its range allows
    ["next", "15.5.6", "patch"],
    ["react", "20.0.0", "major"],
  ]);
  const npm = JSON.stringify({ vite: { current: "6.1.0", wanted: "6.3.0", latest: "6.3.0" }, nope: { wanted: "1.0.0", latest: "1.0.0" } });
  // a package that isn't installed has no current version: nothing to say about it
  expect(npmJson("npm", npm)).toEqual([{ manager: "npm", package: "vite", current: "6.1.0", next: "6.3.0", update: "minor" }]);
  expect(npmJson("npm", "not json")).toEqual([]);
  const pip = JSON.stringify([
    { name: "Django", version: "5.1.0", latest_version: "5.1.4" },
    { name: "sqlparse", version: "0.5.0", latest_version: "0.5.3" },
  ]);
  // only what the repo names itself: sqlparse came with Django
  expect(pipJson(pip, new Set(["django"])).map((u) => u.package)).toEqual(["Django"]);
});

test("repoUpdates asks the repo's own package manager by its lockfile, and pip only where there's a virtualenv", async () => {
  const seen: string[][] = [];
  const npm = JSON.stringify({ vite: { current: "6.1.0", wanted: "6.3.0", latest: "6.3.0" } });
  const pip = JSON.stringify([{ name: "requests", version: "2.31.0", latest_version: "2.32.3" }]);
  const both = fixture({ "package-lock.json": "{}", ".venv/bin/pip": "", "requirements.txt": "requests>=2\n" });
  const got = await repoUpdates(both, fake({ npm, pip }, seen));
  expect(got.map((u) => `${u.manager} ${u.package} ${u.next}`)).toEqual(["npm vite 6.3.0", "pip requests 2.32.3"]);
  expect(seen.map((c) => c.slice(1).join(" "))).toEqual(["outdated --json", "list --outdated --format json"]);
  // no lockfile and no virtualenv: nothing is run, nothing is found
  const none: string[][] = [];
  expect(await repoUpdates(fixture({ "package.json": "{}" }), fake({}, none))).toEqual([]);
  expect(none).toEqual([]);
});

test("repoUntested: the most-changed source files that no test names, and none in a repo without tests", async () => {
  const run: Run = (cmd, cwd) => shAsync(cmd, cwd, 15_000);
  const files = {
    "src/cart.ts": "export const total = 1;",
    "src/pay.ts": "export const pay = 1;",
    "src/ship.ts": "export const ship = 1;",
    "src/util/index.ts": "export const u = 1;",
    "src/cart.test.ts": "import { total } from './cart';",
    "test/helpers.ts": "import { u } from '../src/util';",
    "README.md": "hi",
  };
  const dir = fixture(files, { "src/pay.ts": 3, "src/cart.ts": 2, "src/ship.ts": 1, "src/util/index.ts": 2, "README.md": 4 });
  // cart has its own test file and util is imported by one; the README isn't source
  expect(await repoUntested(dir, run)).toEqual([
    { path: "src/pay.ts", n: 4 },
    { path: "src/ship.ts", n: 2 },
  ]);
  const bare = fixture({ "src/pay.ts": "export const pay = 1;" }, { "src/pay.ts": 3 });
  expect(await repoUntested(bare, run)).toEqual([]);
  expect(isTest("pkg/cart_test.go")).toBe(true);
  expect(isTest("app/test_cart.py")).toBe(true);
  expect(isTest("src/contest.ts")).toBe(false);
});

test("repoTodos counts TODO notes the way the check-up does, most first; a repo with none has none", async () => {
  const run: Run = (cmd, cwd) => shAsync(cmd, cwd, 15_000);
  const dir = fixture({ "a.ts": "// TODO one\n// FIXME two\n", "b.ts": "// HACK\n", "c.ts": "const todos = 1;\n" }, { "c.ts": 1 });
  expect(await repoTodos(dir, run)).toEqual([
    { path: "a.ts", n: 2 },
    { path: "b.ts", n: 1 },
  ]);
  expect(await repoTodos(fixture({ "c.ts": "ok" }, { "c.ts": 1 }), run)).toEqual([]);
});

test("what's kept shows as each project's lists, and a project no longer there shows nothing", () => {
  const kept = {
    "/code/shop": {
      client: "Shop",
      repo: "shop",
      updatesAt: 1,
      updates: [{ manager: "bun", package: "zod", current: "4.1.5", next: "4.1.12", update: "patch" as const }],
      repoAt: 1,
      untested: [{ path: "src/pay.ts", n: 4 }],
      todos: [{ path: "a.ts", n: 2 }],
    },
    "/code/gone": { client: "Gone", repo: "gone", updatesAt: 1, updates: [], repoAt: 1, untested: [{ path: "x.ts", n: 1 }], todos: [] },
  };
  expect(upkeepLists(kept, ["Shop"])).toEqual({
    outdated: [{ client: "Shop", repo: "shop", manager: "bun", package: "zod", current: "4.1.5", next: "4.1.12", update: "patch" }],
    untested: [{ client: "Shop", repo: "shop", path: "src/pay.ts", n: 4 }],
    todos: [{ client: "Shop", repo: "shop", path: "a.ts", n: 2 }],
  });
});
