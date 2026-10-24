import { expect, test } from "bun:test";
import { clearlyBetter, comboLabel, comboOf, type HistoryRun, MIN_RUNS, scorecard } from "../src/index";

const DAY = 864e5;
const NOW = Date.UTC(2026, 9, 20, 8);
const H = 3600_000;

/** A ticket run `daysAgo` days back on one combo; `merged` after `hours`, with `fixes` fix rounds. */
function run(
  combo: { runtime: string; provider: string; model: string },
  project: string,
  daysAgo: number,
  how: {
    outcome?: HistoryRun["outcome"];
    merged?: boolean;
    closed?: boolean;
    fixes?: number;
    hours?: number;
    cost?: number;
    billing?: HistoryRun["billing"];
  } = {},
): HistoryRun {
  const start = NOW - daysAgo * DAY;
  const end = start + H;
  const outcome = how.outcome ?? (how.merged || how.closed ? "pr" : "no-pr");
  const doneAt = how.merged || how.closed ? end + (how.hours ?? 4) * H : 0;
  return {
    project,
    key: `${project.toUpperCase()}-${daysAgo}`,
    kind: "ticket",
    account: combo.runtime,
    ...combo,
    start,
    end,
    cost: how.cost ?? 2,
    billing: how.billing ?? "plan",
    outcome,
    ...(outcome === "pr"
      ? {
          pr: {
            url: "",
            state: how.merged ? ("merged" as const) : how.closed ? ("closed" as const) : ("open" as const),
            fixes: how.fixes ?? 0,
            changes: 0,
            openedAt: end,
            doneAt,
          },
        }
      : {}),
  };
}

const claude = { runtime: "claude-code", provider: "claude", model: "" };
const qwen = { runtime: "claude-code", provider: "gateway", model: "qwen3-coder" };
const codex = { runtime: "codex", provider: "claude", model: "" };

/** Bluekite: Claude merges 6 of 8 (one after a fix round), qwen3 2 of 8 and fails twice; Codex ran only twice. */
const history: HistoryRun[] = [
  ...[1, 2, 3, 4, 5, 6].map((d) => run(claude, "Bluekite", d, { merged: true, fixes: d === 3 ? 1 : 0, hours: d })),
  run(claude, "Bluekite", 7, { closed: true }),
  run(claude, "Bluekite", 8, { outcome: "timeout" }),
  ...[1, 2].map((d) => run(qwen, "Bluekite", d, { merged: true, cost: 0, hours: 10 })),
  ...[3, 4].map((d) => run(qwen, "Bluekite", d, { outcome: "failed", cost: 0 })),
  ...[5, 6, 9, 10].map((d) => run(qwen, "Bluekite", d, { cost: 0 })),
  run(codex, "Bluekite", 1, { merged: true }),
  run(codex, "Bluekite", 2, { merged: true }),
  run(claude, "Honeycrust", 40, { merged: true }), // outside 30 days
];

test("the scorecard counts runs, PRs, merges and first tries per combo", () => {
  const card = scorecard(history, NOW, 30);
  const bluekite = card.projects.find((p) => p.project === "Bluekite");
  const c = bluekite?.rows.find((r) => r.combo === comboOf("claude-code", "claude", ""));
  expect(c).toMatchObject({ runs: 8, prs: 7, merged: 6, firstTry: 5, few: false });
  expect(c?.mergeRate).toBe(6 / 8);
  expect(c?.failures).toEqual({ noPr: 0, failed: 0, timeout: 1, closed: 1 });
  expect(c?.costPerMerge).toBeCloseTo(16 / 6);
  expect(c?.mergeMin).toBe(3.5 * 60); // median of 1..6 hours
  const q = bluekite?.rows.find((r) => r.combo === comboOf("claude-code", "gateway", "qwen3-coder"));
  expect(q).toMatchObject({ runs: 8, merged: 2, cost: 0, costPerMerge: 0, failures: { noPr: 4, failed: 2, timeout: 0, closed: 0 } });
  expect(q?.daily.reduce((a, b) => a + b, 0)).toBe(2);
  expect(q?.daily).toHaveLength(30);
});

test("a row's billed cost counts only pay-per-use and cloud runs; at API prices counts them all", () => {
  // one combo on two accounts: a plan sign-in merges twice at $2 each, an API key once at $2
  const runs = [
    run(claude, "Bluekite", 1, { merged: true }),
    run(claude, "Bluekite", 2, { merged: true }),
    run(claude, "Bluekite", 3, { merged: true, billing: "pay-per-use" }),
    run(qwen, "Bluekite", 1, { merged: true, cost: 0, billing: "local" }),
  ];
  const rows = scorecard(runs, NOW, 30).overall;
  const c = rows.find((r) => r.combo === comboOf("claude-code", "claude", ""));
  expect(c).toMatchObject({ cost: 6, costPerMerge: 2, billed: 2, billings: ["plan", "pay-per-use"] });
  expect(c?.billedPerMerge).toBeCloseTo(2 / 3);
  const q = rows.find((r) => r.combo === comboOf("claude-code", "gateway", "qwen3-coder"));
  expect(q).toMatchObject({ billed: 0, billedPerMerge: 0, billings: ["local"] });
});

test("thin samples are marked and ranked last; the best combo needs enough runs", () => {
  const bluekite = scorecard(history, NOW, 30).projects.find((p) => p.project === "Bluekite");
  const codexRow = bluekite?.rows.find((r) => r.combo === "codex/default");
  expect(codexRow?.few).toBe(true); // 2 runs, 100% merged: still too few to tell
  expect(codexRow?.runs).toBeLessThan(MIN_RUNS);
  expect(bluekite?.rows.at(-1)?.combo).toBe("codex/default");
  expect(bluekite?.best).toBe("claude-code/claude");
});

test("the window keeps old runs out", () => {
  expect(scorecard(history, NOW, 30).projects.map((p) => p.project)).toEqual(["Bluekite"]);
  expect(scorecard(history, NOW, 7).overall.find((r) => r.combo === "claude-code/claude")?.runs).toBe(7); // days 1–7, not 8
});

test("a combo is clearly better only with enough runs and a real difference", () => {
  const rows = scorecard(history, NOW, 30).projects[0]?.rows ?? [];
  const all = rows.map((r) => r.combo);
  expect(clearlyBetter(rows, "claude-code/qwen3-coder", all)?.to.combo).toBe("claude-code/claude");
  expect(clearlyBetter(rows, "claude-code/claude", all)).toBeNull(); // already the best
  expect(clearlyBetter(rows, "claude-code/qwen3-coder", ["claude-code/qwen3-coder", "codex/default"])).toBeNull(); // Codex: too few runs
  expect(clearlyBetter(rows, "codex/default", all)).toBeNull(); // nothing to compare against
});

test("combos read as CLI · model", () => {
  expect(comboLabel(comboOf("claude-code", "claude", ""))).toBe("Claude Code · Claude");
  expect(comboLabel(comboOf("claude-code", "bedrock", ""))).toBe("Claude Code · Bedrock");
  expect(comboLabel(comboOf("codex", "gateway", "qwen3"))).toBe("Codex · qwen3");
  expect(comboLabel(comboOf("codex", "claude", ""))).toBe("Codex");
  expect(comboLabel(comboOf("opencode", "claude", "ollama/qwen3-coder"))).toBe("OpenCode · qwen3-coder");
});
