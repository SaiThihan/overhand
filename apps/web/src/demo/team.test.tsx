import { expect, test } from "bun:test";
import { DashboardStateSchema, memberName, teamBrief } from "@overhand/contract";
import { plainWords } from "@overhand/themes";
import { renderToStaticMarkup } from "react-dom/server";
import { hubs, viewersOf } from "../components/team/model";
import { TeamMap } from "../components/team/TeamView";
import { demoState } from "./demo";
import { nightAt } from "./night";

const MORNING = 510;

test("the demo is a team workspace: Sam and three teammates, one of them away", () => {
  const t = nightAt(MORNING).team;
  expect(t).not.toBeNull();
  if (!t) return;
  expect(DashboardStateSchema.parse(demoState()).team?.roster.members).toHaveLength(4);
  expect(t.roster.me).toBe("sam");
  expect(t.roster.members.map((m) => memberName(m.email))).toEqual(["Sam", "Robin", "Kai", "Noor"]);
  const here = hubs(t).filter((h) => h.online && !h.me);
  expect(here.map((h) => h.name).sort()).toEqual(["Kai", "Robin"]);
  expect(hubs(t).find((h) => h.name === "Noor")?.online).toBe(false);
  // every project in the team is one of the night's sample projects
  const projects = new Set(nightAt(MORNING).clients.map((c) => c.name));
  expect(t.roster.projects.every((p) => projects.has(p.project))).toBe(true);
});

test("two teammates have the same pull request open, and the feed only holds what has happened", () => {
  const t = nightAt(MORNING).team;
  if (!t) throw new Error("no team");
  expect(viewersOf(t, "pr:BOOK-88").sort()).toEqual(["kai", "robin"]);
  expect(nightAt(0).team?.log).toEqual([]);
  expect(t.log.length).toBeGreaterThan(3);
  expect(teamBrief(t, t.log.at(-1)?.at ?? 0).join(" ")).toContain("Robin");
});

test("the Team map draws the sample team", () => {
  const s = nightAt(MORNING);
  if (!s.team) throw new Error("no team");
  const html = renderToStaticMarkup(
    <TeamMap
      t={s.team}
      w={plainWords}
      now={s.now}
      follow={null}
      held={[]}
      brief={teamBrief(s.team, s.now)}
      act={{ claim: () => {}, answer: () => {}, handoff: () => {}, comment: () => {}, follow: () => {}, open: () => {} }}
      look={{ world: "instrument", light: true }}
    />,
  );
  for (const name of ["Robin", "Kai", "Noor"]) expect(html).toContain(name);
});
