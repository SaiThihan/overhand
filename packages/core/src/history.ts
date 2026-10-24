/**
 * The run history the scorecard reads: every run from runs/<date>.jsonl, joined with what came of it (outcomes.jsonl, and
 * for older days the activity log in reports/<date>.md).
 */
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Billing,
  clearlyBetter,
  comboOf,
  type HistoryRun,
  type Progression,
  progressionOf,
  type RouteSuggestion,
  type Run,
  type RunKind,
  RunSchema,
  type Scar,
  type Scorecard,
  scorecard,
  seasonOf,
} from "@overhand/contract";
import { billingOf } from "./billing";
import { accountsFor } from "./claude";
import { ACCOUNTS, CFG, CLIENTS, clientOf, OPS, providerOf, runtimeOf } from "./env";

/** What happened after a ticket run, or to its PR, as outcomes.jsonl records it. */
export interface Outcome {
  at: number;
  key: string;
  event: "pr" | "no-pr" | "failed" | "merged" | "closed";
  url?: string;
  /** merged / closed: fix rounds and change requests the PR went through. */
  fixes?: number;
  changes?: number;
  /** pr: the diff's size from its proof (lock files left out), for the work report's estimate. */
  added?: number;
  removed?: number;
  docsOnly?: boolean;
}

/** The agent CLI, backend and model behind an account. */
export interface Identity {
  runtime: string;
  provider: string;
  model: string;
  /** How the account is paid for now; absent reads as a plan. */
  billing?: Billing;
}

const KEY = /^[A-Z][A-Z0-9]+-\d+$/;

/** A run's kind and ticket key, from the name it's logged under (`HONEY-1`, `HONEY-1-fix`, `plan`, `inbox`, `lead-x`). */
export function nameParts(name: string): { kind: RunKind; key: string } {
  const base = name.replace(/-retry$/, "");
  if (KEY.test(base)) return { kind: "ticket", key: base };
  const fix = base.match(/^([A-Z][A-Z0-9]+-\d+)-fix$/);
  if (fix?.[1]) return { kind: "fix", key: fix[1] };
  const other = base.match(/^([A-Z][A-Z0-9]+-\d+)-/);
  if (other?.[1]) return { kind: "other", key: other[1] }; // routing a ticket to its repo
  if (base === "plan" || base === "planner") return { kind: "plan", key: "" };
  if (base === "inbox") return { kind: "triage", key: "" };
  if (base.startsWith("lead-")) return { kind: "lead", key: "" };
  return { kind: "other", key: "" };
}

/** Appends one outcome to outcomes.jsonl. */
export function recordOutcome(ops: string, o: Omit<Outcome, "at">): void {
  appendFileSync(join(ops, "outcomes.jsonl"), `${JSON.stringify({ at: Date.now(), ...o })}\n`);
}

/** Outcomes read back from an older day's activity log, for days before outcomes.jsonl (minute precision). */
function outcomesFromReport(date: string, lines: string[]): Outcome[] {
  return lines.flatMap((l): Outcome[] => {
    const m = l.match(/^- (\d\d:\d\d) (✅|❓|👁|✗|🎉|🗑) ([A-Z][A-Z0-9]+-\d+)(.*)$/);
    if (!m?.[1] || !m[2] || !m[3]) return [];
    const at = new Date(`${date}T${m[1]}:00`).getTime();
    const rest = m[4] ?? "";
    const key = m[3];
    if (m[2] === "✅") return [{ at, key, event: "pr", url: rest.match(/→ (\S+)/)?.[1] ?? "" }];
    if (m[2] === "❓" || m[2] === "👁") return [{ at, key, event: "no-pr" }];
    if (m[2] === "✗") return rest.startsWith(" fix round") ? [] : [{ at, key, event: "failed" }];
    if (m[2] === "🎉" && rest.startsWith(" PR merged")) return [{ at, key, event: "merged" }];
    if (m[2] === "🗑" && rest.startsWith(" PR closed")) return [{ at, key, event: "closed" }];
    return [];
  });
}

/**
 * Joins runs with their outcomes. A ticket run's outcome is the first one logged for its key within 30 minutes of its end
 * (else a timeout, a failure, or no PR); a PR's fate is the first merge or close after it opened. Runs written before
 * the scorecard (no kind, project or CLI) get them from their name and the account's current setup. A `-retry` run is
 * folded into the run it retried.
 */
