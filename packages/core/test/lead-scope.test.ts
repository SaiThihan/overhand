import { expect, test } from "bun:test";
import { blankConfig, type Config, type StoredClient } from "../src/config";
import { commonDir, type MemberStats, planLeadScope, recommendLeadScope, withLeadScope } from "../src/lead-scope";

const stats = (name: string, commits30d: number, openTickets = 0, sizeMb = 0): MemberStats => ({
  name,
  repos: 1,
  sizeMb,
  commits30d,
  openTickets,
});

test("advice: quiet → none; one active project → its own; a busy monorepo → its own; many small → one for the group", () => {
  expect(recommendLeadScope([stats("a", 0), stats("b", 0)]).scope).toBe("none");
  expect(recommendLeadScope([stats("mono", 120)])).toMatchObject({ scope: "repo", confidence: "high" });
  expect(recommendLeadScope([stats("mono", 90, 30), stats("docs", 2)])).toMatchObject({ scope: "repo" });
  expect(recommendLeadScope([stats("mono", 90), stats("docs", 2)]).reason).toMatch(/mono is busy/);
  expect(recommendLeadScope([stats("web", 60), stats("api", 50), stats("ios", 1), stats("site", 0)]).scope).toBe("repo");
  const many = recommendLeadScope(["a", "b", "c", "d", "e"].map((n) => stats(n, 3, 2)));
  expect(many).toMatchObject({ scope: "group", confidence: "high" });
  expect(many.reason).toMatch(/5 projects/);
  // one busy among many small: still one lead, less sure
  expect(recommendLeadScope([stats("a", 50), ...["b", "c", "d"].map((n) => stats(n, 1))])).toMatchObject({
    scope: "group",
    confidence: "low",
  });
  // a big repo still moving counts as busy
  expect(recommendLeadScope([stats("big", 20, 0, 4000), stats("x", 1), stats("y", 1)]).scope).toBe("repo");
});

test("the group lead's folder is the one its members share", () => {
  expect(commonDir(["acme/web", "acme/api"])).toBe("acme");
  expect(commonDir(["acme/web"])).toBe("acme/web");
  expect(commonDir(["web", "api"])).toBe("web");
});

const project = (name: string, dir: string): StoredClient => ({
  name,
  dir,
  prefix: name.toUpperCase(),
  host: "github",
  tracker: { kind: "github", repo: `acme/${name.toLowerCase()}` },
  aliases: [],
  status: { vercelSecrets: [], sentrySecrets: [] },
});

const lead = (key: string, projectName: string, over: Partial<Config["godmode"][number]> = {}): Config["godmode"][number] => ({
  key,
  label: key,
  name: "",
  dir: key,
  project: projectName,
  goal: "",
  prompt: "",
  supervised: true,
  onDemand: false,
  account: "",
  fallbackToAll: true,
  lockFile: "",
  lockStaleMin: 45,
  inboxFile: "",
  restartAfterMin: 5,
  maxCrashesPerHour: 3,
  answerWaitHours: 4,
  ...over,
});

const cfg = (godmode: Config["godmode"]): Config => ({
  ...blankConfig("alex"),
  accounts: ["main"],
  clients: [project("Web", "acme/web"), project("Api", "acme/api"), project("Kite", "kite")],
  groups: [{ name: "Acme", members: ["Web", "Api"], rules: {} }],
  godmode,
});

test("one lead for the group: made from the first member lead's settings; member leads go; other groups untouched", () => {
  const c = cfg([
    lead("web", "Web", { prompt: "godmode", pushBranches: ["develop"], account: "main", lockFile: "web/.lock" }),
    lead("api", "Api"),
    lead("kite", "Kite"),
  ]);
  const plan = planLeadScope(c, "Acme", "group", { running: new Set() });
  expect(plan.removed.sort()).toEqual(["api", "web"]);
  expect(plan.added).toEqual(["acme-lead"]);
  const made = plan.godmode.find((l) => l.key === "acme-lead");
  expect(made).toMatchObject({ project: "Acme", dir: "acme", prompt: "godmode", pushBranches: ["develop"], account: "main", lockFile: "" });
  expect(plan.godmode.map((l) => l.key)).toEqual(["kite", "acme-lead"]);
  const next = withLeadScope(c, "Acme", "group", plan);
  expect(next.groups[0]?.lead).toBe("group");
  // applying it again keeps the group lead and changes nothing
  const again = planLeadScope(next, "Acme", "group", { running: new Set() });
  expect(again).toMatchObject({ added: [], removed: [], blocked: [] });
});

test("one lead per project: each member keeps its lead or gets one from the group lead's settings", () => {
  const c = cfg([lead("acme", "Acme", { goal: "ship", onDemand: true }), lead("web", "Web", { prompt: "mine" })]);
  const plan = planLeadScope(c, "Acme", "repo", { running: new Set() });
  expect(plan.removed).toEqual(["acme"]);
  expect(plan.added).toEqual(["api-lead"]);
  expect(plan.godmode.find((l) => l.key === "web")?.prompt).toBe("mine");
  expect(plan.godmode.find((l) => l.key === "api-lead")).toMatchObject({ project: "Api", dir: "acme/api", goal: "ship", onDemand: true });
  // only active members get a new lead when asked
  expect(planLeadScope(c, "Acme", "repo", { running: new Set(), activeOnly: new Set(["Web"]) }).added).toEqual([]);
});

test("a running lead is never removed without a confirm: nothing changes until then", () => {
  const c = cfg([lead("web", "Web"), lead("api", "Api")]);
  const held = planLeadScope(c, "Acme", "none", { running: new Set(["web"]) });
  expect(held).toMatchObject({ blocked: ["web"], removed: [], added: [] });
  expect(held.godmode).toEqual(c.godmode);
  expect(withLeadScope(c, "Acme", "none", held)).toBe(c);
  const confirmed = planLeadScope(c, "Acme", "none", { running: new Set(["web"]), confirm: true });
  expect(confirmed.removed.sort()).toEqual(["api", "web"]);
  expect(confirmed.blocked).toEqual([]);
  expect(confirmed.godmode).toEqual([]);
  expect(() => planLeadScope(c, "Nope", "none", { running: new Set() })).toThrow(/no group/);
});

test("new lead keys never collide with existing ones", () => {
  const c = cfg([lead("acme-lead", "Kite"), lead("web", "Web")]);
  expect(planLeadScope(c, "Acme", "group", { running: new Set() }).added).toEqual(["acme-lead-2"]);
});
