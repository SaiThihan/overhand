/**
 * Organising suggestions: cheap, deterministic checks over facts gathered without a model (organise.ts), each raised as
 * a decision card (what, why, the recommendation, the options, what happens if you do nothing). A dismissed suggestion
 * stays dismissed until its facts change (its fingerprint). Pure.
 */
import type { Brief } from "@overhand/contract";
import { type GroupUnit, proposeGrouping } from "./grouping";
import { isBusy, type MemberStats } from "./lead-scope";

const DAY = 86_400_000;
/** A group with no commit and no open ticket this long is quiet. */
const QUIET_DAYS = 30;
/** One lead over this many projects is overloaded. */
const MAX_LEAD_PROJECTS = 6;

const SUGGESTION_KINDS = ["dedupe-clones", "group-tracker", "split-lead", "pause-lead", "ungrouped", "tidy-folders"] as const;
type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/** What the checks read. */
export interface OrganiseFacts {
  now: number;
  groups: readonly { name: string; members: readonly string[] }[];
  projects: readonly (GroupUnit & MemberStats & { lastCommit: number })[];
  /** Leads: their key, the project or group they cover, and whether they run. */
  leads: readonly { key: string; project: string; supervised: boolean }[];
  /** Second full clones, as the janitor finds them (clean, pushed, not busy): the one kept and the extra ones. */
  clones: readonly { remote: string; keep: string; extra: readonly string[] }[];
  /** Folder moves a tidy would make (clean, idle project folders only), and the ones it would skip, with why. */
  tidy: { moves: readonly { from: string; to: string }[]; skipped: readonly { path: string; why: string }[] };
}

interface SuggestionOption {
  id: "apply" | "dismiss" | "preview";
  label: string;
}

export interface Suggestion {
  /** Stable for the same situation, e.g. `ungrouped:Fernway`. */
  id: string;
  kind: SuggestionKind;
  /** The group or project it's about. */
  project: string;
  /** The group applying it puts projects in (group-tracker, ungrouped); "" otherwise. */
  target?: string;
  what: string;
  why: string;
  recommend: { option: SuggestionOption["id"]; reason: string; confidence: "low" | "medium" | "high" };
  options: SuggestionOption[];
  ifNothing: string;
  /** What applying would do, line by line (the dry run). */
  preview: string[];
  /** The facts' hash: a dismissal holds while this stays the same. */
  fingerprint: string;
}

const hash = (x: unknown) => Bun.hash(JSON.stringify(x)).toString(36);
const DISMISS: SuggestionOption = { id: "dismiss", label: "Leave it" };

/** The group a project is in, or "" when none. */
const groupOf = (f: Pick<OrganiseFacts, "groups">, project: string) => f.groups.find((g) => g.members.includes(project))?.name ?? "";

/** Second full clones of one remote: keep one, the rest become worktrees of it. */
function dedupe(f: OrganiseFacts): Suggestion[] {
  return f.clones
    .filter((c) => c.extra.length)
    .map((c) => ({
      id: `dedupe-clones:${c.remote}`,
      kind: "dedupe-clones",
      project: c.remote,
      what: `${c.extra.length + 1} full clones of ${c.remote}`,
      why: "Each full clone keeps its own history and dependencies; worktrees of one clone share them",
      recommend: {
        option: "apply",
        reason: "The extra clones are clean and fully pushed, and nothing works in them",
        confidence: "medium",
      },
      options: [{ id: "apply", label: "Keep one, make the rest worktrees" }, DISMISS],
      ifNothing: "Nothing changes; the clones keep their disk",
      preview: [`keep ${c.keep}`, ...c.extra.map((p) => `${p} → a worktree of ${c.keep} (the old folder kept for undo)`)],
      fingerprint: hash(c),
    }));
}

