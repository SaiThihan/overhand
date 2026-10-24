/**
 * An agent account out of usage: the one detector for every CLI's limit wording, the reset time it gives, and the one
 * bench (OPS/control/benched.json) every lead, ticket, brief and test run reads, so a restart keeps it.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { controlDir } from "./control";
import { CFG, MIN, OPS } from "./env";
import { readJson, writeJsonAtomic } from "./state";
import { type AccountUsage, exhaustedUntil } from "./usage";

/**
 * What an agent CLI says when its account is out of capacity: Claude Code ("You've hit your session limit · resets 3am",
 * "weekly limit", "Claude AI usage limit reached|<epoch>"), Cursor ("ActionRequiredError: You've hit your usage limit"),
 * Codex ("You've hit your usage limit … try again at …", "Rate limit reached"), Gemini ("Quota exceeded",
 * "RESOURCE_EXHAUSTED"), OpenCode and Aider (the provider's 429, "rate limit", "insufficient_quota"), any API's overload.
 */
const LIMIT_RE =
  /hit your [\w ]{0,24}limit|usage limit|session limit|weekly limit|rate.?limit|limit (?:reached|exceeded)|quota|resource.?exhausted|overloaded|too many requests|\b429\b/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// "resets 3am (Europe/Helsinki)", "resets Oct 27 at 4am", "try again at 3:45 PM", "try again at Oct 27th, 2026 4:00 AM"
const RESET_RE =
  /(?:resets?|try again at)\s+(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(?:(\d{4}),?\s+)?(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i;

/** A moment's wall clock in `tz` (undefined: this computer's zone), months from 0. */
function wall(t: number, tz: string | undefined): [number, number, number, number, number] {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
  const p = Object.fromEntries(f.formatToParts(t).map((x) => [x.type, Number(x.value)]));
  return [p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0];
}

/** The moment a wall clock in `tz` shows this time (Date.UTC carries an overflowing day into the next month). */
function at(y: number, mo: number, d: number, h: number, mi: number, tz: string | undefined): number {
  const want = Date.UTC(y, mo, d, h, mi);
  let t = want;
  // twice: the second pass settles a guess that landed across a DST change
  for (let i = 0; i < 2; i++) t += want - Date.UTC(...wall(t, tz));
  return t;
}

/** When a limit message says the account is back (epoch ms, the next such time after `now`); 0 when it doesn't say. */
export function resetAt(text: string, now = Date.now()): number {
  const epoch = /limit reached\|(\d{10})\b/i.exec(text);
  if (epoch) return Number(epoch[1]) * 1000;
  const m = RESET_RE.exec(text);
  if (!m) return 0;
  const [, mon, day, year, hour, min, ap, zone] = m;
  if (!ap && min === undefined) return 0; // a bare number isn't a time
  const month = mon ? MONTHS.indexOf(mon.toLowerCase()) : -1;
  if (mon && month < 0) return 0;
  let tz = zone?.trim();
  try {
    wall(now, tz);
  } catch {
    tz = undefined; // a zone this runtime doesn't know: read it as this computer's
  }
  const h = ap ? (Number(hour) % 12) + (ap.toLowerCase() === "pm" ? 12 : 0) : Number(hour);
  const mi = Number(min ?? 0);
  if (h > 23 || mi > 59) return 0;
  const [y, mo, d] = wall(now, tz);
  if (mon) {
    const t = at(year ? Number(year) : y, month, Number(day), h, mi, tz);
    return t > now || year ? t : at(y + 1, month, Number(day), h, mi, tz);
  }
  const t = at(y, mo, d, h, mi, tz);
  return t > now ? t : at(y, mo, d + 1, h, mi, tz);
}

/**
 * Until when a failed run's account is out of usage, from its output (stdout and stderr, as its log has them) and the
 * usage it reported: the reset the message gives, else the full window's reset, else the configured cooldown. 0 when the
 * run didn't hit a limit.
 */
export function outOfUsage(output: string, usage: AccountUsage | null = null, now = Date.now()): number {
  if (usage?.status !== "rejected" && !LIMIT_RE.test(output)) return 0;
  return resetAt(output, now) || exhaustedUntil(usage ?? undefined, now) || now + CFG.limits.cooldownMin * MIN;
}

const benchFile = (ops: string): string => join(controlDir(ops), "benched.json");

/** Accounts out of usage right now, and until when; an entry past its reset is gone, so nothing needs clearing. */
export function benched(ops = OPS, now = Date.now()): Record<string, number> {
  return Object.fromEntries(Object.entries(readJson<Record<string, number>>(benchFile(ops), {})).filter(([, t]) => t > now));
}

/** Until when `account` is out of usage; 0 when it isn't. */
export const benchedUntil = (account: string, ops = OPS): number => benched(ops)[account] ?? 0;

/** Benches `account` for every run until `until`: the latest word on it wins (a test's reset time over a cooldown guess). */
export function bench(account: string, until: number, ops = OPS): void {
  mkdirSync(controlDir(ops), { recursive: true });
  writeJsonAtomic(benchFile(ops), { ...benched(ops), [account]: until });
}

/** "03:00" for a time within a day, else "Oct 27 04:00": when a benched account is back, in log lines. */
export function backAt(t: number, now = Date.now()): string {
  const hm = new Date(t).toTimeString().slice(0, 5);
  return t - now < 86_400_000 ? hm : [new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }), hm].join(" ");
}
