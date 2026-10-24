import { expect, test } from "bun:test";
import { type HistoryRun, hemisphereOf, newMilestones, ProgressionSchema, progressionOf, seasonOf, tierOf, weekStart } from "../src/index";

const H = 3600_000;
const DAY = 24 * H;
// a Tuesday noon, local time
const NOW = new Date(2026, 9, 20, 12, 0).getTime();

function run(project: string, end: number, outcome: HistoryRun["outcome"], merged?: { at: number; fixes: number }): HistoryRun {
  return {
    project,
    key: `K-${end}`,
    kind: "ticket",
    account: "a",
    runtime: "claude-code",
    provider: "claude",
    model: "",
    start: end - H,
    end,
    cost: 1,
    billing: "plan",
    outcome,
    ...(merged ? { pr: { url: "", state: "merged" as const, fixes: merged.fixes, changes: 0, openedAt: end, doneAt: merged.at } } : {}),
  };
}
const merge = (project: string, at: number, fixes = 0) => run(project, at - H, "pr", { at, fixes });

test("tiers grow about log2 in merges: 1, 2, 4, 8 … 128 reach 1 … 8, and stop there", () => {
  expect([0, 1, 2, 3, 4, 7, 8, 15, 16, 32, 64, 127, 128, 5000].map(tierOf)).toEqual([0, 1, 2, 2, 3, 3, 4, 4, 5, 6, 7, 7, 8, 8]);
});

test("the season follows the calendar and the hemisphere, and the hemisphere the time zone", () => {
  expect(seasonOf(new Date(2026, 0, 10), "north")).toBe("winter");
  expect(seasonOf(new Date(2026, 0, 10), "south")).toBe("summer");
  expect(seasonOf(new Date(2026, 3, 10), "north")).toBe("spring");
  expect(seasonOf(new Date(2026, 6, 10), "south")).toBe("winter");
  expect(seasonOf(new Date(2026, 9, 20), "north")).toBe("autumn");
  expect(seasonOf(new Date(2026, 11, 1), "north")).toBe("winter");
  expect(hemisphereOf("Australia/Sydney")).toBe("south");
  expect(hemisphereOf("America/Argentina/Buenos_Aires")).toBe("south");
  expect(hemisphereOf("Pacific/Auckland")).toBe("south");
  expect(hemisphereOf("Europe/Helsinki")).toBe("north");
  expect(hemisphereOf("America/New_York")).toBe("north");
  expect(hemisphereOf("")).toBe("north");
});

test("an existing history is backfilled: merges, first-try merges, clean weeks and milestones from the past", () => {
  const thisWeek = weekStart(NOW);
  // 12 merges over the last 12 weeks, one a week; every third needed a fix round; one week also had a failed run
  const history = [
    ...Array.from({ length: 12 }, (_, i) => merge("Honeycrust", thisWeek - (12 - i) * 7 * DAY + 2 * DAY, i % 3 === 0 ? 1 : 0)),
    run("Honeycrust", thisWeek - 5 * 7 * DAY + 3 * DAY, "failed"),
    merge("Fernway", NOW - DAY),
    run("Fernway", NOW - 2 * H, "pr"),
  ];
  const p = progressionOf(history, ["Honeycrust", "Fernway", "Potluck"], {}, NOW, "autumn");
  const honey = p.projects.find((x) => x.name === "Honeycrust");
  expect(honey).toMatchObject({ merges: 12, firstTry: 8, cleanWeeks: 11, scars: [] });
  expect(honey?.recent).toBe(4); // the last 30 days
  expect(honey?.milestones.map((m) => m.id)).toEqual(["merge-1", "clean-week", "first-try", "merge-10"]);
  // the 10th merge is the milestone's moment, the first clean week's end is Monday midnight after it
  expect(honey?.milestones.find((m) => m.id === "merge-10")?.at).toBe(history[9]?.pr?.doneAt);
  expect(honey?.milestones.find((m) => m.id === "clean-week")?.at).toBe(weekStart(thisWeek - 11 * 7 * DAY));
  // this week isn't over: Fernway's merge doesn't make a clean week yet
  expect(p.projects.find((x) => x.name === "Fernway")).toMatchObject({ merges: 1, cleanWeeks: 0 });
  // a project with no history yet starts bare
  expect(p.projects.find((x) => x.name === "Potluck")).toMatchObject({ merges: 0, scars: [], milestones: [] });
});