export function buildHistory(
  runs: Run[],
  outcomes: Outcome[],
  who: (account: string) => Identity,
  projectOf: (key: string, name: string) => string,
  now: number,
): HistoryRun[] {
  const merged: Run[] = [];
  for (const r of runs) {
    const prev = r.name.endsWith("-retry") ? merged.findLast((x) => x.name === r.name.slice(0, -6)) : undefined;
    if (prev) Object.assign(prev, { end: r.end, cost: prev.cost + r.cost, ok: r.ok, timedOut: r.timedOut });
    else merged.push({ ...r });
  }
  const events = [...outcomes].sort((a, b) => a.at - b.at);
  const base = merged.map((r) => {
    const parts = nameParts(r.name);
    const account = r.account ?? "";
    const now = who(account);
    const id = r.runtime ? { runtime: r.runtime, provider: r.provider ?? "", model: r.model ?? "" } : now;
    const key = r.key ?? parts.key;
    return {
      ...id,
      kind: r.kind ?? parts.kind,
      key,
      project: r.project ?? projectOf(key, r.name),
      account,
      start: r.start ?? 0,
      end: r.end ?? r.start ?? 0,
      cost: r.cost,
      // the billing the run recorded when it was written; runs from before that follow the account's billing now
      billing: r.billing ?? now.billing ?? "plan",
      ok: r.ok,
      timedOut: r.timedOut ?? false,
    };
  });
  return base.map(({ ok, timedOut, ...r }): HistoryRun => {
    if (r.kind !== "ticket") return { ...r, outcome: timedOut ? "timeout" : ok ? "no-pr" : "failed" };
    const ev = events.find(
      (e) => e.key === r.key && e.at >= r.end - 60_000 && e.at <= r.end + 30 * 60_000 && e.event !== "merged" && e.event !== "closed",
    );
    const outcome = timedOut ? "timeout" : ev?.event === "pr" ? "pr" : ev?.event === "failed" || (!ev && !ok) ? "failed" : "no-pr";
    if (outcome !== "pr" || !ev) return { ...r, outcome };
    const fate = events.find((e) => e.key === r.key && e.at >= ev.at && (e.event === "merged" || e.event === "closed"));
    const doneAt = fate?.at ?? 0;
    const fixes =
      fate?.fixes ?? base.filter((x) => x.kind === "fix" && x.key === r.key && x.start >= ev.at && x.start <= (doneAt || now)).length;
    return {
      ...r,
      outcome,
      pr: {
        url: ev.url ?? "",
        state: fate?.event === "merged" ? "merged" : fate ? "closed" : "open",
        fixes,
        changes: fate?.changes ?? 0,
        openedAt: ev.at,
        doneAt,
      },
    };
  });
}

/** Parsed lines of a JSONL file; lines that don't parse (a run still writing) are skipped. */
function jsonl(file: string): unknown[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((l) => {
      try {
        return l.trim() ? [JSON.parse(l) as unknown] : [];
      } catch {
        return [];
      }
    });
}

/** Every outcome outcomes.jsonl holds. */
export const loadOutcomes = (ops: string): Outcome[] =>
  jsonl(join(ops, "outcomes.jsonl")).filter(
    (x): x is Outcome => typeof x === "object" && x !== null && "key" in x && "event" in x && "at" in x,
  );

/** The last `days` days of history from the ops folder. */
export function loadHistory(
  ops: string,
  days: number,
  who: (account: string) => Identity,
  projectOf: (key: string, name: string) => string,
  now = Date.now(),
): HistoryRun[] {
  const dates = Array.from({ length: days + 1 }, (_, n) => new Date(now - (days - n) * 864e5).toLocaleDateString("sv-SE"));
  const runs = dates.flatMap((d) =>
    jsonl(join(ops, "runs", `${d}.jsonl`)).flatMap((x) => {
      const p = RunSchema.safeParse(x);
      return p.success ? [p.data] : [];
    }),
  );
  const recorded = loadOutcomes(ops);
  // the activity log fills in keys outcomes.jsonl doesn't know yet (days before it existed)
  const known = new Set(recorded.map((o) => o.key));
  const logged = dates.flatMap((d) => {
    const f = join(ops, "reports", `${d}.md`);
    return existsSync(f) ? outcomesFromReport(d, readFileSync(f, "utf8").split("\n")) : [];
  });
  return buildHistory(runs, [...recorded, ...logged.filter((o) => !known.has(o.key))], who, projectOf, now);
}

