/**
 * A world that remembers: what each project has earned (merges, first-try merges, clean weeks, milestones), what is
 * broken there until it's fixed (scars), and the season from the real calendar. Pure, from the run history only, so
 * the daemon and the dashboard's demo agree, and an existing install starts with a world that reflects its past.
 *
 * Real outcomes only: never time spent, tokens or runs started. Nothing here ever goes down on a quiet week.
 */
import { z } from "zod";
import type { HistoryRun } from "./scorecard";

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export const SeasonSchema = z.enum(SEASONS);
export type Season = z.infer<typeof SeasonSchema>;

/** Which half of the world the calendar's seasons follow; `auto` reads it from the time zone. */
export const HEMISPHERES = ["auto", "north", "south"] as const;
export type Hemisphere = (typeof HEMISPHERES)[number];

/** What can be broken at a project until it's fixed: its CI is red, its lead keeps crashing, its last agent run failed. */
export const SCAR_KINDS = ["ci", "lead", "run"] as const;
export const ScarSchema = z.object({ kind: z.enum(SCAR_KINDS), since: z.number() });
export type Scar = z.infer<typeof ScarSchema>;
export type ScarKind = Scar["kind"];

/** Milestones, each unlocking one permanent detail at the project's place and one line in the brief. */
export const MILESTONES = ["merge-1", "merge-10", "merge-50", "merge-100", "clean-week", "first-try"] as const;
export const MilestoneSchema = z.object({ id: z.enum(MILESTONES), at: z.number() });
export type Milestone = z.infer<typeof MilestoneSchema>;
export type MilestoneId = Milestone["id"];

export const ProjectProgressSchema = z.object({
  name: z.string(),
  /** Agent PRs merged, all time. */
  merges: z.number().default(0),
  /** Merged in the last 30 days. */
  recent: z.number().default(0),
  /** Merged without a fix round. */
  firstTry: z.number().default(0),
  /** Past weeks (Monday to Sunday) with at least one merge and no failed or timed-out run. */
  cleanWeeks: z.number().default(0),
  scars: z.array(ScarSchema).default([]),
  milestones: z.array(MilestoneSchema).default([]),
});
export type ProjectProgress = z.infer<typeof ProjectProgressSchema>;

/** Southern-hemisphere time zones (whole regions and the cities that are the exception in theirs). */
const SOUTH =
  /^(Antarctica|Australia)\/|^Pacific\/(Auckland|Chatham|Fiji|Tongatapu|Apia|Efate|Noumea|Port_Moresby)|^Africa\/(Johannesburg|Maputo|Harare|Lusaka|Windhoek|Gaborone|Maseru|Mbabane|Blantyre|Lubumbashi|Luanda)|^America\/(Argentina\/|Buenos_Aires|Sao_Paulo|Santiago|Montevideo|Asuncion|La_Paz|Lima|Punta_Arenas|Campo_Grande|Cuiaba|Porto_Velho|Recife|Bahia|Maceio|Araguaina)|^Indian\/(Mauritius|Reunion|Antananarivo)|^Atlantic\/(Stanley|South_Georgia)/;

/** The hemisphere a time zone lies in (north when unsure: most people are). */
export function hemisphereOf(timeZone: string): "north" | "south" {
  return SOUTH.test(timeZone) ? "south" : "north";
}

/** This machine's time zone, or "" where Intl can't say. */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/** The meteorological season on a date: winter is December to February up north, June to August down south. */
export function seasonOf(d: Date, hemisphere: Hemisphere = "auto"): Season {
  const half = hemisphere === "auto" ? hemisphereOf(localZone()) : hemisphere;
  const north = (["winter", "spring", "summer", "autumn"] as const)[Math.floor(((d.getMonth() + 1) % 12) / 3)] ?? "winter";
  if (half === "north") return north;
  return ({ winter: "summer", spring: "autumn", summer: "winter", autumn: "spring" } as const)[north];
}

export const ProgressionSchema = z.object({
  projects: z.array(ProjectProgressSchema).default([]),
  season: SeasonSchema.default(() => seasonOf(new Date())),
});
export type Progression = z.infer<typeof ProgressionSchema>;

/**
 * A place's detail tier from its merges, about log2: 1, 2, 4, 8, 16, 32, 64, 128 merges reach tiers 1 to 8. A year of
 * work shows; a busy week moves it one step at most.
 */