/** Projects on one tracker but in different groups. */
function sharedTracker(f: OrganiseFacts): Suggestion[] {
  const by = new Map<string, string[]>();
  for (const p of f.projects) if (p.tracker) by.set(p.tracker, [...(by.get(p.tracker) ?? []), p.name]);
  return [...by.entries()].flatMap(([tracker, names]) => {
    const groups = new Set(names.map((n) => groupOf(f, n) || `self:${n}`));
    if (names.length < 2 || groups.size < 2) return [];
    const target = names.map((n) => groupOf(f, n)).find(Boolean) ?? names[0] ?? "";
    return [
      {
        id: `group-tracker:${tracker}`,
        kind: "group-tracker",
        project: target,
        target,
        what: `${names.join(", ")} share one tracker but sit in different groups`,
        why: "Work on one tracker usually belongs to one client or team, under the same rules",
        recommend: { option: "apply", reason: `Put them together in ${target}; nothing on disk moves`, confidence: "medium" },
        options: [{ id: "apply", label: `Group them in ${target}` }, DISMISS],
        ifNothing: "They keep their own groups and rules",
        preview: names.filter((n) => groupOf(f, n) !== target).map((n) => `${n} → ${target}`),
        fingerprint: hash([tracker, names.map((n) => [n, groupOf(f, n)])]),
      } satisfies Suggestion,
    ];
  });
}

/** The projects one lead covers: its project, or every member of the group it leads. */
const covered = (f: OrganiseFacts, project: string) => f.groups.find((g) => g.name === project)?.members ?? [project];

/** One lead over many projects, or over several busy ones. */
function overloaded(f: OrganiseFacts): Suggestion[] {
  return f.leads.flatMap((l) => {
    const names = covered(f, l.project);
    const stats = f.projects.filter((p) => names.includes(p.name));
    const busy = stats.filter(isBusy);
    if (!(names.length > MAX_LEAD_PROJECTS || (names.length > 1 && busy.length >= 2))) return [];
    return [
      {
        id: `split-lead:${l.key}`,
        kind: "split-lead",
        project: l.project,
        what: `One lead covers ${names.length} projects${busy.length ? `, ${busy.length} of them busy` : ""}`,
        why: "A lead works one thing at a time: busy projects wait on each other",
        recommend: {
          option: "apply",
          reason: "One lead per project keeps each one moving",
          confidence: busy.length >= 2 ? "high" : "medium",
        },
        options: [{ id: "apply", label: "One lead per project" }, DISMISS],
        ifNothing: "The one lead keeps covering them all",
        preview: names.map((n) => `${n}: a lead of its own, with ${l.key}'s settings`),
        fingerprint: hash([l.key, names, busy.map((b) => b.name)]),
      } satisfies Suggestion,
    ];
  });
}

/** A group (or project) whose lead keeps running though nothing moved for 30 days. */
function quiet(f: OrganiseFacts): Suggestion[] {
  return f.leads
    .filter((l) => l.supervised)
    .flatMap((l) => {
      const stats = f.projects.filter((p) => covered(f, l.project).includes(p.name));
      if (!stats.length) return [];
      const last = Math.max(...stats.map((p) => p.lastCommit));
      const open = stats.reduce((n, p) => n + p.openTickets, 0);
      if (open > 0 || f.now - last < QUIET_DAYS * DAY) return [];
      const days = last ? Math.floor((f.now - last) / DAY) : QUIET_DAYS;
      return [
        {
          id: `pause-lead:${l.key}`,
          kind: "pause-lead",
          project: l.project,
          what: `${l.project} has been quiet for ${days} days, and its lead is on`,
          why: "No commits and no open tickets: the lead has nothing to do",
          recommend: { option: "apply", reason: "Pause it; switch it back on when work arrives", confidence: "high" },
          options: [{ id: "apply", label: "Pause its lead" }, DISMISS],
          ifNothing: "The lead stays on and keeps checking in",
          preview: [`${l.key}: off (its settings kept)`],
          fingerprint: hash([l.key, Math.floor(last / DAY)]),
        } satisfies Suggestion,
      ];
    });
}

