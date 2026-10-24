import { expect, test } from "bun:test";
import type { JsonObject } from "./json";
import { patchOrganised } from "./organise-patch";

const lead = (key: string, over: JsonObject = {}): JsonObject => ({ key, label: key, project: "Web", supervised: true, ...over });
const project = (name: string, over: JsonObject = {}): JsonObject => ({
  name,
  dir: name.toLowerCase(),
  prefix: name.toUpperCase(),
  ...over,
});

const BASE: JsonObject = {
  limits: { dailyBudgetUsd: 10 },
  clients: [project("Web", { autonomy: "act" }), project("Api", { autonomy: "act" })],
  groups: [],
  godmode: [lead("web"), lead("api", { project: "Api" })],
};

/** What the daemon saved after "one lead for the group": a group, its lead, the member leads gone, rules lifted. */
const FRESH: JsonObject = {
  ...BASE,
  clients: [project("Web"), project("Api")],
  groups: [{ name: "Acme", members: ["Web", "Api"], rules: { autonomy: "act" } }],
  godmode: [lead("acme-lead", { project: "Acme" })],
};

test("an unsaved edit in another tab survives an organise change; groups, leads and project rules come in", () => {
  const draft: JsonObject = { ...BASE, limits: { dailyBudgetUsd: 25 }, schedule: { briefAtHour: 6 } };
  const { draft: next, conflicts } = patchOrganised(draft, BASE, FRESH);
  expect(next.limits).toEqual({ dailyBudgetUsd: 25 });
  expect(next.schedule).toEqual({ briefAtHour: 6 });
  expect(next.groups).toEqual(FRESH.groups ?? null);
  expect(next.godmode).toEqual([lead("acme-lead", { project: "Acme" })]);
  expect(next.clients).toEqual([project("Web"), project("Api")]);
  expect(conflicts).toEqual([]);
});

test("an unsaved edit to a lead or project organise changed is kept, and named as a conflict", () => {
  const draft: JsonObject = {
    ...BASE,
    clients: [project("Web", { autonomy: "watch" }), project("Api", { autonomy: "act", prefix: "API2" })],
    godmode: [lead("web", { label: "Web, renamed" }), lead("api", { project: "Api" }), lead("mine", { project: "Api" })],
  };
  const { draft: next, conflicts } = patchOrganised(draft, BASE, FRESH);
  // Web: your autonomy kept; Api: its autonomy follows the group (cleared), your other edit (prefix) untouched
  expect(next.clients).toEqual([project("Web", { autonomy: "watch" }), project("Api", { prefix: "API2" })]);
  // your renamed lead stays, the untouched one goes, your new one stays, the daemon's new one arrives
  expect(next.godmode).toEqual([
    lead("web", { label: "Web, renamed" }),
    lead("mine", { project: "Api" }),
    lead("acme-lead", { project: "Acme" }),
  ]);
  expect(conflicts.sort()).toEqual(["lead:web", "project:Web"]);
});

test("rows organise didn't touch are left exactly as you edited them", () => {
  const fresh: JsonObject = { ...BASE, groups: [{ name: "Solo", members: ["Web"], rules: {} }] };
  const draft: JsonObject = { ...BASE, godmode: [lead("web", { prompt: "mine" }), lead("api", { project: "Api" })] };
  const { draft: next, conflicts } = patchOrganised(draft, BASE, fresh);
  expect(next.godmode).toEqual(draft.godmode ?? null);
  expect(next.clients).toEqual(BASE.clients ?? null);
  expect(conflicts).toEqual([]);
});
