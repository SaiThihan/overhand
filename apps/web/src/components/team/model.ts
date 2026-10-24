/**
 * What the Team view shows, computed from the daemon's team state alone (no clock of its own: `now` is the state's), so
 * it renders only when the state changes. Pure, for the view and its tests.
 */
import { claimsOf, memberName, openQuestions, type Presence, type TeamEvent, type TeamState, WAIT_MS, waitingOn } from "@overhand/contract";

/** One person on the Team view: a hub with their own rings. */
export type Hub = {
  user: string;
  name: string;
  initials: string;
  me: boolean;
  online: boolean;
  quiet: boolean;
  agents: number;
  /** Their projects by state, as their map shows them. */
  rings: { needs: number; working: number; idle: number; red: number };
  projects: Presence["projects"];
  owns: string[];
  backs: string[];
  viewing: Presence["viewing"];
};

const initials = (name: string) =>
  name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("") || "?";

/** Every member as a hub: you first, then who's online, then everyone else by name. */
export function hubs(t: TeamState): Hub[] {
  const out = t.roster.members.map((m): Hub => {
    const p = t.online[m.user]?.presence ?? null;
    const projects = p?.projects ?? [];
    const count = (s: Presence["projects"][number]["state"]) => projects.filter((x) => x.state === s).length;
    const name = memberName(m.email);
    return {
      user: m.user,
      name,
      initials: initials(name),
      me: m.user === t.roster.me,
      online: m.user in t.online || m.user === t.roster.me,
      quiet: p?.quiet ?? false,
      agents: p?.agents ?? 0,
      rings: { needs: count("needs"), working: count("working"), idle: count("idle"), red: count("red") },
      projects,
      owns: t.roster.projects.filter((x) => x.owner === m.user).map((x) => x.project),
      backs: t.roster.projects.filter((x) => x.backup === m.user).map((x) => x.project),
      viewing: p?.viewing ?? null,
    };
  });
  return out.sort((a, b) => Number(b.me) - Number(a.me) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

/** One thing on the team's list. Only `mine` (it waits on you) is ever drawn warm. */
export type TeamItem = {
  item: string;
  kind: "question" | "handoff" | "mention" | "result";
  mine: boolean;
  by: string;
  at: number;
  project: string;
  title: string;
  text: string;
  /** A question's id, for answering. */
  question?: string;
};

/**
 * The list: what waits on you first, then open questions waiting on others, then the last day's hand-offs and results,
 * newest first, at most `max`.
 */
export function teamItems(t: TeamState, now: number, max = 30): TeamItem[] {
  const me = t.roster.me;
  const waits = waitingOn(me, t, now);
  const mine = new Set(waits.map((w) => `${w.kind}:${w.item}`));
  const out: TeamItem[] = waits.map((w) =>
    w.kind === "question"
      ? {
          item: w.item,
          kind: "question",
          mine: true,
          by: w.event.by,
          at: w.event.at,
          project: w.event.project,
          title: w.event.lead,
          text: w.event.text,
          question: w.event.id,
        }
      : w.kind === "handoff"
        ? {
            item: w.item,
            kind: "handoff",
            mine: true,
            by: w.event.by,
            at: w.event.at,
            project: w.event.project,
            title: w.event.title,
            text: w.event.note,
          }
        : { item: w.item, kind: "mention", mine: true, by: w.event.by, at: w.event.at, project: "", title: "", text: w.event.text },
  );
  const rest: TeamItem[] = [];
  for (const q of openQuestions(t.log))
    if (!mine.has(`question:q:${q.id}`))
      rest.push({
        item: `q:${q.id}`,
        kind: "question",
        mine: false,
        by: q.by,
        at: q.at,
        project: q.project,
        title: q.lead,
        text: q.text,
        question: q.id,
      });
  for (const e of t.log) {
    if (now - e.at > WAIT_MS) continue;
    if (e.k === "handoff" && !mine.has(`handoff:h:${e.id}`))
      rest.push({ item: `h:${e.id}`, kind: "handoff", mine: false, by: e.by, at: e.at, project: e.project, title: e.title, text: e.note });
    if (e.k === "result")
      rest.push({
        item: `r:${e.seq}`,
        kind: "result",
        mine: false,
        by: e.by,
        at: e.at,
        project: e.project,
        title: e.title,
        text: e.outcome,
      });
  }
  rest.sort((a, b) => b.at - a.at);
  return [...out, ...rest].slice(0, max);
}

/** Teammates (never you) who have this item open right now. */
export const viewersOf = (t: TeamState, item: string): string[] =>
  Object.entries(t.online)
    .filter(([u, o]) => u !== t.roster.me && o.presence?.viewing?.item === item)
    .map(([u]) => u);

/** Who claimed what, by item. */
export const claims = (t: TeamState): Map<string, string[]> => claimsOf(t.online);

/** Comments on an item, oldest first. */
export const commentsOn = (log: readonly TeamEvent[], item: string) =>
  log.filter((e): e is Extract<TeamEvent, { k: "comment" }> => e.k === "comment" && e.item === item);

/** A member's display name by id. */
export const nameIn = (t: TeamState, user: string): string => memberName(t.roster.members.find((m) => m.user === user)?.email ?? user);
