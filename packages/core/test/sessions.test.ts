import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "../src/config";
import { CFG } from "../src/env";
import { branchAt, transcriptCwd, transcriptTail } from "../src/sessions";
import { ownSizes, parseWorktrees, projectWords, sharedScan, whoIn } from "../src/worktrees";

test("branchAt reads the branch from git's own files, in a checkout, a worktree and a folder inside either", () => {
  const root = mkdtempSync(join(tmpdir(), "branch-"));
  const repo = join(root, "shop");
  mkdirSync(join(repo, ".git", "worktrees", "gift"), { recursive: true });
  writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  mkdirSync(join(repo, "src", "deep"), { recursive: true });
  expect(branchAt(join(repo, "src", "deep"))).toBe("main");
  const wt = join(repo, ".claude", "worktrees", "gift");
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${join(repo, ".git", "worktrees", "gift")}\n`);
  writeFileSync(join(repo, ".git", "worktrees", "gift", "HEAD"), "ref: refs/heads/feat/gift-card\n");
  expect(branchAt(wt)).toBe("feat/gift-card");
  writeFileSync(join(repo, ".git", "worktrees", "gift", "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
  expect(branchAt(wt)).toBe(""); // detached
  expect(branchAt(root)).toBe(""); // not a repo
});

test("transcriptCwd is the folder of the transcript's latest event that names one", () => {
  const lines = [
    { type: "user", cwd: "/code/shop" },
    { type: "assistant" },
    { type: "user", cwd: "/code/shop/.claude/worktrees/gift" },
    { x: 1 },
  ];
  expect(transcriptCwd(lines.map((l) => JSON.stringify(l)).join("\n"))).toBe("/code/shop/.claude/worktrees/gift");
  expect(transcriptCwd("not json")).toBe("");
});

test("each worktree lists who works in it; a session in a repo's .claude/worktrees counts there, not in the checkout", () => {
  const wts = parseWorktrees(
    "worktree /code/shop\nHEAD abc\nbranch refs/heads/main\n\nworktree /code/shop/.claude/worktrees/gift\nHEAD def\nbranch refs/heads/SHOP-142\n\nworktree /code/shop-old\nHEAD 123\ndetached\n",
  );
  expect(wts).toEqual([
    { path: "/code/shop", branch: "main" },
    { path: "/code/shop/.claude/worktrees/gift", branch: "SHOP-142" },
    { path: "/code/shop-old", branch: "" },
  ]);
  const sub = { name: "test-writer", description: "", color: "", active: true, lastAt: 0, model: "", mode: "", client: "", branch: "" };
  const session = (kind: "you" | "lead", cwd: string, subCwd = "") => ({
    pid: 1,
    kind,
    label: kind === "lead" ? "Keep CI green · Shop" : "Your session",
    client: "Shop",
    cwd,
    upSec: 0,
    active: true,
    name: "pricing",
    model: "",
    mode: "",
    lastAction: "",
    branch: "",
    subagents: [{ ...sub, cwd: subCwd }],
  });
  const sessions = [session("you", "/code/shop/src"), session("lead", "/code/shop/.claude/worktrees/gift", "/code/shop-old")];
  const paths = wts.map((w) => w.path);
  expect(whoIn("/code/shop", paths, sessions)).toEqual([{ kind: "you", label: "pricing" }]);
  expect(whoIn("/code/shop/.claude/worktrees/gift", paths, sessions)).toEqual([{ kind: "lead", label: "Keep CI green · Shop" }]);
  // a subagent with a folder of its own works there; one without works where its session does, already counted
  expect(whoIn("/code/shop-old", paths, sessions)).toEqual([{ kind: "subagent", label: "test-writer" }]);
});

test("the worktree scan is shared while it runs, kept while fresh, and served stale while a new one runs", async () => {
  let t = 0;
  let scans = 0;
  let release: (n: number) => void = () => {};
  const get = sharedScan(
    () =>
      new Promise<number>((r) => {
        scans++;
        release = r;
      }),
    300,
    () => t,
  );
  const [a, b] = [get(), get()];
  expect(scans).toBe(1); // two callers at once share one scan
  release(1);
  expect(await a).toBe(1);
  expect(await b).toBe(1);
  t = 299;
  expect(await get()).toBe(1);
  expect(scans).toBe(1); // still fresh
  t = 301;
  expect(await get()).toBe(1); // stale, served at once while the next scan runs
  expect(await get()).toBe(1);
  expect(scans).toBe(2);
  release(2);
  await Bun.sleep(0);
  expect(await get()).toBe(2);
});

test("a checkout's size leaves out the worktrees nested in it, which are listed on their own", () => {
  const list = [
    { path: "/code/shop", kb: 1000 },
    { path: "/code/shop/.claude/worktrees/a", kb: 300 },
    { path: "/code/shop/.claude/worktrees/b", kb: 200 },
    { path: "/code/shop-old", kb: 50 },
    { path: "/code/gone", kb: -1 },
  ];
  expect(ownSizes(list)).toEqual([500, 300, 200, 50, -1]);
});

test("a transcript's tail is read again only when the file changed", () => {
  const f = join(mkdtempSync(join(tmpdir(), "tail-")), "t.jsonl");
  const line = (cwd: string) => `${JSON.stringify({ type: "user", cwd })}\n`;
  writeFileSync(f, line("/code/aaaa"));
  const when = new Date(Date.now() - 60_000);
  utimesSync(f, when, when);
  expect(transcriptTail(f).cwd).toBe("/code/aaaa");
  // same size and time: the kept tail, not a re-read
  writeFileSync(f, line("/code/bbbb"));
  utimesSync(f, when, when);
  expect(transcriptTail(f).cwd).toBe("/code/aaaa");
  // it moved on: read again
  utimesSync(f, new Date(), new Date());
  expect(transcriptTail(f).cwd).toBe("/code/bbbb");
});

test("a worktree refresh that fails keeps the old result and is reported, never left unhandled", async () => {
  let t = 0;
  let fail = false;
  const errors: unknown[] = [];
  const get = sharedScan(
    () => (fail ? Promise.reject(new Error("git gone")) : Promise.resolve(7)),
    10,
    () => t,
    (e) => errors.push(e),
  );
  expect(await get()).toBe(7);
  fail = true;
  t = 20;
  let unhandled = 0;
  const count = () => unhandled++;
  process.on("unhandledRejection", count);
  try {
    expect(await get()).toBe(7); // stale, while the refresh fails behind it
    await Bun.sleep(5);
    expect(await get()).toBe(7);
    await Bun.sleep(5);
  } finally {
    process.off("unhandledRejection", count);
  }
  expect(unhandled).toBe(0);
  expect(errors.length).toBeGreaterThan(0);
  // the very first scan failing reaches its caller
  const first = sharedScan(
    () => Promise.reject(new Error("no repo")),
    10,
    () => 0,
    () => {},
  );
  await expect(first()).rejects.toThrow("no repo");
});

test("a worktree's words come from its own project only: one naming another project, or its private words, is left out", () => {
  const client = (name: string, prefix: string, priv: string[] = []): Client => ({
    name,
    dir: name.toLowerCase(),
    prefix,
    host: "github",
    tracker: { kind: "github", repo: `org/${name.toLowerCase()}` },
    aliases: [],
    accounts: [],
    fallbackToAll: true,
    autonomy: "act",
    assignedAutonomy: "act",
    status: { vercelSecrets: [], sentrySecrets: [] },
    private: priv,
  });
  const cfg = { clients: [client("Honeycrust", "HONEY", ["Project Bluebird"]), client("Fernway", "FERN")], outward: CFG.outward };
  const words = ["Keep the cart when a session expires", "Port Fernway's checkout", "Project Bluebird copy", " "];
  expect(projectWords("Honeycrust", words, cfg)).toEqual(["Keep the cart when a session expires", "Project Bluebird copy"]);
  expect(projectWords("Fernway", words, cfg)).toEqual(["Keep the cart when a session expires", "Port Fernway's checkout"]);
});
