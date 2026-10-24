/**
 * Each account's billing type from the live config and its own sign-in, and the daily budget that follows from it: the
 * budget caps billed money only (pay per use and cloud), so it stops only billed accounts; plan accounts follow their
 * plan's usage windows. An account whose billing isn't known for sure counts as billed for the budget until it is.
 */
import { type Billing, type BillingFrom, detectBilling, isBilled, type Spend } from "@overhand/contract";
import { KEY_ITEM } from "./accounts";
import { ownSignInHome, runHome } from "./agent-home";
import { CFG, OPS, providerOf, runtimeOf, sh, today } from "./env";
import { readSecret } from "./platform";
import { spendOn } from "./usage";

const TEST = process.env.NODE_ENV === "test";

/** An account's billing: its type, whether that's known (set, or read from the sign-in) rather than guessed, and from what. */
export interface AccountBilling {
  billing: Billing;
  sure: boolean;
  from: BillingFrom | "set";
}

/**
 * What the sign-ins themselves say, each answer cached. Under `bun test` they say nothing unless a test swaps them in, so
 * no test asks this computer's real CLIs or key store.
 * - `key`: whether the secret store holds an item (a CLI's API key, `<prefix>-<account>`).
 * - `claude`: `claude auth status --json` in the account's config folder ("" = Claude Code's default). It names a
 *   `subscriptionType` (pro, max, team, enterprise) only for a claude.ai subscription: that is a plan.
 * - `codex`: `codex login status`, which says "Logged in using ChatGPT" for a plan sign-in and "... an API key" for one.
 */
export const billingProbes = {
  key: (item: string): boolean => !TEST && readSecret(item) !== null,
  claude: (home: string): string => {
    if (TEST) return "";
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    for (const v of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"]) delete env[v];
    if (home) env.CLAUDE_CONFIG_DIR = home;
    else delete env.CLAUDE_CONFIG_DIR;
    try {
      return Bun.spawnSync(["claude", "auth", "status", "--json"], { env, timeout: 3_000 }).stdout.toString();
    } catch {
      return ""; // not installed
    }
  },
  codex: (home: string): string => {
    if (TEST) return "";
    const r = sh(home ? ["env", `CODEX_HOME=${home}`, "codex", "login", "status"] : ["codex", "login", "status"], undefined, 3_000);
    return [r.out, r.err].join("\n");
  },
};

const PROBE_MS = 10 * 60_000;
const probed = new Map<string, { at: number; v: AccountBilling | null }>();

/** Forgets what the sign-ins said, so the next read asks again (after a sign-in or an added account). */
export const forgetBilling = (): void => probed.clear();

/** A plan when `claude auth status` names a subscription; anything else isn't evidence of one. */
export function claudePlan(status: string): boolean {
  try {
    const s = JSON.parse(status) as { loggedIn?: unknown; subscriptionType?: unknown };
    return s.loggedIn === true && typeof s.subscriptionType === "string" && s.subscriptionType.length > 0;
  } catch {
    return false;
  }
}

/** What an account's own sign-in shows about its billing, or null when it shows nothing for sure. */
function fromSignIn(account: string): AccountBilling | null {
  const rt = runtimeOf(account);
  const item = KEY_ITEM[rt.kind];
  if (item && billingProbes.key(`${item}-${account}`)) return { billing: "pay-per-use", sure: true, from: "key" };
  const p = providerOf(account);
  if (rt.kind === "claude-code" && p.kind === "claude" && p.auth !== "key") {
    const home = runHome(account);
    return claudePlan(billingProbes.claude(home)) ? { billing: "plan", sure: true, from: "sign-in" } : null;
  }
  if (rt.kind === "codex" && p.kind !== "gateway") {
    const out = billingProbes.codex(ownSignInHome(account));
    if (/logged in using chatgpt/i.test(out)) return { billing: "plan", sure: true, from: "sign-in" };
    if (/logged in using an api key/i.test(out)) return { billing: "pay-per-use", sure: true, from: "key" };
  }
  return null;
}

/**
 * An account's billing: the one the person set, else what its config shows for sure (a key provider, the cloud, a local
 * address), else what its sign-in shows (a CLI's API key, a Claude subscription, Codex's sign-in), else a guess (`sure`
 * false), which Settings and Needs you ask about.
 */
export function accountBilling(account: string, now = Date.now()): AccountBilling {
  const set = CFG.billing[account];
  if (set) return { billing: set, sure: true, from: "set" };
  const rt = runtimeOf(account);
  const guess = detectBilling({ runtime: rt.kind, provider: CFG.providers[account] ?? providerOf(account), model: rt.model });
  if (guess.sure) return guess;
  const hit = probed.get(account);
  const fresh = hit !== undefined && now - hit.at < PROBE_MS;
  const v = fresh ? hit.v : fromSignIn(account);
  if (!fresh) probed.set(account, { at: now, v });
  return v ?? guess;
}

/**
 * Asks each account's sign-in again once its answer is halfway to stale, on the dashboard's background timer, so the
 * state read finds every answer fresh and never waits on a CLI or the key store.
 */
export function refreshBilling(accounts: readonly string[], now = Date.now()): void {
  for (const a of accounts) {
    const hit = probed.get(a);
    if (hit && now - hit.at < PROBE_MS / 2) continue;
    probed.delete(a);
    accountBilling(a, now);
  }
}

/** An account's billing type (a guess where it isn't known; see `accountBilling`). */
export const billingOf = (account: string): Billing => accountBilling(account).billing;

/** The billing type a run records when it's written: only a known one, so a guess is never fixed into the past. */
export const recordedBilling = (account: string): Billing | undefined => {
  const b = accountBilling(account);
  return b.sure ? b.billing : undefined;
};

/** Counts toward the daily budget: billed, or not known for sure (fail safe: it may be). */
const capped = (account: string): boolean => {
  const b = accountBilling(account);
  return !b.sure || isBilled(b.billing);
};

/** A day's dollars, billed and at API prices (today by default). */
export const spendOnDay = (date = today()): Spend => spendOn(OPS, date, billingOf);

/** What the daily budget counts on a day: billed runs, and runs of accounts whose billing isn't known yet. */
export const budgetSpend = (date = today()): number => spendOn(OPS, date, (a) => (capped(a) ? "pay-per-use" : billingOf(a))).billed;

/** The next local midnight after `now`. */
const nextMidnight = (now: number): number => {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
};

/**
 * Until when the daily budget keeps `account` from starting new work: the next local midnight once today's budget spend
 * has reached the cap and the account counts toward it (billed, or not known), else 0. A known plan or local account is
 * never held for money.
 */
export function budgetUntil(account: string, now = Date.now(), spent: number = budgetSpend()): number {
  const cap = CFG.limits.dailyBudgetUsd;
  if (!cap || !capped(account) || spent < cap) return 0;
  return nextMidnight(now);
}
