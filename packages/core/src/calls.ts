/**
 * Calls this week: every decision Needs you showed, counted once by when it first appeared. The dashboard computes Needs
 * you, so it reports each item's id; any number of screens report the same item and it still counts once. The number
 * should fall week by week as defaults, re-checks and standing rules take over.
 */
import { join } from "node:path";
import { OPS } from "./env";
import { readJson, writeJsonAtomic } from "./state";

const FILE = join(OPS, "calls.json");
const DAY = 864e5;
/** Two weeks to compare, and a day's slack for clocks. */
const KEEP = 15 * DAY;

/** First seen, by item id. */
type Seen = Record<string, number>;

/** Notes the items Needs you shows now; returns how many were new. Ids are clipped and capped at the trust boundary. */
export function noteCalls(ids: readonly string[], now = Date.now()): number {
  const seen = readJson<Seen>(FILE, {});
  const fresh = [...new Set(ids.map((i) => i.slice(0, 200)).filter((i) => i && !(i in seen)))].slice(0, 200);
  const kept = Object.entries(seen).filter(([, at]) => now - at <= KEEP);
  if (!fresh.length && kept.length === Object.keys(seen).length) return 0;
  writeJsonAtomic(FILE, Object.fromEntries([...kept, ...fresh.map((i): [string, number] => [i, now])]));
  return fresh.length;
}

/** Calls in the last 7 days and the 7 before. */
export function callCounts(now = Date.now()): { week: number; last: number } {
  const ats = Object.values(readJson<Seen>(FILE, {}));
  return {
    week: ats.filter((at) => now - at < 7 * DAY).length,
    last: ats.filter((at) => now - at >= 7 * DAY && now - at < 14 * DAY).length,
  };
}
