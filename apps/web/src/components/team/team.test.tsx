import { expect, spyOn, test } from "bun:test";
import { type TeamEvent, type TeamState, waitingOn } from "@overhand/contract";
import { plainWords } from "@overhand/themes";
import { renderToStaticMarkup } from "react-dom/server";
import { hubs, teamItems } from "./model";
import { type TeamActs, TeamMap } from "./TeamView";

const NOW = 1_800_000_000_000;
const none: TeamActs = { claim: () => {}, answer: () => {}, handoff: () => {}, comment: () => {}, follow: () => {}, open: () => {} };

/** A big team: `n` people, each with 24 projects, and a full catch-up log. */
function bigTeam(n: number): TeamState {
  const users = Array.from({ length: n }, (_, i) => `user_${i}`);
  const log: TeamEvent[] = [];
  for (let i = 0; i < 200; i++) {
    const by = users[i % n] ?? "user_0";
    const at = NOW - i * 60_000;
    if (i % 4 === 0)
      log.push({
        k: "question",
        id: `q${i}`,
        project: `P${i % 24}`,
        lead: "Lead",
        text: "Which provider should checkout use?",
        fallback: "",
        by,
        at,
        seq: i + 1,
      });
    else if (i % 4 === 1)
      log.push({ k: "result", project: `P${i % 24}`, title: `Fix ${i}`, outcome: "merged", pr: null, by, at, seq: i + 1 });
    else if (i % 4 === 2)
      log.push({
        k: "handoff",
        id: `h${i}`,
        to: users[(i + 1) % n] ?? "user_0",
        project: "P1",
        title: `Task ${i}`,
        key: null,
        note: "",
        by,
        at,
        seq: i + 1,
      });
    else log.push({ k: "comment", id: `c${i}`, item: `q:q${i - 3}`, text: "@user_0 look", mentions: ["user_0"], by, at, seq: i + 1 });
  }
  return {
    roster: {
      team: { id: "org_1", name: "Crew" },
      me: "user_0",
      role: "admin",
      seats: n,
      over: null,
      members: users.map((u, i) => ({ user: u, email: `${u}@x.dev`, role: i === 0 ? "owner" : "member", joinedAt: i, seated: true })),
      invites: [],
      projects: Array.from({ length: 24 }, (_, i) => ({
        project: `P${i}`,
        owner: users[i % n] ?? null,
        backup: users[(i + 1) % n] ?? null,
      })),
    },
    connected: true,
    online: Object.fromEntries(
      users.map((u, i) => [
        u,
        {
          at: NOW,
          presence: {
            k: "presence" as const,
            agents: i,
            quiet: i % 5 === 0,
            viewing: i % 3 === 0 ? { item: "q:q0", label: "Q" } : null,
            claims: i % 4 === 0 ? [{ item: "q:q4", label: "Q" }] : [],
            projects: Array.from({ length: 24 }, (_, p) => ({
              name: `P${p}`,
              state: (["working", "needs", "idle", "red"] as const)[p % 4] ?? "idle",
              agents: p % 3,
            })),
          },
        },
      ]),
    ),
    log,
    problem: "",
    sharePrs: false,
  };
}

const render = (t: TeamState, follow: string | null = null) =>
  renderToStaticMarkup(
    <TeamMap
      t={t}
      w={plainWords}
      now={NOW}
      follow={follow}
      held={[{ id: "f1", project: "P1", title: "Flaky test", key: "P-1" }]}
      brief={["Brief."]}
      act={none}
      look={{ world: "instrument", light: false }}
    />,
  );

// best of N: a shared CI runner's pauses (GC, a noisy neighbour) only ever add time, so the fastest run is the stable one
const fastest = (xs: number[]) => Math.min(...xs);

test("the Team view scales with the team, and schedules nothing: no timers, no animation frames", () => {
  const t = bigTeam(20);
  const t1 = bigTeam(1);
  const timers = [spyOn(globalThis, "setInterval"), spyOn(globalThis, "setTimeout")];
  try {
    // warm up both, then time them interleaved so they share whatever load the machine is under
    render(t);
    render(t1);
    const team: number[] = [];
    const one: number[] = [];
    const time = (f: () => unknown) => {
      const at = performance.now();
      f();
      return performance.now() - at;
    };
    for (let i = 0; i < 15; i++) {
      team.push(time(() => render(t)));
      one.push(time(() => render(t1)));
    }
    // The yardstick is the Team view itself with one person, so both sides are the same code on the same CPU: a plain
    // list as the yardstick measured 2–3× locally but up to 5.8× on CI runners. 20 people cost about 15× one person
    // (measured 2026-10-22); anything quadratic would cost hundreds of times, so 30× fails it with room for noise.
    // ponytail: guards scaling only; a slowdown that hits every team size alike needs a real-browser trace to catch.
    expect(fastest(team)).toBeLessThan(30 * fastest(one));
    for (const s of timers) expect(s).not.toHaveBeenCalled();
  } finally {
    for (const s of timers) s.mockRestore();
  }
  // nothing in it asks for animation frames either (the browser's loop for motion)
  expect(TeamMap.toString()).not.toContain("requestAnimationFrame");
  const html = render(t);
  // presence is static: no pulse, no SVG or CSS animation
  expect(html).not.toMatch(/m-pulse|<animate|animate-/);
});

test("only what waits on you is warm", () => {
  const t = bigTeam(5);
  const html = render(t);
  const mine = waitingOn("user_0", t, NOW).length;
  expect(mine).toBeGreaterThan(0);
  expect(html.match(/data-mine=""/g)?.length ?? 0).toBe(Math.min(mine, 30));
  // a teammate's hub draws what waits on them in ink: every hub but yours is marked theirs
  expect(html.match(/hub-theirs/g)?.length ?? 0).toBe(hubs(t).length - 1);
});

test("following someone shows their map; hubs put you first, then who's online", () => {
  const t = bigTeam(4);
  delete t.online.user_3;
  expect(hubs(t).map((h) => [h.user, h.online])).toEqual([
    ["user_0", true],
    ["user_1", true],
    ["user_2", true],
    ["user_3", false],
  ]);
  const html = render(t, "user_2");
  expect(html).toContain("Following User_2");
  expect(teamItems(t, NOW).length).toBeLessThanOrEqual(30);
});