test("a failed last run is a scar until a later run opens a PR; outside scars come in as given", () => {
  const failedAt = NOW - 3 * H;
  const open = progressionOf([merge("Bluekite", NOW - DAY), run("Bluekite", failedAt, "failed")], [], {}, NOW, "autumn");
  expect(open.projects[0]?.scars).toEqual([{ kind: "run", since: failedAt }]);
  const fixed = progressionOf(
    [merge("Bluekite", NOW - DAY), run("Bluekite", failedAt, "failed"), run("Bluekite", NOW - H, "pr")],
    [],
    {},
    NOW,
    "autumn",
  );
  expect(fixed.projects[0]?.scars).toEqual([]);
  const ci = progressionOf([], ["Bluekite"], { Bluekite: [{ kind: "ci", since: 5 }] }, NOW, "autumn");
  expect(ci.projects[0]?.scars).toEqual([{ kind: "ci", since: 5 }]);
});

test("each milestone is reached once, keeps its moment, and the brief tells it exactly once", () => {
  const history = Array.from({ length: 10 }, (_, i) => merge("Honeycrust", NOW - (10 - i) * H));
  const a = progressionOf(history, [], {}, NOW, "autumn");
  const later = progressionOf(
    [...history, ...Array.from({ length: 5 }, (_, i) => merge("Honeycrust", NOW + i * H))],
    [],
    {},
    NOW + 9 * H,
    "autumn",
  );
  const ids = (p: typeof a) => p.projects[0]?.milestones.map((m) => m.id) ?? [];
  expect(ids(a).filter((id) => id === "merge-10")).toHaveLength(1);
  expect(later.projects[0]?.milestones).toEqual(a.projects[0]?.milestones ?? []);
  // two briefs, each covering the time since the last: the 10th merge lands in exactly one of them
  const firstBrief = newMilestones(a, NOW - DAY, NOW).filter((m) => m.id === "merge-10");
  const secondBrief = newMilestones(later, NOW, NOW + DAY).filter((m) => m.id === "merge-10");
  expect(firstBrief).toHaveLength(1);
  expect(secondBrief).toHaveLength(0);
});

test("quiet weeks never decay anything: weeks later with no new runs, nothing went down", () => {
  const history = [
    ...Array.from({ length: 20 }, (_, i) => merge("Honeycrust", NOW - (60 - i * 2) * DAY, i % 2)),
    run("Honeycrust", NOW - 2 * DAY, "pr"),
  ];
  const before = progressionOf(history, [], {}, NOW, "autumn").projects[0];
  for (const weeks of [1, 4, 12, 52]) {
    const after = progressionOf(history, [], {}, NOW + weeks * 7 * DAY, "winter").projects[0];
    expect(after?.merges).toBe(before?.merges ?? -1);
    expect(after?.firstTry).toBe(before?.firstTry ?? -1);
    expect(after?.cleanWeeks).toBeGreaterThanOrEqual(before?.cleanWeeks ?? 0);
    expect(after?.milestones.length).toBeGreaterThanOrEqual(before?.milestones.length ?? 0);
    expect(tierOf(after?.merges ?? 0)).toBe(tierOf(before?.merges ?? 0));
  }
});

test("an older daemon's state parses to a bare world in the current season", () => {
  const p = ProgressionSchema.parse({});
  expect(p.projects).toEqual([]);
  expect(["spring", "summer", "autumn", "winter"]).toContain(p.season);
  expect(ProgressionSchema.parse({ projects: [{ name: "X" }] }).projects[0]).toEqual({
    name: "X",
    merges: 0,
    recent: 0,
    firstTry: 0,
    cleanWeeks: 0,
    scars: [],
    milestones: [],
  });
});
