import { type DashboardState, DashboardStateSchema } from "@overhand/contract";

export const NOW = 1_792_330_000_000;

/** A small, complete state for tests; made-up names only. Overrides are merged at the top level. */
export function state(over: Partial<DashboardState> = {}): DashboardState {
  return DashboardStateSchema.parse({
    now: NOW,
    today: "2026-10-18",
    paused: false,
    pauseReason: "",
    daemon: true,
    running: [],
    accounts: [{ name: "work", coolUntil: 0, usage: null }],
    prs: [],
    pending: [],
    splits: {},
    plan: [],
    reports: [],
    cost: 0,
    sessions: [],
    tickets: {},
    clients: [{ name: "Honeycrust", prefix: "HONEY", host: "github" }],
    godmode: [],
    labels: { queue: "agent", working: "agent-working", review: "agent-review", blocked: "needs-owner", fromSlack: "from-slack" },
    opsBehind: 0,
    taskTimeoutMin: 75,
    owner: "Sam",
    runs: [],
    week: { opened: 0, merged: 0, failed: 0, questions: 0, fixes: 0, successRate: null, cost: 0, byAccount: {}, byClient: {}, days: [] },
    status: { at: 0, myPrs: [], reviews: [], ci: [], deploys: [], sentry: [], calendar: [], errors: [] },
    ...over,
  });
}
