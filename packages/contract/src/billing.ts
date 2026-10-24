/**
 * How each agent account is paid for, and what its runs' dollars therefore mean. Agents report every run's cost at API
 * prices whatever the account is billed on; only pay-per-use and cloud accounts are actually charged for it. Pure, shared
 * by the daemon (the daily budget, Health) and the dashboard (Settings' suggestion).
 */
import { z } from "zod";

/**
 * `plan`: a flat subscription, runs use its usage windows. `pay-per-use`: charged per token (an API key, a paid gateway).
 * `cloud`: charged to the person's cloud bill. `local`: runs on this computer, no charge.
 */
export const BILLINGS = ["plan", "pay-per-use", "cloud", "local"] as const;
export const BillingSchema = z.enum(BILLINGS);
export type Billing = z.infer<typeof BillingSchema>;

/** Charged per run: the only money called billed, and the only money the daily budget counts. */
export const isBilled = (b: Billing): boolean => b === "pay-per-use" || b === "cloud";

/** What a detected billing type was read from: the sign-in, a key, cloud credentials, a local address, a gateway, or just the CLI. */
export type BillingFrom = "sign-in" | "key" | "cloud" | "local" | "gateway" | "cli";

/** An account's setup as config holds it (its CLI, its provider, the CLI's own model). */
export interface BillingSetup {
  runtime: string;
  provider?: { kind: string; auth?: string; baseUrl?: string };
  model?: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

const isLocalUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname;
    return LOCAL_HOSTS.has(host) || host.startsWith("127.") || host.endsWith(".local");
  } catch {
    return false;
  }
};

/**
 * The billing type an account's config points to. `sure` is false where the config can't tell: a sign-in (Claude Code's
 * can be a plan or a per-use Console login; another CLI's likewise), a remote gateway. The billing is then a suggestion:
 * the daemon asks the sign-in itself (core billing.ts), else the person, once; meanwhile the budget counts it as billed.
 */
export function detectBilling(a: BillingSetup): { billing: Billing; sure: boolean; from: BillingFrom } {
  const p = a.provider;
  if (p?.kind === "bedrock" || p?.kind === "vertex") return { billing: "cloud", sure: true, from: "cloud" };
  if (p?.kind === "gateway")
    return isLocalUrl(p.baseUrl ?? "")
      ? { billing: "local", sure: true, from: "local" }
      : { billing: "pay-per-use", sure: false, from: "gateway" };
  if (a.runtime === "claude-code")
    return p?.auth === "key" ? { billing: "pay-per-use", sure: true, from: "key" } : { billing: "plan", sure: false, from: "sign-in" };
  if (/^ollama/.test(a.model ?? "")) return { billing: "local", sure: true, from: "local" };
  // Codex and Cursor Agent usually sign in to a plan; Gemini CLI, OpenCode and Aider usually run on a provider's key
  return { billing: a.runtime === "codex" || a.runtime === "cursor" ? "plan" : "pay-per-use", sure: false, from: "cli" };
}

/** The words the daily budget's notice is told in (the themes' plainWords). */
export interface BudgetWords {
  alBudgetWait: string;
  alBudgetPlans: string;
  alBudgetRaise: string;
  budgetUnknown: string;
}

/**
 * What the reached budget holds, in the dashboard's words: billed accounts wait, and plans carry on; when an account is
 * held because its billing isn't known yet, that is said instead (a plan not yet known to be one waits too).
 */
export const budgetNotice = (w: BudgetWords, unknown: boolean): string =>
  [w.alBudgetWait, unknown ? w.budgetUnknown : w.alBudgetPlans, w.alBudgetRaise].join(" ");

/** A span's dollars: `billed` (pay-per-use and cloud, an estimate) and `apiPrice` (every run at API prices, for comparison). */
export interface Spend {
  billed: number;
  apiPrice: number;
}

/**
 * Splits runs' reported costs by billing type: the one recorded on the run when it was written, so removing or re-typing
 * an account never changes what past runs were billed; else (runs from before it was recorded) the account's type now. A
 * run with no account resolves as the account "" does.
 */
export function splitSpend(
  runs: readonly { account?: string; cost: number; billing?: Billing }[],
  billingOf: (account: string) => Billing,
): Spend {
  let billed = 0;
  let apiPrice = 0;
  for (const r of runs) {
    apiPrice += r.cost;
    if (isBilled(r.billing ?? billingOf(r.account ?? ""))) billed += r.cost;
  }
  return { billed, apiPrice };
}
