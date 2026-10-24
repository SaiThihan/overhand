/** Routing new tickets by the scorecard: which accounts a run may use, and in what order. Pure, so it's tested directly. */
import { type Autonomy, clearlyBetter, type RoutingMode, type ScoreRow } from "@overhand/contract";

export interface RouteInput {
  mode: RoutingMode;
  autonomy: Autonomy;
  /** Today's order (`accountsFor`): the one account the run waits for, or local code's order. */
  today: string[];
  /** The project's allowed accounts: its `accounts`, else every account. */
  allowed: string[];
  /** An account's combo key (`comboOf`) and its pool: the CLI and backend, whose accounts are one person's subscriptions. */
  identity: (account: string) => { combo: string; pool: string };
  /** The project's 30-day scorecard rows. */
  rows: ScoreRow[];
}

/**
 * The accounts a new ticket may run on, in order. Off, suggest, a project on watch (no PRs to score, and its CLI's
 * read-only switch shouldn't change under it) and kinds other than tickets keep today's order. Auto adds the project's
 * other allowed accounts as fallbacks (only from a CLI and backend today's order doesn't use, so work never spreads over a
 * person's subscriptions), and puts first the combo that does clearly better than today's first account.
 */
export function routeOrder(r: RouteInput): string[] {
  if (r.mode !== "auto" || r.autonomy === "watch") return r.today;
  const seen = new Set(r.today.map((a) => r.identity(a).pool));
  const extra = r.allowed.filter((a) => {
    const p = r.identity(a).pool;
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  const pool = [...r.today, ...extra];
  const first = pool[0];
  if (!first) return pool;
  const better = clearlyBetter(
    r.rows,
    r.identity(first).combo,
    pool.map((a) => r.identity(a).combo),
  );
  if (!better) return pool; // thin samples or no clear winner: today's order, the rest as fallbacks
  const to = better.to.combo;
  return [...pool.filter((a) => r.identity(a).combo === to), ...pool.filter((a) => r.identity(a).combo !== to)];
}
