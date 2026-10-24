import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Billing, BillingSchema, type Spend, splitSpend } from "@overhand/contract";

/** One account's subscription windows as Claude Code reports them (`rate_limit_event` in stream-json output). */
export interface AccountUsage {
  /** Share of the window used, 0–1; -1 when Claude Code didn't report that window. */
  fiveHour: number;
  fiveHourResetsAt: number; // ms epoch, 0 = unknown
  sevenDay: number;
  sevenDayResetsAt: number;
  /** allowed | allowed_warning | rejected */
  status: string;
  at: number;
}

interface Window {
  utilization?: number;
  resetsAt?: number;
}
interface RateLimitInfo {
  status?: string;
  resetsAt?: number;
  unifiedWindows?: { five_hour?: Window; seven_day?: Window };
}

/** Converts Claude Code's rate_limit_info (seconds, 0–1) to what ops stores. */
function toUsage(info: RateLimitInfo, at = Date.now()): AccountUsage {
  const w = info.unifiedWindows ?? {};
  const ms = (s?: number) => (s ? s * 1000 : 0);
  return {
    fiveHour: w.five_hour?.utilization ?? -1,
    fiveHourResetsAt: ms(w.five_hour?.resetsAt),
    sevenDay: w.seven_day?.utilization ?? -1,
    sevenDayResetsAt: ms(w.seven_day?.resetsAt),
    status: info.status ?? "",
    at,
  };
}

/**
 * A stream-json transcript line by line: each JSON event as an object, other non-empty lines (stderr) as strings.
 * A partial JSON line, from a run still writing or one that was killed, is skipped.
 */
export function streamEvents(raw: string): (Record<string, unknown> | string)[] {
  return raw.split("\n").flatMap<Record<string, unknown> | string>((line) => {
    if (!line.startsWith("{")) return line.trim() ? [line] : [];
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

/** The last rate_limit_event and the final result event in a stream-json transcript. */
export function parseStream(stdout: string): { usage: AccountUsage | null; result: Record<string, unknown> | null } {
  let usage: AccountUsage | null = null;
  let result: Record<string, unknown> | null = null;
  for (const e of streamEvents(stdout)) {
    if (typeof e === "string") continue;
    if (e.type === "rate_limit_event" && e.rate_limit_info) usage = toUsage(e.rate_limit_info as RateLimitInfo);
    else if (e.type === "result") result = e;
  }
  return { usage, result };
}

const WEEK = 7 * 24 * 3_600_000;

/**
 * Until when an account can't be used because a window is full (0 = usable). With `pace`, the weekly window also counts
 * as full while it's ahead of an even pace (more of it used than of the week has passed), until the moment the week
 * catches up: `resetsAt - (1 - used) × week`.
 */
export function exhaustedUntil(u: AccountUsage | undefined, now = Date.now(), pace = false): number {
  if (!u) return 0;
  const full = [
    [u.fiveHour, u.fiveHourResetsAt],
    [u.sevenDay, u.sevenDayResetsAt],
  ].filter(([used, reset]) => (used ?? 0) >= 1 && (reset ?? 0) > now);
  const until = full.length ? Math.max(...full.map(([, reset]) => reset ?? 0)) : 0;
  if (!pace || u.sevenDay < 0 || u.sevenDayResetsAt <= now) return until;
  const caughtUp = u.sevenDayResetsAt - (1 - Math.min(u.sevenDay, 1)) * WEEK;
  return caughtUp > now ? Math.max(until, caughtUp) : until;
}

export function loadUsage(ops: string): Record<string, AccountUsage> {
  const f = join(ops, ".usage.json");
  try {
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, AccountUsage>) : {};
  } catch {
    return {};
  }
}

/** Stores one account's latest reading; written atomically because the daemon and probes both write it. */
export function recordUsage(ops: string, account: string, u: AccountUsage): void {
  const all = loadUsage(ops);
  all[account] = u;
  const f = join(ops, ".usage.json");
  writeFileSync(`${f}.tmp`, JSON.stringify(all, null, 2), { mode: 0o600 });
  renameSync(`${f}.tmp`, f);
}

/**
 * One day's (YYYY-MM-DD) dollars from runs/<date>.jsonl, split by the billing type each run recorded (else its account's
 * now): `billed` (pay per use and cloud, an estimate from token counts) and `apiPrice` (every run at API prices, a
 * comparison, never a bill).
 */
export function spendOn(ops: string, date: string, billingOf: (account: string) => Billing): Spend {
  const f = join(ops, "runs", `${date}.jsonl`);
  if (!existsSync(f)) return { billed: 0, apiPrice: 0 };
  const runs: { account?: string; cost: number }[] = [];
  for (const line of readFileSync(f, "utf8").split("\n")) {
    try {
      const r = JSON.parse(line) as { account?: string; cost?: number; billing?: unknown };
      const billing = BillingSchema.safeParse(r.billing);
      runs.push({ account: r.account, cost: r.cost ?? 0, ...(billing.success ? { billing: billing.data } : {}) });
    } catch {
      // blank or partial line
    }
  }
  return splitSpend(runs, billingOf);
}
