/**
 * The agent and model scorecard: which agent CLI and model works best, per project, from the run history. Pure functions,
 * shared by the daemon (Health and routing) and the dashboard's demo.
 */
import { z } from "zod";
import { type Billing, BillingSchema, isBilled } from "./billing";

export const RUN_KINDS = ["ticket", "fix", "plan", "triage", "lead", "other"] as const;
export const RunKindSchema = z.enum(RUN_KINDS);
export type RunKind = z.infer<typeof RunKindSchema>;

/** How a run ended: it opened a PR, finished without one (a question, a watch report), failed, or hit the task timeout. */
export const RUN_OUTCOMES = ["pr", "no-pr", "failed", "timeout"] as const;
export const RunOutcomeSchema = z.enum(RUN_OUTCOMES);
export type RunOutcome = z.infer<typeof RunOutcomeSchema>;

/** One run as the scorecard reads it: who ran what, on which CLI and model, and what came of it. */
export const HistoryRunSchema = z.object({
  project: z.string(),
  /** Ticket key; empty for plans, triage and leads. */
  key: z.string(),
  kind: RunKindSchema,
  account: z.string(),
  runtime: z.string(),
  provider: z.string(),
  /** The account's pinned model; empty = the backend's default. */
  model: z.string(),
  start: z.number(),
  end: z.number(),
  /** Known cost at API prices only; a local model's runs cost 0. */
  cost: z.number(),
  /** How its account is paid for (now): only pay-per-use and cloud runs' cost is billed. */
  billing: BillingSchema.default("plan"),
  outcome: RunOutcomeSchema,
  /** The PR a ticket run opened and what became of it. */
  pr: z
    .object({
      url: z.string(),
      state: z.enum(["open", "merged", "closed"]),
      fixes: z.number(),
      /** Reviews that asked for changes. */
      changes: z.number(),
      openedAt: z.number(),
      /** When it merged or closed; 0 while open. */
      doneAt: z.number(),
    })
    .optional(),
});
export type HistoryRun = z.infer<typeof HistoryRunSchema>;

/** One agent CLI × model's numbers over a window. Rates are left to the reader, so counts stay exact. */
export const ScoreRowSchema = z.object({
  /** `runtime/model`, see `comboOf`. */
  combo: z.string(),
  /** Ticket runs. */
  runs: z.number(),
  /** Ticket runs that opened a PR. */
  prs: z.number(),
  merged: z.number(),
  /** Merged without a fix round. */
  firstTry: z.number(),
  /** merged / runs: of the tickets it was given, the share that ended merged. */
  mergeRate: z.number(),
  /** Median minutes from PR opened to merged; null with nothing merged. */
  mergeMin: z.number().nullable(),
  /** Ticket and fix-round runs, at API prices (a comparison). */
  cost: z.number(),
  costPerMerge: z.number().nullable(),
  /** Of `cost`, what pay-per-use and cloud accounts were billed (an estimate), and per merge. */
  billed: z.number().default(0),
  billedPerMerge: z.number().nullable().default(null),
  /** The billing types of the accounts behind its runs, so a plan's merges read "included in plan". */
  billings: z.array(BillingSchema).default([]),
  failures: z.object({ noPr: z.number(), failed: z.number(), timeout: z.number(), closed: z.number() }),
  /** Merged PRs per day across the window, oldest first (the sparkline). */
  daily: z.array(z.number()),
  /** Fewer than `MIN_RUNS` runs: too few to tell. */
  few: z.boolean(),
});
export type ScoreRow = z.infer<typeof ScoreRowSchema>;

export const ScorecardSchema = z.object({
  days: z.number(),
  overall: z.array(ScoreRowSchema),
  projects: z.array(z.object({ project: z.string(), rows: z.array(ScoreRowSchema), best: z.string().nullable() })),
});
export type Scorecard = z.infer<typeof ScorecardSchema>;

/** Below this many runs a combo is "too few runs to tell". */
export const MIN_RUNS = 5;

/** How runs pick their account: `off` today's order; `suggest` says when another combo does clearly better; `auto` routes. */
export const ROUTING_MODES = ["off", "suggest", "auto"] as const;
export const RoutingModeSchema = z.enum(ROUTING_MODES);
export type RoutingMode = z.infer<typeof RoutingModeSchema>;

/** A combo that does clearly better on a project than the one it runs on now. */
export const RouteSuggestionSchema = z.object({
  project: z.string(),
  /** The account to switch to (its combo is `to`). */
  account: z.string(),
  from: z.string(),
  to: z.string(),
  fromRate: z.number(),
  toRate: z.number(),
});
export type RouteSuggestion = z.infer<typeof RouteSuggestionSchema>;

/** The combo key of an account: its CLI and its model, else (Claude Code) its backend, else the CLI's default model. */
export function comboOf(runtime: string, provider: string, model: string): string {
  return `${runtime}/${model || (runtime === "claude-code" ? provider : "default")}`;
}

