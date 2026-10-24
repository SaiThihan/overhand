import type { Autonomy } from "@overhand/contract";
import {
  type AgentPr,
  branchWords,
  type DashboardState,
  LEAD_WORK,
  type LeadWorkItem,
  type LeadWorkKind,
  leadWork,
  templateKey,
  type Worktree,
  workId,
  workName,
} from "@overhand/contract";
import type { WordKey, Words } from "@overhand/themes";
import { fmt } from "./format";

/** Most leads wake within minutes of their work showing up; the ones read from the repo itself wake on its own pace. */
const SOON = "leadPreviewWakesLine";

/**
 * Each ready-made lead's words: its name, why it's suggested (with the count), what it watches and does, how often it
 * wakes, its first run. The one place a template's name comes from: the suggestion, its preview and the docs page.
 */
export const LEAD_WORDS = {
  reviews: {
    name: "leadNameReviews",
    why: "leadWhyReviews",
    whyOne: "leadWhyReviewsOne",
    watches: "leadWatchesReviews",
    does: "leadDoesReviews",
    wakes: SOON,
    now: "leadNowReviews",
  },
  ci: {
    name: "leadNameCi",
    why: "leadWhyCi",
    whyOne: "leadWhyCiOne",
    watches: "leadWatchesCi",
    does: "leadDoesCi",
    wakes: SOON,
    now: "leadNowCi",
  },
  errors: {
    name: "leadNameErrors",
    why: "leadWhyErrors",
    whyOne: "leadWhyErrorsOne",
    watches: "leadWatchesErrors",
    does: "leadDoesErrors",
    wakes: SOON,
    now: "leadNowErrors",
  },
  deps: {
    name: "leadNameDeps",
    why: "leadWhyDeps",
    whyOne: "leadWhyDepsOne",
    watches: "leadWatchesDeps",
    does: "leadDoesDeps",
    wakes: SOON,
    now: "leadNowDeps",
  },
  current: {
    name: "leadNameCurrent",
    why: "leadWhyCurrent",
    whyOne: "leadWhyCurrentOne",
    watches: "leadWatchesCurrent",
    does: "leadDoesCurrent",
    wakes: "leadWakesCurrent",
    now: "leadNowCurrent",
  },
  untested: {
    name: "leadNameUntested",
    why: "leadWhyUntested",
    whyOne: "leadWhyUntestedOne",
    watches: "leadWatchesUntested",
    does: "leadDoesUntested",
    wakes: "leadWakesDaily",
    now: "leadNowUntested",
  },
  todos: {
    name: "leadNameTodos",
    why: "leadWhyTodos",
    whyOne: "leadWhyTodosOne",
    watches: "leadWatchesTodos",
    does: "leadDoesTodos",
    wakes: "leadWakesDaily",
    now: "leadNowTodos",
  },
  backlog: {
    name: "leadNameBacklog",
    why: "leadWhyBacklog",
    whyOne: "leadWhyBacklogOne",
    watches: "leadWatchesBacklog",
    does: "leadDoesBacklog",
    wakes: SOON,
    now: "leadNowBacklog",
  },
} as const satisfies Record<LeadWorkKind, Record<"name" | "why" | "whyOne" | "watches" | "does" | "wakes" | "now", WordKey>>;

/** A ready-made lead worth starting on a project: the work it would take now, or (no items) the connection it needs. */
export interface Suggestion {
  project: string;
  kind: LeadWorkKind;
  items: LeadWorkItem[];
  /** It can't see its kind of work yet: connect this first. */
  needs?: "sentry";
}

/**
 * Ready-made leads each project could use, from its own work right now (the same `leadWork` that would wake them): a
 * kind with nothing to do isn't offered, nor one a lead there already watches. Most work first. Without Sentry the
 * errors lead is offered as a connection to make, last.
 */
export function suggestions(s: Pick<DashboardState, "clients" | "godmode" | "status" | "tickets" | "labels">): Suggestion[] {
  return s.clients
    .flatMap((c) => {
      const leads = s.godmode.filter((g) => g.project === c.name);
      // a lead with no `watch` takes any work, so it covers every kind; a ready-made one covers its own
      const covered = (k: LeadWorkKind) =>
        leads.some((g) => g.key === templateKey(c.name, k) || (g.supervised && (!g.watch?.length || g.watch.includes(k))));
      const tix = s.tickets[c.name];
      const work = leadWork(c.name, s.status, Array.isArray(tix) ? tix : [], s.labels.queue);
      return LEAD_WORK.filter((k) => !covered(k)).flatMap((kind): Suggestion[] => {
        const items = work.filter((i) => i.kind === kind);
        if (items.length) return [{ project: c.name, kind, items }];
        return kind === "errors" && typeof s.status.sentry === "string" ? [{ project: c.name, kind, items, needs: "sentry" }] : [];
      });
    })
    .sort((a, b) => Number(!!a.needs) - Number(!!b.needs) || b.items.length - a.items.length);
}

