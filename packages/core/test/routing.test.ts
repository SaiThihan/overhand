import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { comboOf, type Run, type ScoreRow, scorecard } from "@overhand/contract";
import { blankConfig } from "../src/config";
import { buildHistory, type Identity, loadHistory, nameParts, type Outcome } from "../src/history";
import { type RouteInput, routeOrder } from "../src/routing";

const T = Date.UTC(2026, 9, 19, 10);
const M = 60_000;

// accounts: two Claude subscriptions, a Bedrock key, a local qwen3 and Codex
const IDS: Record<string, Identity> = {
  sam: { runtime: "claude-code", provider: "claude", model: "" },
  sam2: { runtime: "claude-code", provider: "claude", model: "" },
  aws: { runtime: "claude-code", provider: "bedrock", model: "" },
  local: { runtime: "claude-code", provider: "gateway", model: "qwen3-coder" },
  codex: { runtime: "codex", provider: "claude", model: "" },
};
const who = (a: string): Identity => IDS[a] ?? { runtime: "claude-code", provider: "claude", model: "" };
const identity = (a: string) => {
  const id = who(a);
  return { combo: comboOf(id.runtime, id.provider, id.model), pool: `${id.runtime}/${id.provider}` };
};
const projectOf = (key: string) => (key.startsWith("KITE-") ? "Bluekite" : "");

/** A row with `merged` of `runs` merged. */
const row = (combo: string, runs: number, merged: number): ScoreRow => ({
  combo,
  runs,
  prs: merged,
  merged,
  firstTry: merged,
  mergeRate: merged / runs,
  mergeMin: null,
  cost: 0,
  costPerMerge: null,
  billed: 0,
  billedPerMerge: null,
  billings: [],
  failures: { noPr: 0, failed: 0, timeout: 0, closed: 0 },
  daily: [],
  few: runs < 5,
});
const rows = [row("claude-code/claude", 10, 7), row("claude-code/qwen3-coder", 10, 2), row("codex/default", 3, 3)];
const base: RouteInput = {
  mode: "auto",
  autonomy: "act",
  today: ["local"],
  allowed: ["sam", "sam2", "aws", "local", "codex"],
  identity,
  rows,
};

test("a run's kind and key come from its name", () => {
  expect(nameParts("KITE-7")).toEqual({ kind: "ticket", key: "KITE-7" });
  expect(nameParts("KITE-7-retry")).toEqual({ kind: "ticket", key: "KITE-7" });
  expect(nameParts("KITE-7-fix")).toEqual({ kind: "fix", key: "KITE-7" });
  expect(nameParts("KITE-7-route")).toEqual({ kind: "other", key: "KITE-7" });
  expect(nameParts("plan")).toEqual({ kind: "plan", key: "" });
  expect(nameParts("inbox")).toEqual({ kind: "triage", key: "" });
  expect(nameParts("lead-honeycrust")).toEqual({ kind: "lead", key: "" });
});

test("auto puts first the combo that merges clearly more often, and keeps one account per CLI and backend", () => {
  // sam2 is a second Claude subscription: never a fallback
  expect(routeOrder(base)).toEqual(["sam", "local", "aws", "codex"]);
  // local code's order is today's order: routing keeps it whole and only adds other CLIs and backends
  expect(routeOrder({ ...base, today: ["sam2", "sam"] })).toEqual(["sam2", "sam", "aws", "local", "codex"]);
});

test("auto keeps today's order when samples are thin or nothing is clearly better", () => {
  const thin = [row("claude-code/claude", 4, 4), row("claude-code/qwen3-coder", 10, 2)];
  expect(routeOrder({ ...base, rows: thin })).toEqual(["local", "sam", "aws", "codex"]);
  const close = [row("claude-code/claude", 10, 5), row("claude-code/qwen3-coder", 10, 4)];
  expect(routeOrder({ ...base, rows: close })[0]).toBe("local");
  expect(routeOrder({ ...base, rows: [] })[0]).toBe("local");
});

test("auto only picks among the project's allowed accounts", () => {
  expect(routeOrder({ ...base, allowed: ["local", "codex"] })).toEqual(["local", "codex"]);
});

test("off, suggest and a project on watch keep today's order exactly", () => {
  expect(routeOrder({ ...base, mode: "off" })).toEqual(["local"]);
  expect(routeOrder({ ...base, mode: "suggest" })).toEqual(["local"]);
  expect(routeOrder({ ...base, autonomy: "watch" })).toEqual(["local"]);
});

