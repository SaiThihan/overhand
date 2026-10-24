import { expect, test } from "bun:test";
import { claimsOf, QUESTION_FALLBACK_MS, routeQuestion, type TeamState, teamBrief, unsafeText, waitingOn } from "../src/team";

const projects = [
  { project: "Shop", owner: "ana", backup: "bob" },
  { project: "Docs", owner: null, backup: "bob" },
  { project: "Site", owner: "ana", backup: null },
];

test("a question waits on its project's owner, then the backup too after the deadline; with neither, on anyone", () => {
  const at = 1_000_000;
  expect(routeQuestion({ project: "Shop", at }, projects, at + 1)).toEqual({ to: ["ana"], stage: "owner" });
  expect(routeQuestion({ project: "Shop", at }, projects, at + QUESTION_FALLBACK_MS)).toEqual({ to: ["ana", "bob"], stage: "backup" });
  expect(routeQuestion({ project: "Docs", at }, projects, at)).toEqual({ to: ["bob"], stage: "backup" });
  // no backup: it stays with the owner
  expect(routeQuestion({ project: "Site", at }, projects, at + 10 * QUESTION_FALLBACK_MS)).toEqual({ to: ["ana"], stage: "owner" });
  expect(routeQuestion({ project: "Nobody's", at }, projects, at)).toEqual({ to: [], stage: "anyone" });
});

const q = (id: string, by: string, project = "Shop", at = 0) => ({
  k: "question" as const,
  id,
  project,
  lead: "Lead",
  text: "Which one?",
  fallback: "",
  by,
  at,
  seq: 0,
});

test("only what waits on you: questions routed to you (not your own), unanswered; hand-offs to you; mentions of you", () => {
  const now = 10 * QUESTION_FALLBACK_MS;
  const t = {
    roster: { projects },
    log: [
      q("q1", "cat"),
      q("q2", "cat"),
      { k: "answer" as const, id: "q2", text: "done", by: "ana", at: 1, seq: 0 },
      q("q3", "bob"),
      { k: "handoff" as const, id: "h1", to: "bob", project: "Shop", title: "Fix", key: null, note: "", by: "ana", at: now - 1000, seq: 0 },
      { k: "handoff" as const, id: "h2", to: "ana", project: "Shop", title: "Fix", key: null, note: "", by: "bob", at: now - 1000, seq: 0 },
      { k: "comment" as const, id: "c1", item: "q:q1", text: "@bob look", mentions: ["bob"], by: "ana", at: now - 1000, seq: 0 },
    ],
  };
  // bob is Shop's backup and the deadline passed: q1 waits on him; q2 is answered; q3 is his own
  expect(waitingOn("bob", t, now).map((w) => w.item)).toEqual(["q:q1", "h:h1", "q:q1"]);
  expect(waitingOn("bob", t, now).map((w) => w.kind)).toEqual(["question", "handoff", "mention"]);
  // before the deadline, only the owner
  expect(waitingOn("bob", { ...t, log: [q("q1", "cat", "Shop", now)] }, now)).toEqual([]);
  expect(waitingOn("ana", { ...t, log: [q("q1", "cat", "Shop", now)] }, now).length).toBe(1);
});

test("claims gather by item from everyone online; going offline drops them", () => {
  const online: TeamState["online"] = {
    ana: {
      at: 1,
      presence: { k: "presence", agents: 0, quiet: false, viewing: null, claims: [{ item: "q:q1", label: "Q" }], projects: [] },
    },
    bob: {
      at: 1,
      presence: {
        k: "presence",
        agents: 0,
        quiet: false,
        viewing: null,
        claims: [
          { item: "q:q1", label: "Q" },
          { item: "pr:Shop#4", label: "PR" },
        ],
        projects: [],
      },
    },
    cat: { at: 1, presence: null },
  };
  expect(Object.fromEntries(claimsOf(online))).toEqual({ "q:q1": ["ana", "bob"], "pr:Shop#4": ["bob"] });
  delete online.ana;
  expect(claimsOf(online).get("q:q1")).toEqual(["bob"]);
});

test("the brief: who's online, what changed, what waits on you", () => {
  const t: TeamState = {
    roster: {
      team: { id: "t", name: "Crew" },
      me: "bob",
      role: "member",
      seats: 3,
      over: null,
      members: [
        { user: "ana", email: "ana@x.dev", role: "owner", joinedAt: 1, seated: true },
        { user: "bob", email: "bob@x.dev", role: "member", joinedAt: 2, seated: true },
      ],
      invites: [],
      projects,
    },
    connected: true,
    online: { ana: { at: 1, presence: { k: "presence", agents: 3, quiet: false, viewing: null, claims: [], projects: [] } } },
    log: [
      { k: "result", project: "Shop", title: "Fix cart", outcome: "merged", pr: null, by: "ana", at: 5, seq: 1 },
      { k: "handoff", id: "h1", to: "bob", project: "Shop", title: "Flaky test", key: null, note: "", by: "ana", at: 5, seq: 2 },
    ],
    problem: "",
    sharePrs: false,
  };
  expect(teamBrief(t, 10, 0)).toEqual([
    "Ana online; 3 agents working across the team.",
    "Since then: 1 merged.",
    "Ana handed you Flaky test (Shop).",
  ]);
});

test("plain sentences, ticket keys and PR links aren't mistaken for code or secrets", () => {
  for (const ok of [
    "Should the checkout keep the old provider, or move to the new one behind a flag?",
    "SHOP-1234 merged: Fix the cart total on mobile",
    "https://github.com/craftly-io/overhand/pull/418",
    "Use the staging database for this, not production.",
  ])
    expect(unsafeText(ok), ok).toBe(false);
});
