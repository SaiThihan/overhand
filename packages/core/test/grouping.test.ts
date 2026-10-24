import { expect, test } from "bun:test";
import { type GroupUnit, parentFolder, proposeGrouping, signalsOf, stem } from "../src/grouping";

const unit = (name: string, dir: string, owners: string[], over: Partial<GroupUnit> = {}): GroupUnit => ({ name, dir, owners, ...over });

/** A freelancer's code folder: two clients, an employer's monorepo, side projects, and open source. */
const FIXTURE: GroupUnit[] = [
  unit("acme-web", "clients/acme/web", ["AcmeCo"], { tracker: "linear:acm", slack: "acme" }),
  unit("acme-api", "clients/acme/api", ["AcmeCo"], { tracker: "linear:acm", slack: "acme" }),
  unit("acme-ios", "clients/acme/ios", ["acmeco"]),
  unit("bluekite", "clients/bluekite", ["bluekite-labs"], { tracker: "jira:bluekite.atlassian.net/bk" }),
  unit("bluekite-infra", "bluekite-infra", ["bk-ops"], { tracker: "jira:bluekite.atlassian.net/bk" }),
  unit("monorepo", "work/monorepo", ["bigcorp"], { slack: "bigcorp" }),
  unit("dotfiles", "dotfiles", ["alex"]),
  unit("blog", "blog", ["alex"]),
  unit("left-pad", "oss/left-pad", ["npm-things"]),
];

test("signals: owners, tracker, workspace, a meaningful parent folder and name stems", () => {
  expect(parentFolder("clients/acme/web")).toBe("acme");
  expect(parentFolder("work/monorepo")).toBe("");
  expect(parentFolder("blog")).toBe("");
  expect(stem("acme-web")).toBe("acme");
  expect(stem("web-app")).toBe("");
  expect(stem("2024-notes")).toBe("");
  expect(signalsOf(FIXTURE[0] ?? unit("", "", []))).toEqual([
    { kind: "owner", value: "acmeco" },
    { kind: "tracker", value: "linear:acm" },
    { kind: "slack", value: "acme" },
    { kind: "folder", value: "acme" },
    { kind: "name", value: "acme" },
    { kind: "name", value: "acmeco" },
  ]);
});

test("a freelancer's folder groups by client, keeps work and open source apart, and pairs side projects by owner", () => {
  const groups = proposeGrouping(FIXTURE);
  const of = (name: string) => groups.find((g) => g.members.includes(name));
  expect(of("acme-web")?.members).toEqual(["acme-web", "acme-api", "acme-ios"]);
  expect(of("acme-web")?.name).toBe("AcmeCo");
  expect(of("acme-web")?.reason).toBe("All 3 share the AcmeCo org on the code host and the acme/ folder");
  expect(of("acme-web")?.confidence).toBe(0.9);
  // different orgs, one Jira project
  expect(of("bluekite")?.members).toEqual(["bluekite", "bluekite-infra"]);
  expect(of("bluekite")?.reason).toBe("All 2 share Jira project BK and names starting “bluekite”");
  expect(of("bluekite")?.confidence).toBe(0.95);
  expect(of("dotfiles")?.members).toEqual(["dotfiles", "blog"]);
  expect(of("monorepo")?.members).toEqual(["monorepo"]);
  expect(of("monorepo")?.reason).toMatch(/stands alone/);
  expect(of("left-pad")?.members).toEqual(["left-pad"]);
  // every unit lands in exactly one group, and the same facts give the same proposal
  expect(groups.flatMap((g) => g.members).sort()).toEqual(FIXTURE.map((u) => u.name).sort());
  expect(proposeGrouping(FIXTURE)).toEqual(groups);
});

test("a chain of weak links reads as less sure than a shared fact", () => {
  const groups = proposeGrouping([
    unit("a", "a", ["one"], { slack: "s1" }),
    unit("b", "b", ["two"], { slack: "s1", tracker: "github:two/b" }),
    unit("c", "c", ["three"], { tracker: "github:two/b" }),
  ]);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.reason).toMatch(/Linked one to the next/);
  expect(groups[0]?.confidence).toBeLessThan(0.8);
});

test("names stay unique when two groups would take the same one", () => {
  const groups = proposeGrouping([unit("x", "x", ["Same"]), unit("y", "y", ["same"]), unit("Same", "z", [])]);
  expect(new Set(groups.map((g) => g.name.toLowerCase())).size).toBe(groups.length);
});

test("nothing in, nothing out", () => {
  expect(proposeGrouping([])).toEqual([]);
});