/** Projects in no group, once you use groups: where they'd fit best. */
function ungrouped(f: OrganiseFacts): Suggestion[] {
  if (!f.groups.length) return [];
  const loose = f.projects.filter((p) => !groupOf(f, p.name));
  // the proposal over everything, read for the group each loose project lands with
  const proposal = loose.length ? proposeGrouping(f.projects) : [];
  return loose.flatMap((p) => {
    const mates = proposal.find((g) => g.members.includes(p.name))?.members.filter((m) => m !== p.name) ?? [];
    const target = mates.map((m) => groupOf(f, m)).find(Boolean) ?? "";
    const reason = proposal.find((g) => g.members.includes(p.name))?.reason ?? "";
    return [
      {
        id: `ungrouped:${p.name}`,
        kind: "ungrouped",
        project: p.name,
        what: `${p.name} isn't in a group`,
        why: target ? reason : "It follows only its own rules; nothing ties it to your other projects",
        recommend: target
          ? { option: "apply", reason: `It fits ${target}`, confidence: "medium" }
          : { option: "dismiss", reason: "Nothing it shares points at a group: leaving it on its own is fine", confidence: "medium" },
        options: [{ id: "apply", label: target ? `Add it to ${target}` : `Make a group of its own` }, DISMISS],
        ifNothing: "It keeps its own rules",
        target: target || p.name,
        preview: [`${p.name} → ${target || p.name} (keeps its own rules where they differ)`],
        fingerprint: hash([p.name, target, f.groups.map((g) => g.name)]),
      } satisfies Suggestion,
    ];
  });
}

/** The optional tidy-up: folders into <code root>/<group>/<repo>, previewed first. */
function tidy(f: OrganiseFacts): Suggestion[] {
  if (!f.tidy.moves.length) return [];
  return [
    {
      id: "tidy-folders",
      kind: "tidy-folders",
      project: "",
      what: `${f.tidy.moves.length} project folders could sit under their group's folder`,
      why: "Folders laid out by group are easier to find; Overhand needs nothing moved",
      recommend: { option: "preview", reason: "Optional: look at the dry run first, every move can be undone", confidence: "low" },
      options: [{ id: "preview", label: "Show the dry run" }, { id: "apply", label: "Tidy the folders" }, DISMISS],
      ifNothing: "Folders stay where they are; nothing works differently",
      preview: [
        ...f.tidy.moves.map((m) => `${m.from} → ${m.to} (a link left at the old path)`),
        ...f.tidy.skipped.map((s) => `skipped ${s.path}: ${s.why}`),
      ],
      fingerprint: hash(f.tidy.moves),
    },
  ];
}

/** Every suggestion the facts raise, minus the ones dismissed while their facts stayed the same. */
export function suggestions(f: OrganiseFacts, dismissed: Readonly<Record<string, string>> = {}): Suggestion[] {
  const all = [...dedupe(f), ...sharedTracker(f), ...overloaded(f), ...quiet(f), ...ungrouped(f), ...tidy(f)];
  return all.filter((s) => dismissed[s.id] !== s.fingerprint);
}

/** A suggestion as a decision card (`organise:<id>`), for the dashboard's decision-card component. */
export function suggestionBrief(s: Suggestion, now: number): Brief {
  return {
    id: `organise:${s.id}`,
    kind: "organise",
    project: s.project,
    what: s.what,
    why: s.why,
    recommend: s.recommend,
    evidence: s.preview.map((text) => ({ text, url: "" })),
    options: s.options.map((o) => ({ id: o.id, do: "organise", suggestion: s.id, action: o.id, label: o.label })),
    ifNothing: { text: s.ifNothing, at: 0 },
    source: "facts",
    hash: s.fingerprint,
    at: now,
    pending: false,
  };
}
