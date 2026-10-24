/**
 * The catalog's samples, all from the demo's scripted night (apps/web/src/demo): the dashboard state at a minute of it,
 * so every component renders on real-shaped data and every number on screen is the demo's own.
 */
import type { DashboardState, TeamState } from "@overhand/contract";
import { MOMENTS, minutesOf } from "@/demo/moments";
import { nightAt } from "@/demo/night";

/** One sample: the state at `at` minutes into the night (null: it hasn't arrived yet), and whether the daemon is gone. */
export interface Seed {
  at: number;
  state: DashboardState | null;
  /** The daemon stopped answering: the dashboard keeps the last state it sent and says so. */
  down?: boolean;
}

/** The morning after (08:00, the brief): the demo's own resting moment, and the one every inline sample shares. */
export const MORNING = minutesOf(MOMENTS.morning);

/** The morning after the night: four projects, pull requests to review, two questions waiting. */
export const morning = (): Seed => ({ at: MORNING, state: nightAt(MORNING) });

/** 07:24, the moment the night's one call reaches you: pull requests open, questions waiting, the day's spend on the clock. */
export const busy = (): Seed => {
  const at = minutesOf(MOMENTS.call);
  return { at, state: nightAt(at) };
};

/** 01:30, the night's busiest stretch: four agents at work at once. */
export const working = (): Seed => {
  const at = minutesOf("01:30");
  return { at, state: nightAt(at) };
};

/** 02:30: BOOK-88's preview deploy is failing and Booking app's error count climbs (night.ts), before its fix round. */
export const failing = (): Seed => {
  const at = minutesOf("02:30");
  return { at, state: nightAt(at) };
};

/** The same moment, and the daemon has just stopped answering. */
export const broken = (): Seed => ({ ...failing(), down: true });

/** A fresh install: no projects yet, nothing run. */
export const empty = (): Seed => {
  const s = nightAt(0);
  return {
    at: MORNING,
    state: {
      ...s,
      // nothing found yet either: no suggested rules or routing, nobody's pull requests to review
      rules: [],
      routing: { ...s.routing, suggestions: [] },
      status: { ...s.status, reviews: [], myPrs: [] },
      clients: [],
      tickets: {},
      godmode: [],
      sessions: [],
      running: [],
      instructions: [],
      guides: [],
      firstWin: null,
      team: null,
    },
  };
};

/** Before the first state arrives. */
export const loading = (): Seed => ({ at: MORNING, state: null });

/** The morning after, Sam's team (apps/web/src/demo/team.ts) changed by `edit`: fewer people, someone gone. */
export const team = (edit: (t: TeamState) => TeamState): Seed => {
  const s = nightAt(MORNING);
  return { at: MORNING, state: { ...s, team: s.team ? edit(s.team) : null } };
};

/** Sam alone: nobody else in the team. */
export const alone = (t: TeamState): TeamState => ({
  ...t,
  roster: { ...t.roster, members: t.roster.members.filter((m) => m.user === t.roster.me) },
  online: Object.fromEntries(Object.entries(t.online).filter(([u]) => u === t.roster.me)),
  log: [],
});

/** Only the people online right now: Noor, who is away, isn't in this version of the team. */
export const allHere = (t: TeamState): TeamState => ({
  ...t,
  roster: { ...t.roster, members: t.roster.members.filter((m) => m.user in t.online || m.user === t.roster.me) },
});

/** Four more fictional teammates online, six with Robin and Kai: who's here shows three faces and "+3". */
export const crowd = (t: TeamState): TeamState => {
  const extra = ["ada", "lee", "mo", "yu"];
  const like = t.online.robin;
  return {
    ...t,
    roster: {
      ...t.roster,
      seats: t.roster.members.length + extra.length,
      members: [
        ...t.roster.members,
        ...extra.map((user) => ({
          user,
          email: `${user}@example.com`,
          role: "member" as const,
          joinedAt: t.roster.members[0]?.joinedAt ?? 0,
          seated: true,
        })),
      ],
    },
    online: like ? { ...t.online, ...Object.fromEntries(extra.map((u) => [u, like])) } : t.online,
  };
};

/** The widest header: the daemon down mid-night (Pause new work, every place counting) with six teammates here. */
export const crowdedDown = (): Seed => {
  const s = broken();
  return { ...s, state: s.state?.team ? { ...s.state, team: crowd(s.state.team) } : s.state };
};
