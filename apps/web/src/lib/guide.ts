/** The words around a project's onboarding guide: its drift and its one-line status in Crew. */
import type { Guide, GuideDrift } from "@overhand/contract";
import type { Words } from "@overhand/themes";
import { fmt } from "./format";

/** One drift finding, e.g. "it says npm, the repo uses bun". Commands keep their backticks as code. */
export function driftLine(w: Words, d: GuideDrift): string {
  const vars = { said: d.kind === "pm" || d.kind === "folder" ? d.said : `\`${d.said}\``, actual: d.actual };
  const word = { pm: w.guideDriftPm, script: w.guideDriftScript, missing: w.guideDriftMissing, folder: w.guideDriftFolder }[d.kind];
  return fmt(word, vars);
}

/** "Guide may be out of date: it says npm, the repo uses bun" (the first finding; the drawer lists all), or "". */
function staleText(w: Words, g: Guide): string {
  const first = g.drift[0];
  return first ? fmt(w.guideStale, { reasons: driftLine(w, first) }) : "";
}

/** The guide's state in a few words: being written, failed, missing, out of date or fresh. */
export function guideStatus(w: Words, g: Guide): string {
  if (g.run === "queued") return w.guideQueued;
  if (g.run === "running") return w.guideRunning;
  if (g.run === "failed") return fmt(w.guideFailed, { message: g.message || "?" });
  if (!g.text) return w.guideNoneYet;
  return staleText(w, g) || w.guideFresh;
}