/** Every agent CLI Overhand runs, as people name it (the site lists them from here). */
export const RUNTIME_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  cursor: "Cursor Agent",
  opencode: "OpenCode",
  aider: "Aider",
};
const MODEL_NAMES: Record<string, string> = { claude: "Claude", bedrock: "Bedrock", vertex: "Vertex AI", gateway: "gateway", default: "" };

/** A combo as people read it: "Claude Code · Claude", "Codex · qwen3", "Codex" (its default model). */
export function comboLabel(combo: string): string {
  const cut = combo.indexOf("/");
  const runtime = cut < 0 ? combo : combo.slice(0, cut);
  const model = cut < 0 ? "" : combo.slice(cut + 1);
  const shortModel = MODEL_NAMES[model] ?? model.split("/").pop() ?? model;
  return [RUNTIME_NAMES[runtime] ?? runtime, shortModel].filter(Boolean).join(" · ");
}

// not Map.groupBy: the dashboard's browsers and lib target predate it
const groupBy = <T>(xs: T[], key: (x: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

/** Rows for one set of runs, best first; combos with too few runs last. */
function rows(runs: HistoryRun[], from: number, days: number): ScoreRow[] {
  const by = groupBy(
    runs.filter((r) => r.kind === "ticket" || r.kind === "fix"),
    (r) => comboOf(r.runtime, r.provider, r.model),
  );
  const out = [...by].map(([combo, rs]): ScoreRow => {
    const tickets = rs.filter((r) => r.kind === "ticket");
    const merged = tickets.filter((r) => r.pr?.state === "merged");
    const cost = rs.reduce((n, r) => n + r.cost, 0);
    const billed = rs.reduce((n, r) => n + (isBilled(r.billing) ? r.cost : 0), 0);
    const daily = Array.from({ length: days }, () => 0);
    for (const r of merged) {
      const d = Math.floor(((r.pr?.doneAt ?? 0) - from) / 864e5);
      if (d >= 0 && d < days) daily[d] = (daily[d] ?? 0) + 1;
    }
    return {
      combo,
      runs: tickets.length,
      prs: tickets.filter((r) => r.outcome === "pr").length,
      merged: merged.length,
      firstTry: merged.filter((r) => r.pr?.fixes === 0).length,
      mergeRate: tickets.length ? merged.length / tickets.length : 0,
      mergeMin: median(merged.map((r) => ((r.pr?.doneAt ?? 0) - (r.pr?.openedAt ?? 0)) / 60_000)),
      cost,
      costPerMerge: merged.length ? cost / merged.length : null,
      billed,
      billedPerMerge: merged.length ? billed / merged.length : null,
      billings: [...new Set<Billing>(rs.map((r) => r.billing))],
      failures: {
        noPr: tickets.filter((r) => r.outcome === "no-pr").length,
        failed: tickets.filter((r) => r.outcome === "failed").length,
        timeout: tickets.filter((r) => r.outcome === "timeout").length,
        closed: tickets.filter((r) => r.pr?.state === "closed").length,
      },
      daily,
      few: tickets.length < MIN_RUNS,
    };
  });
  // enough runs first, then by merge rate, then the cheaper merge
  return out.sort(
    (a, b) =>
      Number(a.few) - Number(b.few) ||
      b.mergeRate - a.mergeRate ||
      (a.costPerMerge ?? Number.POSITIVE_INFINITY) - (b.costPerMerge ?? Number.POSITIVE_INFINITY) ||
      b.runs - a.runs,
  );
}

/**
 * The scorecard over the `days` before `now`: per agent CLI × model, overall and per project. A run counts in the window
 * it started in; its PR's fate counts whenever it came.
 */
export function scorecard(history: HistoryRun[], now: number, days: number): Scorecard {
  const from = now - days * 864e5;
  const recent = history.filter((r) => r.start >= from && r.start <= now);
  const projects = [...groupBy(recent, (r) => r.project)]
    .filter(([project, rs]) => project && rs.some((r) => r.kind === "ticket"))
    .map(([project, rs]) => {
      const rws = rows(rs, from, days);
      return { project, rows: rws, best: rws[0] && !rws[0].few && rws[0].merged ? rws[0].combo : null };
    })
    .sort((a, b) => a.project.localeCompare(b.project));
  return { days, overall: rows(recent, from, days), projects };
}

/**
 * The combo among `available` that does clearly better than `current` on these rows: both with enough runs, and a merge
 * rate at least 1.5× and 15 points higher. Null when nothing does, or samples are thin.
 */
export function clearlyBetter(rws: ScoreRow[], current: string, available: string[]): { to: ScoreRow; from: ScoreRow } | null {
  const from = rws.find((r) => r.combo === current);
  if (!from || from.few) return null;
  const to = rws.find((r) => !r.few && r.combo !== current && available.includes(r.combo));
  if (!to) return null;
  return to.mergeRate - from.mergeRate >= 0.15 && to.mergeRate >= from.mergeRate * 1.5 ? { to, from } : null;
}