/** An account's CLI, backend and model from the live config (the model as the dashboard shows it). */
export function identityOf(account: string): Identity {
  const p = providerOf(account);
  const rt = runtimeOf(account);
  return {
    runtime: rt.kind,
    provider: p.kind,
    model: (rt.kind === "claude-code" ? "" : rt.model) || (p.kind === "claude" ? "" : p.model),
    billing: billingOf(account),
  };
}

/** An account's combo key, and its pool (CLI and backend: accounts in one pool are one person's subscriptions). */
export function comboOfAccount(account: string): { combo: string; pool: string } {
  const id = identityOf(account);
  return { combo: comboOf(id.runtime, id.provider, id.model), pool: `${id.runtime}/${id.provider}` };
}

/** The project a run belongs to: its ticket's, or its lead's. */
export const projectOf = (key: string, name: string): string =>
  clientOf(key)?.name ?? CFG.godmode.find((g) => name === `lead-${g.key}`)?.project ?? "";

let cached: { at: number; week: Scorecard; month: Scorecard } | null = null;

/** The 7- and 30-day scorecards from the ops folder, recomputed at most once a minute. */
export function scorecards(now = Date.now()): { week: Scorecard; month: Scorecard } {
  if (cached && now - cached.at < 60_000) return cached;
  const h = loadHistory(OPS, 30, identityOf, projectOf, now);
  cached = { at: now, week: scorecard(h, now, 7), month: scorecard(h, now, 30) };
  return cached;
}

/** A project's 30-day scorecard rows. */
export const projectRows = (project: string) => scorecards().month.projects.find((p) => p.project === project)?.rows ?? [];

/**
 * Suggest mode: per project not on watch, a configured combo that merges clearly more often there than the account it
 * runs on now. Empty in the other modes.
 */
export function routeSuggestions(): RouteSuggestion[] {
  if (CFG.routing.mode !== "suggest") return [];
  return CLIENTS.flatMap((c): RouteSuggestion[] => {
    if (c.autonomy === "watch") return [];
    const now = accountsFor(ACCOUNTS, c.accounts, c.fallbackToAll, 0)[0];
    if (!now) return [];
    const better = clearlyBetter(
      projectRows(c.name),
      comboOfAccount(now).combo,
      ACCOUNTS.map((a) => comboOfAccount(a).combo),
    );
    const account = better && ACCOUNTS.find((a) => comboOfAccount(a).combo === better.to.combo);
    if (!better || !account) return [];
    return [
      {
        project: c.name,
        account,
        from: better.from.combo,
        to: better.to.combo,
        fromRate: better.from.mergeRate,
        toRate: better.to.mergeRate,
      },
    ];
  });
}

/** Days since the oldest run log, so the world's memory reads the whole history (the backfill), not a window. */
function historyDays(ops: string, now = Date.now()): number {
  const dir = join(ops, "runs");
  const first = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
        .sort()[0]
    : undefined;
  return first ? Math.max(0, Math.ceil((now - new Date(`${first.slice(0, 10)}T00:00:00`).getTime()) / 864e5)) : 0;
}

// ponytail: the whole history is reread every 5 minutes; read only new days if years of logs make it slow
let allTime: { at: number; runs: HistoryRun[] } | null = null;

/**
 * The world's memory (`progressionOf`) from the whole run history, with the scars known from outside it: a red build on
 * a project's default branch (since the poll that first saw it) and a lead that stopped after crashing.
 */
export function progression(open: Readonly<Record<string, Scar[]>>, now = Date.now()): Progression {
  if (!allTime || now - allTime.at > 300_000)
    allTime = { at: now, runs: loadHistory(OPS, historyDays(OPS, now), identityOf, projectOf, now) };
  return progressionOf(
    allTime.runs,
    CLIENTS.map((c) => c.name),
    open,
    now,
    seasonOf(new Date(now), CFG.schedule.hemisphere),
  );
}
