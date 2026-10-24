import { expect, test } from "bun:test";
import { NOW, state } from "@overhand/contract/fixtures/state";
import { armedCount, parseInbox, parsePlan, plannedKeys, readyItems, statusOf } from "./plan";

const PLAN = [
  "# Plan 2026-10-18",
  "## Top 3",
  "1. Ship the login fix: HONEY-12",
  "2. Review Beta's PR",
  "## Honeycrust",
  "### Agent",
  "- [x] HONEY-12 Fix login — users locked out (~0m)",
  "- [ ] HONEY-13 Tidy footer — low risk",
  "### You",
  "- HONEY-14 Decide pricing — needs a call https://github.com/honeycrust/app/pull/9",
  "- nothing else",
  "## Inbox",
  "- [x] new-abc12 Export is slow",
  "- [ ] new-def34 Logo is blurry",
  "- ↩ Kim asked about the release",
  "  Suggested: Friday, after QA.",
  "  https://honeycrust.slack.com/archives/C1/p1",
  "- 💬 Lee said thanks",
  "## Notes",
  "HONEY-15 is labelled agent but closed.",
];

test("parsePlan reads every section, with line numbers for toggling", () => {
  const p = parsePlan(PLAN);
  expect(p.top).toEqual(["Ship the login fix: HONEY-12", "Review Beta's PR"]);
  expect(p.clients.Honeycrust?.agent).toEqual([
    { i: 6, key: "HONEY-12", title: "Fix login", why: "users locked out", on: true },
    { i: 7, key: "HONEY-13", title: "Tidy footer", why: "low risk", on: false },
  ]);
  expect(p.clients.Honeycrust?.you).toEqual([
    { i: 9, key: "HONEY-14", url: "https://github.com/honeycrust/app/pull/9", title: "Decide pricing", why: "needs a call" },
  ]);
  expect(p.notes).toEqual(["HONEY-15 is labelled agent but closed."]);
  expect(armedCount(p, state())).toBe(1);
  expect([...plannedKeys(p)]).toEqual(["HONEY-12"]);
});

test("parseInbox turns Slack lines into new tickets, replies and notes", () => {
  const p = parsePlan(PLAN);
  const pending = [
    { id: "new-abc12", client: "Honeycrust", title: "Export is slow", details: "", permalink: "", from: "Kim", createAfter: NOW + 600_000 },
    { id: "new-def34", client: "Honeycrust", title: "Logo", details: "", permalink: "", from: "Kim", createAfter: NOW - 1 },
  ];
  expect(parseInbox(p.inbox, pending, NOW)).toEqual([
    { kind: "new", line: 12, on: true, title: "Export is slow", when: "at", at: NOW + 600_000 },
    { kind: "new", line: 13, on: false, title: "Logo is blurry", when: "skipped", at: NOW - 1 },
    {
      kind: "reply",
      text: "Kim asked about the release",
      suggested: "Friday, after QA.",
      link: "https://honeycrust.slack.com/archives/C1/p1",
    },
    { kind: "note", text: "💬 Lee said thanks" },
  ]);
});

test("statusOf ranks working over blocked over review over queued over planned", () => {
  const s = state({ running: [{ name: "HONEY-1 fix", account: "work", cwd: "", startedAt: NOW, pid: 1 }] });
  const t = (key: string, labels: string[]) => ({ key, title: "", status: "", priority: "", labels, url: "" });
  const planned = new Set(["HONEY-6"]);
  expect(statusOf(t("HONEY-1", []), s, planned)).toBe("working");
  expect(statusOf(t("HONEY-2", ["needs-owner", "agent"]), s, planned)).toBe("blocked");
  expect(statusOf(t("HONEY-3", ["agent-review"]), s, planned)).toBe("review");
  expect(statusOf(t("HONEY-4", ["agent"]), s, planned)).toBe("queued");
  expect(statusOf(t("HONEY-6", []), s, planned)).toBe("planned");
  expect(statusOf(t("HONEY-7", []), s, planned)).toBe("mine");
});

test("armed counts only what the next pass would start", () => {
  const p = parsePlan([
    "## Honeycrust",
    "### Agent",
    "- [x] HONEY-1 In review — has a PR",
    "- [x] HONEY-2 Labelled review",
    "- [x] HONEY-3 Running now",
    "- [x] HONEY-4 Blocked",
    "- [x] HONEY-5 Ready",
    "- [x] No key at all",
    "- [ ] HONEY-6 Not armed",
  ]);
  const t = (key: string, labels: string[]) => ({ key, title: "", status: "", priority: "", labels, url: "" });
  const s = state({
    prs: [{ key: "HONEY-1", url: "", fixes: 0, branch: "", draft: false, corners: [], preview: "", reviewRound: 0 }],
    running: [{ name: "HONEY-3 fix", account: "work", cwd: "", startedAt: NOW, pid: 1 }],
    tickets: { Honeycrust: [t("HONEY-2", ["agent-review"]), t("HONEY-4", ["needs-owner"]), t("HONEY-5", ["agent"])] },
  });
  expect(readyItems(p, s).map((a) => a.key)).toEqual(["HONEY-5"]);
  expect(armedCount(p, s)).toBe(1);
  const opened = { key: "HONEY-5", url: "", fixes: 0, branch: "", draft: false, corners: [], preview: "", reviewRound: 0 };
  expect(armedCount(p, { ...s, prs: [...s.prs, opened] })).toBe(0);
});
