/**
 * The dashboard's money, told true: billed (pay-per-use and cloud accounts, an estimate), included in a plan (its usage
 * windows), or what the work would cost at API prices (a comparison, never a bill). Pure, so every surface says it alike.
 */
import { type Account, type DashboardState, isBilled } from "@overhand/contract";
import type { Words } from "@overhand/themes";
import { fmt, money, pct } from "./format";

type Accounts = Pick<DashboardState, "accounts">;

/**
 * What today's money is: `billed` when an account is billed per run (or none is set up yet), `plans` when they're all on
 * plans (or plans and local), `local` when every account runs on this computer.
 */
export function spendKind(s: Accounts): "billed" | "plans" | "local" {
  if (!s.accounts.length || s.accounts.some((a) => isBilled(a.billing))) return "billed";
  return s.accounts.some((a) => a.billing === "plan") ? "plans" : "local";
}

/** The daily budget counts something here: an account is billed, or its billing isn't known yet (it may be). */
export const budgetApplies = (s: Accounts): boolean => s.accounts.some((a) => isBilled(a.billing) || !a.billingSure);

const used = (a: Account): number => Math.max(a.usage?.fiveHour ?? -1, a.usage?.sevenDay ?? -1);

/** A plan account's fuller usage window as its row says it ("week 39%", "5h 80%"); "" with no reading. */
export function windowOf(a: Account, w: Words): string {
  const u = a.usage;
  if (!u || used(a) < 0) return "";
  return u.sevenDay >= u.fiveHour ? fmt(w.accWeek, { pct: pct(u.sevenDay) }) : fmt(w.accFive, { pct: pct(u.fiveHour) });
}

/** The header's money: billed today, else "Included in your plans" with the busiest plan window, else on this computer. */
export function headline(s: Pick<DashboardState, "accounts" | "billed">, w: Words): { label: string; value: string } {
  const kind = spendKind(s);
  if (kind === "billed") return { label: w.billedToday, value: money(s.billed) };
  if (kind === "local") return { label: w.localToday, value: money(0) };
  const busiest = s.accounts.filter((a) => a.billing === "plan").sort((a, b) => used(b) - used(a))[0];
  return { label: w.inPlansToday, value: busiest ? windowOf(busiest, w) : "" };
}

const CLOUDS: Record<string, string> = { bedrock: "AWS", vertex: "Google Cloud" };

/** How an account is paid for, as its row names it: "plan", "pay per use", "billed to AWS", "local". */
export function billingLabel(a: Pick<Account, "billing" | "provider">, w: Words): string {
  if (a.billing === "plan") return w.billPlan;
  if (a.billing === "pay-per-use") return w.billPayPerUse;
  if (a.billing === "local") return w.billLocal;
  const cloud = CLOUDS[a.provider];
  return cloud ? fmt(w.billCloud, { cloud }) : w.billCloudAny;
}

/** Per merged PR: billed per merge with the API price beside it; on plans only, "included in plan". */
export function perMerge(s: Accounts, wk: { billed: number; cost: number; merged: number }, w: Words): string {
  const api = money(wk.cost / wk.merged);
  return spendKind(s) === "billed" ? fmt(w.perMergeBilled, { billed: money(wk.billed / wk.merged), api }) : fmt(w.perMergeInPlan, { api });
}

/**
 * One account's week in Spend: billed money, a plan's window with its API-price comparison, or $0 on this computer. An
 * account removed since has no billing to go by: its API-price cost only.
 */
export function accountWeek(a: Account | undefined, cost: number, w: Words): string {
  if (!a) return fmt(w.spendAccPlanUnread, { cost: money(cost) });
  if (isBilled(a.billing)) return fmt(w.spendAccBilled, { cost: money(cost) });
  if (a.billing === "local") return w.spendAccLocal;
  const win = windowOf(a, w);
  return win ? fmt(w.spendAccPlan, { window: win, cost: money(cost) }) : fmt(w.spendAccPlanUnread, { cost: money(cost) });
}