test("routing defaults to suggest in the config", () => {
  expect(blankConfig("me").routing.mode).toBe("suggest");
});

test("history joins runs with their outcomes and PR fates, and folds retries", () => {
  const runs: Run[] = [
    { name: "KITE-1", account: "local", start: T, end: T + 30 * M, cost: 0, ok: true },
    { name: "KITE-1-retry", account: "local", start: T + 30 * M, end: T + 35 * M, cost: 0, ok: true },
    { name: "KITE-1-fix", account: "sam", start: T + 2 * 60 * M, end: T + 2.5 * 60 * M, cost: 1.5, ok: true },
    { name: "KITE-2", account: "sam", start: T, end: T + 75 * M, cost: 3, ok: false, timedOut: true },
    { name: "KITE-3", account: "codex", start: T, end: T + 10 * M, cost: 1, ok: false },
    {
      name: "KITE-4",
      account: "x",
      start: T,
      end: T + 20 * M,
      cost: 2,
      ok: true,
      kind: "ticket",
      project: "Bluekite",
      key: "KITE-4",
      runtime: "aider",
      provider: "gateway",
      model: "llama3.1",
    },
    { name: "plan", account: "sam", start: T, end: T + M, cost: 0.4, ok: true },
  ];
  const outcomes: Outcome[] = [
    { at: T + 36 * M, key: "KITE-1", event: "pr", url: "u1" },
    { at: T + 5 * 60 * M, key: "KITE-1", event: "merged", changes: 1 },
    { at: T + 21 * M, key: "KITE-4", event: "no-pr" },
  ];
  const h = buildHistory(runs, outcomes, who, projectOf, T + 10 * 60 * M);
  expect(h).toHaveLength(6); // the retry is folded into KITE-1
  const [one, fix, two, three, four, plan] = h;
  expect(one).toMatchObject({ kind: "ticket", project: "Bluekite", runtime: "claude-code", model: "qwen3-coder", outcome: "pr" });
  expect(one?.end).toBe(T + 35 * M);
  expect(one?.pr).toEqual({ url: "u1", state: "merged", fixes: 1, changes: 1, openedAt: T + 36 * M, doneAt: T + 5 * 60 * M });
  expect(fix).toMatchObject({ kind: "fix", key: "KITE-1", cost: 1.5 });
  expect(two?.outcome).toBe("timeout");
  expect(three?.outcome).toBe("failed");
  expect(four).toMatchObject({ runtime: "aider", model: "llama3.1", outcome: "no-pr" });
  expect(plan).toMatchObject({ kind: "plan", project: "" });
  const card = scorecard(h, T + 10 * 60 * M, 7);
  expect(card.projects[0]?.rows.find((r) => r.combo === "claude-code/qwen3-coder")).toMatchObject({ merged: 1, firstTry: 0 });
});

test("an older ops folder's history comes from its runs files and activity log", () => {
  const ops = mkdtempSync(join(tmpdir(), "history-"));
  mkdirSync(join(ops, "runs"));
  mkdirSync(join(ops, "reports"));
  const date = new Date(T).toLocaleDateString("sv-SE");
  const start = new Date(`${date}T09:00:00`).getTime();
  writeFileSync(
    join(ops, "runs", `${date}.jsonl`),
    [
      JSON.stringify({ name: "KITE-9", account: "sam", start, end: start + 40 * M, cost: 2.5, ok: true }),
      '{"name":"KITE-1', // a line still being written
    ].join("\n"),
  );
  writeFileSync(
    join(ops, "reports", `${date}.md`),
    [
      "- 09:40 ✅ KITE-9 (sam, $2.50) → https://github.com/i/p/pull/3",
      "- 11:00 ✗ KITE-9 fix round 1 (sam): x",
      "- 13:40 🎉 KITE-9 PR merged",
    ].join("\n"),
  );
  const [r] = loadHistory(ops, 3, who, projectOf, start + 6 * 60 * M);
  expect(r).toMatchObject({ project: "Bluekite", outcome: "pr", pr: { state: "merged", url: "https://github.com/i/p/pull/3" } });
  expect(r?.pr?.doneAt).toBe(start + 4 * 60 * M + 40 * M);
});