export function tierOf(merges: number): number {
  return merges < 1 ? 0 : Math.min(MAX_TIER, Math.floor(Math.log2(merges)) + 1);
}
export const MAX_TIER = 8;

const WEEK = 7 * 864e5;
/** Local midnight on the Monday of `t`'s week. */
export function weekStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

const MERGE_MARKS: [number, MilestoneId][] = [
  [1, "merge-1"],
  [10, "merge-10"],
  [50, "merge-50"],
  [100, "merge-100"],
];

/** One project's progress from its runs, as of `now`. `open`: scars known from outside the history (red CI, a crashing lead). */
function progressOf(name: string, runs: HistoryRun[], open: Scar[], now: number): ProjectProgress {
  const tickets = runs.filter((r) => r.kind === "ticket").sort((a, b) => a.end - b.end);
  const merged = tickets
    .filter((r) => r.pr?.state === "merged" && (r.pr.doneAt || r.end) <= now)
    .map((r) => ({ at: r.pr?.doneAt || r.end, fixes: r.pr?.fixes ?? 0 }))
    .sort((a, b) => a.at - b.at);
  // a week is clean once it's over, if something merged in it and nothing failed
  const weeks = new Map<number, { merges: number; failed: boolean }>();
  for (const m of merged) {
    const k = weekStart(m.at);
    weeks.set(k, { merges: (weeks.get(k)?.merges ?? 0) + 1, failed: weeks.get(k)?.failed ?? false });
  }
  for (const r of tickets)
    if (r.outcome === "failed" || r.outcome === "timeout") {
      const k = weekStart(r.end);
      weeks.set(k, { merges: weeks.get(k)?.merges ?? 0, failed: true });
    }
  const thisWeek = weekStart(now);
  const clean = [...weeks]
    .filter(([k, v]) => k < thisWeek && v.merges > 0 && !v.failed)
    .map(([k]) => k)
    .sort((a, b) => a - b);
  const milestones: Milestone[] = [];
  for (const [n, id] of MERGE_MARKS) {
    const m = merged[n - 1];
    if (m) milestones.push({ id, at: m.at });
  }
  const first = merged.find((m) => m.fixes === 0);
  if (first) milestones.push({ id: "first-try", at: first.at });
  const firstClean = clean[0];
  // the week's end, local midnight on the next Monday
  if (firstClean !== undefined) milestones.push({ id: "clean-week", at: weekStart(firstClean + WEEK + 864e5 / 2) });
  milestones.sort((a, b) => a.at - b.at);
  // the last ticket run failed and none has succeeded since: the run scar, until the next one opens a PR
  const last = tickets.filter((r) => r.end <= now).at(-1);
  const runScar: Scar[] = last && (last.outcome === "failed" || last.outcome === "timeout") ? [{ kind: "run", since: last.end }] : [];
  return {
    name,
    merges: merged.length,
    recent: merged.filter((m) => m.at > now - 30 * 864e5).length,
    firstTry: merged.filter((m) => m.fixes === 0).length,
    cleanWeeks: clean.length,
    scars: [...runScar, ...open],
    milestones,
  };
}

/**
 * Every project's progress from the run history (all of it: that's the backfill), with the scars known from outside it
 * (`open`, by project), and the season. `names` lists the projects in config order; one with no history yet starts bare.
 */
export function progressionOf(
  history: HistoryRun[],
  names: readonly string[],
  open: Readonly<Record<string, Scar[]>>,
  now: number,
  season: Season,
): Progression {
  const by = new Map<string, HistoryRun[]>();
  for (const r of history) if (r.project) by.set(r.project, [...(by.get(r.project) ?? []), r]);
  const all = [...new Set([...names, ...by.keys()])];
  return { projects: all.map((name) => progressOf(name, by.get(name) ?? [], open[name] ?? [], now)), season };
}

/** Milestones reached in `(from, to]`, newest first: what the brief has to tell. */
export function newMilestones(p: Progression, from: number, to: number): { project: string; id: MilestoneId; at: number }[] {
  return p.projects
    .flatMap((pr) => pr.milestones.filter((m) => m.at > from && m.at <= to).map((m) => ({ project: pr.name, id: m.id, at: m.at })))
    .sort((a, b) => b.at - a.at);
}
