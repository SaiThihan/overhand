import type { DashboardState } from "@overhand/contract";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { audio } from "@/lib/audio";
import { type Cue, createSounder } from "@/lib/cues";
import { store } from "./store";

const SOUND = "overhand-sound";

/** The synthesiser, imported on the first sound only: it never weighs on the first page. */
const synth = () => import("@/lib/synth");

let theme = "overhand";
let on = store.get(SOUND) === "1";
// the ambient bed is gone: forget its old setting
store.remove("overhand-sound-bed");
let master: GainNode | null = null;

/** The one master volume every sound passes through. */
function out(c: AudioContext): GainNode {
  if (!master) {
    master = c.createGain();
    master.gain.value = 1;
    master.connect(c.destination);
  }
  return master;
}

const sounder = createSounder({
  now: Date.now,
  play(cue, at) {
    const c = audio();
    const world = theme;
    void synth().then((m) => {
      // start early by the sound's own peak, so the peak lands at `at` (a beat's visual peak); never in the past
      const t = c.currentTime + Math.max(0, (at - Date.now()) / 1000 - m.paletteFor(world).sounds[cue].peak);
      m.playCue(c, out(c), world, cue, t);
    });
  },
});
sounder.setOn(on);

const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// browsers keep audio locked until a gesture: nothing plays (or is even made) before the first tap or key
if (typeof window !== "undefined") {
  const unlock = () => {
    removeEventListener("pointerdown", unlock, true);
    removeEventListener("keydown", unlock, true);
    sounder.unlock();
    if (on) void audio().resume(); // inside the gesture, or phones keep it suspended
    changed();
  };
  addEventListener("pointerdown", unlock, true);
  addEventListener("keydown", unlock, true);
}

/** Plays one sound in the current world's palette now, if sound is on and a gesture has unlocked audio. */
export function cue(c: Cue): void {
  sounder.cue(c);
}

/** Whether sounds are on, shared by every component that shows the toggle. */
export function useSound(): { on: boolean; toggle: () => void } {
  useSyncExternalStore(subscribe, () => version);
  return {
    on,
    toggle: () => {
      on = !on;
      store.set(SOUND, on ? "1" : "0");
      sounder.setOn(on);
      // the toggle is a gesture: turning sound on answers with the world's own small sound
      sounder.unlock();
      if (on) cue("start");
      changed();
    },
  };
}

/**
 * The world's sounds for the dashboard: one sound per batch of new activity lines (silent on first load), each in
 * `world`'s palette; scene beats sound on their own visual peaks.
 */
export function useEventChimes(reports: DashboardState["reports"] | undefined, world: string): void {
  theme = world;
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!reports) return;
    if (!seen.current) {
      seen.current = new Set(reports);
      return;
    }
    const known = seen.current;
    const fresh = reports.filter((l) => !known.has(l));
    for (const l of reports) known.add(l);
    if (fresh.length) sounder.lines(fresh);
  }, [reports]);
}
