import { expect, test } from "bun:test";
import type { HistoryRun } from "@overhand/contract";
import { buildSummary } from "../src/summary";

const NOW = new Date(2026, 9, 20, 9, 0).getTime();
const H = 3_600_000;

const run = (
  key: string,
  project: string,
  at: number,
  pr?: Partial<NonNullable<HistoryRun["pr"]>>,
  cost = 1,
  billing: HistoryRun["billing"] = "pay-per-use",
): HistoryRun => ({
  project,
  key,
  kind: "ticket",
  account: "a",
  runtime: "claude-code",
  provider: "claude",
  model: "",
  start: at,
  end: at + H / 2,
  cost,
  billing,
  outcome: pr ? "pr" : "failed",
  pr: pr
    ? { url: `https://github.com/acme/${project}/pull/1`, state: "open", fixes: 0, changes: 0, openedAt: at + H / 2, doneAt: 0, ...pr }
    : undefined,
});

const inputs = {
  history: [
    run("WEB-1", "Web", NOW - 10 * H, { state: "merged", doneAt: NOW - 2 * H }), // merged overnight
    run("WEB-2", "Web", NOW - 40 * H, { state: "merged", doneAt: NOW - 30 * H }), // merged two days ago
    run("API-1", "Api", NOW - 5 * H, { state: "open" }, 2.5),
    run("API-2", "Api", NOW - 4 * H, undefined, 0.5),
    run("WEB-4", "Web", NOW - 3 * H, undefined, 9, "plan"), // a plan's run: its API-price cost was never billed
  ],
  prs: [{ key: "API-1", project: "Api", url: "https://github.com/acme/api/pull/9" }],
  tickets: {
    Web: [
      { key: "WEB-3", title: "Dark mode", status: "Todo", priority: "", labels: ["agent"], url: "u3" },
      { key: "WEB-1", title: "Fix the cart", status: "Done", priority: "", labels: [], url: "u1" },
    ],
    Api: [{ key: "API-2", title: "Which database?", status: "Todo", priority: "", labels: ["needs-owner"], url: "u2" }],
    Down: "tracker timed out",
  },
  labels: { blocked: "needs-owner", queue: "agent" },
};

test("the night: merges since 18:00 yesterday, open PRs, blocked and queued tickets, billed spend per project", () => {
  const s = buildSummary("night", NOW, inputs);
  expect(s.shipped).toEqual([{ project: "Web", key: "WEB-1", title: "Fix the cart", url: "https://github.com/acme/Web/pull/1" }]);
  expect(s.opened.map((x) => x.key)).toEqual(["WEB-1", "API-1"]);
  expect(s.review.map((x) => x.key)).toEqual(["API-1"]);
  expect(s.blocked).toEqual([{ project: "Api", key: "API-2", title: "Which database?", url: "u2" }]);
  expect(s.next.map((x) => x.key)).toEqual(["WEB-3"]);
  expect(s.spend).toEqual({ Web: 1, Api: 3 });
});

test("the week reaches back seven days; today starts at midnight", () => {
  expect(buildSummary("week", NOW, inputs).shipped.map((x) => x.key)).toEqual(["WEB-1", "WEB-2"]);
  const today = buildSummary("today", NOW, inputs);
  expect(today.shipped.map((x) => x.key)).toEqual(["WEB-1"]);
  expect(today.spend).toEqual({ Api: 3 });
});
