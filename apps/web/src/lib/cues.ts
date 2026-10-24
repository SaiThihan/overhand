/**
 * When the dashboard makes a sound, and which: pure and clock-injected, so the rules (one sound per batch of news, never
 * before a gesture, never two within 1.5 s) are testable without audio.
 * The sounds themselves live in `synth.ts`, loaded on the first one.
 */
import { parseLine } from "./beats";

/** Every event that has a sound, in every world. */
export const CUES = ["needs", "merged", "failure", "start", "stop", "repair"] as const;
export type Cue = (typeof CUES)[number];

/** At most one sound this often (ms): a burst of news is one sound, not a stack. */
export const GAP_MS = 1500;

/** Which sound one activity line (`- HH:MM text`) makes, or null for lines that tell no event. */
export function cueOf(line: string): Cue | null {
  const raw = line.replace(/^- \d\d:\d\d /, "");
  const p = parseLine(raw);
  if (!p) return null;
  if (p.kind === "start") return "start";
  if (p.tone === "bad") return "failure";
  if (/^[❓⏸]/u.test(raw)) return "needs";
  if (/🎉/u.test(raw) || (p.tone === "ok" && /\bmerged\b/.test(p.text))) return "merged";
  if (p.who && /\b(finished after|You stopped)\b/.test(p.text)) return "stop";
  return null;
}

/** The order a burst of lines is told in: the most urgent one is the sound. */
const RANK: readonly Cue[] = ["failure", "needs", "merged", "repair", "start", "stop"];

/** The one sound for a batch of new lines (several merges in one poll are one merge sound), or null. */
export function pick(lines: readonly string[]): Cue | null {
  let best: Cue | null = null;
  for (const l of lines) {
    const c = cueOf(l);
    if (c && (best === null || RANK.indexOf(c) < RANK.indexOf(best))) best = c;
  }
  return best;
}

/** What the sounder needs from the outside world. */
export interface SounderDeps {
  now(): number;
  /** Plays `cue` so its peak lands at `at` (epoch ms). */
  play(cue: Cue, at: number): void;
}

/** The rules between an event and a sound. */
export interface Sounder {
  /** A user gesture happened: sound may play from now on (browsers block audio before one anyway). */
  unlock(): void;
  readonly unlocked: boolean;
  setOn(on: boolean): void;
  /** A sound for something that just happened, now (or with its peak at `at`). */
  cue(c: Cue, at?: number): void;
  /** New activity lines: one sound for the batch, the most urgent. */
  lines(fresh: readonly string[]): void;
}

/** The sound rules, with the clock, timers and audio injected. */
export function createSounder(deps: SounderDeps): Sounder {
  let on = false;
  let unlocked = false;
  let last = Number.NEGATIVE_INFINITY;
  const cue = (c: Cue, at = deps.now()): void => {
    if (!on || !unlocked || Math.abs(at - last) < GAP_MS) return;
    last = at;
    deps.play(c, at);
  };
  return {
    unlock() {
      unlocked = true;
    },
    get unlocked() {
      return unlocked;
    },
    setOn(next) {
      on = next;
    },
    cue,
    lines(fresh) {
      const c = pick(fresh);
      if (c) cue(c);
    },
  };
}
