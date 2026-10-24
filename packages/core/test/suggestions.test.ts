import { expect, test } from "bun:test";
import { BriefSchema } from "@overhand/contract";
import { type OrganiseFacts, suggestionBrief, suggestions } from "../src/suggestions";

const NOW = new Date(2026, 9, 21, 12).getTime();
const DAY = 86_400_000;

type P = OrganiseFacts["projects"][number];
const p = (name: string, over: Partial<P> = {}): P => ({
  name,
  dir: name.toLowerCase(),
  owners: [],
  repos: 1,
  sizeMb: 0,
  commits30d: 5,
  openTickets: 1,
  lastCommit: NOW - DAY,
  ...over,
});

const facts = (over: Partial<OrganiseFacts> = {}): OrganiseFacts => ({
  now: NOW,
  groups: [],
  projects: [],
  leads: [],
  clones: [],
  tidy: { moves: [], skipped: [] },
  ...over,
});

const kinds = (f: OrganiseFacts) => suggestions(f).map((s) => s.id);

test("nothing to say about a tidy setup", () => {
  expect(suggestions(facts({ projects: [p("Web")] }))).toEqual([]);
});

test("second full clones: keep one, the rest become worktrees, with the dry run", () => {
  const [s] = suggestions(facts({ clones: [{ remote: "github.com/acme/web", keep: "/code/web", extra: ["/code/old/web"] }] }));
  expect(s?.id).toBe("dedupe-clones:github.com/acme/web");
  expect(s?.recommend.option).toBe("apply");
  expect(s?.preview).toEqual(["keep /code/web", "/code/old/web → a worktree of /code/web (the old folder kept for undo)"]);
  expect(suggestions(facts({ clones: [{ remote: "r", keep: "/a", extra: [] }] }))).toEqual([]);
});

test("one tracker, two groups: group them where one already is", () => {
  const f = facts({
    groups: [{ name: "Acme", members: ["Web"] }],
    projects: [p("Web", { tracker: "jira:acme/ac" }), p("Api", { tracker: "jira:acme/ac" }), p("Kite", { tracker: "github:k/k" })],
  });
  const s = suggestions(f).find((x) => x.kind === "group-tracker");
  expect(s).toMatchObject({ id: "group-tracker:jira:acme/ac", target: "Acme", preview: ["Api → Acme"] });
  // already together: nothing
  expect(kinds(facts({ ...f, groups: [{ name: "Acme", members: ["Web", "Api"] }] })).filter((k) => k.startsWith("group-tracker"))).toEqual(
    [],
  );
});

test("one lead over many or several busy projects: split it", () => {
  const groups = [{ name: "Acme", members: ["Web", "Api", "Ios"] }];
  const busy = facts({
    groups,
    projects: [p("Web", { commits30d: 80 }), p("Api", { commits30d: 50 }), p("Ios")],
    leads: [{ key: "acme", project: "Acme", supervised: true }],
  });
  const s = suggestions(busy).find((x) => x.kind === "split-lead");
  expect(s?.id).toBe("split-lead:acme");
  expect(s?.recommend.confidence).toBe("high");
  const calm = facts({ ...busy, projects: [p("Web"), p("Api"), p("Ios")] });
  expect(suggestions(calm).some((x) => x.kind === "split-lead")).toBe(false);
  const many = ["A", "B", "C", "D", "E", "F", "G"];
  const wide = facts({
    groups: [{ name: "Big", members: many }],
    projects: many.map((n) => p(n)),
    leads: [{ key: "big", project: "Big", supervised: true }],
  });
  expect(suggestions(wide).some((x) => x.id === "split-lead:big")).toBe(true);
});

test("a group quiet for 30 days with its lead on: pause the lead", () => {
  const quiet = facts({
    groups: [{ name: "Old", members: ["Legacy"] }],
    projects: [p("Legacy", { lastCommit: NOW - 45 * DAY, openTickets: 0, commits30d: 0 })],
    leads: [{ key: "old", project: "Old", supervised: true }],
  });
  const s = suggestions(quiet).find((x) => x.kind === "pause-lead");
  expect(s?.what).toBe("Old has been quiet for 45 days, and its lead is on");
  // an open ticket, a recent commit, or a lead already off: nothing
  expect(
    suggestions(facts({ ...quiet, projects: [p("Legacy", { lastCommit: NOW - 45 * DAY })] })).some((x) => x.kind === "pause-lead"),
  ).toBe(false);
  expect(suggestions(facts({ ...quiet, leads: [{ key: "old", project: "Old", supervised: false }] }))).toEqual([]);
});

test("a project in no group, once groups are in use: where it fits, or leave it", () => {
  const f = facts({
    groups: [{ name: "Acme", members: ["Web"] }],
    projects: [p("Web", { owners: ["acme"] }), p("Api", { owners: ["acme"] }), p("Blog", { owners: ["alex"] })],
  });
  const api = suggestions(f).find((x) => x.id === "ungrouped:Api");
  expect(api).toMatchObject({ target: "Acme", recommend: { option: "apply" } });
  const blog = suggestions(f).find((x) => x.id === "ungrouped:Blog");
  expect(blog?.recommend.option).toBe("dismiss");
  // no groups yet: no nagging
  expect(suggestions(facts({ projects: f.projects }))).toEqual([]);
});

test("the folder tidy is optional: the dry run first, every move and skip listed", () => {
  const [s] = suggestions(
    facts({ tidy: { moves: [{ from: "web", to: "acme/web" }], skipped: [{ path: "api", why: "it has uncommitted work" }] } }),
  );
  expect(s?.recommend).toMatchObject({ option: "preview", confidence: "low" });
  expect(s?.preview).toEqual(["web → acme/web (a link left at the old path)", "skipped api: it has uncommitted work"]);
});

test("a dismissed suggestion stays dismissed until its facts change", () => {
  const f = facts({ clones: [{ remote: "r", keep: "/a", extra: ["/b"] }] });
  const [s] = suggestions(f);
  if (!s) throw new Error("a suggestion");
  expect(suggestions(f, { [s.id]: s.fingerprint })).toEqual([]);
  const changed = facts({ clones: [{ remote: "r", keep: "/a", extra: ["/b", "/c"] }] });
  expect(suggestions(changed, { [s.id]: s.fingerprint })).toHaveLength(1);
});

test("a suggestion is a valid decision card with organise options", () => {
  const [s] = suggestions(facts({ clones: [{ remote: "r", keep: "/a", extra: ["/b"] }] }));
  if (!s) throw new Error("a suggestion");
  const b = BriefSchema.parse(suggestionBrief(s, NOW));
  expect(b.id).toBe("organise:dedupe-clones:r");
  expect(b.options.map((o) => (o.do === "organise" ? o.action : o.do))).toEqual(["apply", "dismiss"]);
  expect(b.ifNothing?.text).toMatch(/Nothing changes/);
});