/** "shop#4, shop#7 and BOOK-91": the work a first run would take, at most `max` named. */
export function refList(items: readonly LeadWorkItem[], max = 3): string {
  const refs = items.slice(0, max).map((i) => i.ref);
  const more = items.length - refs.length;
  if (more > 0) return `${refs.join(", ")} and ${more} more`;
  return refs.length > 1 ? `${refs.slice(0, -1).join(", ")} and ${refs.at(-1)}` : (refs[0] ?? "");
}

/**
 * The short name of the work in a folder: the person's own words first, then the project's own words for it (`vocab`,
 * from the daemon), else its place (contract `workName`).
 */
export function placeName(
  s: Pick<DashboardState, "names" | "tickets">,
  o: { project: string; branch: string; own?: string; vocab?: readonly string[]; fallback: string },
): string {
  const tix = s.tickets[o.project];
  return workName({
    renamed: o.branch ? s.names[workId(o.project, o.branch)] : undefined,
    own: o.own,
    branch: o.branch,
    tickets: Array.isArray(tix) ? tix : [],
    vocab: o.vocab,
    fallback: o.fallback,
  });
}

/** Worktrees in the order a person scans them: the main checkout, then the ones someone is in, then the newest. */
export function byUse(list: readonly Worktree[]): Worktree[] {
  return [...list].sort((a, b) => Number(b.main) - Number(a.main) || b.who.length - a.who.length || b.usedAt - a.usedAt);
}

/** Each level's name (Settings, quick settings, groups and the site's rules piece say the same). */
export const LEVEL_WORDS = {
  watch: "autonomyWatchName",
  propose: "autonomyProposeName",
  act: "autonomyActName",
  ship: "autonomyShipName",
} as const satisfies Record<Autonomy, WordKey>;
/** What each level means, in one line (Settings and quick settings say the same). */
export const MEANS_WORDS = {
  watch: "autonomyWatch",
  propose: "autonomyPropose",
  act: "autonomyAct",
  ship: "autonomyShip",
} as const satisfies Record<Autonomy, WordKey>;

/**
 * A ready-made lead's preview, true to what the lead does at the project's mode: on watch it only reports; on Ship its
 * PRs go through the same auto-merge step as a ticket's (core lead-prs.ts), so how far it goes is the mode's own line.
 */
export function previewRows(x: Pick<Suggestion, "kind" | "items">, mode: Autonomy, queueLabel: string, w: Words): [string, string][] {
  const words = LEAD_WORDS[x.kind];
  const refs = refList(x.items);
  const howFar = `${w[LEVEL_WORDS[mode]]}. ${w[MEANS_WORDS[mode]]}`;
  return [
    [w.leadPreviewWatches, fmt(w[words.watches], { label: queueLabel })],
    [w.leadPreviewDoes, mode === "watch" ? fmt(w.leadDoesWatch, { level: w[LEVEL_WORDS.watch] }) : w[words.does]],
    [w.leadPreviewHowFar, howFar],
    [w.leadPreviewWakes, w[words.wakes]],
    [w.leadPreviewNow, fmt(mode === "watch" ? w.leadNowWatch : w[words.now], { refs })],
  ];
}

/**
 * A worktree's name when its branch gives none: the main checkout says so; another's folder goes through the same
 * filter as a branch (no generated ids, no tool or vendor words), else it's "detached".
 */
export function worktreeFallback(wt: Pick<Worktree, "main" | "path">, w: Pick<Words, "worktreeMain" | "worktreeDetached">): string {
  if (wt.main) return w.worktreeMain;
  return branchWords(wt.path.split("/").pop() ?? "") || w.worktreeDetached;
}

/** The PR Overhand opened from `branch` in `project` (its key carries the project's ticket prefix); a branch name alone can repeat across projects. */
export function prFor(s: Pick<DashboardState, "prs" | "clients">, project: string, branch: string): AgentPr | undefined {
  const prefix = s.clients.find((c) => c.name === project)?.prefix;
  return branch && prefix ? s.prs.find((p) => p.branch === branch && p.key.startsWith(`${prefix}-`)) : undefined;
}
