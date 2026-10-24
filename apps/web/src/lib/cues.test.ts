import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allWorlds as themes } from "@overhand/themes";
import { CUES, type Cue, createSounder, cueOf, GAP_MS, pick } from "./cues";
import { PALETTES, paletteFor, TRIM } from "./synth";

/** A sounder on a hand-wound clock, recording what it plays. */
function rig() {
  let now = 1_000_000;
  const played: [Cue, number][] = [];
  const s = createSounder({ now: () => now, play: (c, at) => played.push([c, at]) });
  const tick = (ms: number) => {
    now += ms;
  };
  return { s, played, tick };
}

test("every theme has its own palette with every sound, each short, its peak inside it", () => {
  for (const t of themes) {
    const p = paletteFor(t.id);
    expect(PALETTES[t.id], `${t.id} has its own palette`).toBe(p);
    expect(p.motif.length).toBeGreaterThanOrEqual(3);
    expect(p.motif.length).toBeLessThanOrEqual(4);
    for (const c of CUES) {
      const s = p.sounds[c];
      expect(s.dur, `${t.id} ${c}`).toBeLessThanOrEqual(0.6);
      expect(s.peak).toBeGreaterThanOrEqual(0);
      expect(s.peak).toBeLessThan(s.dur);
      expect(TRIM[t.id]?.[c], `${t.id} ${c} is level-matched`).toBeDefined();
    }
  }
  // no two worlds share a sound
  const all = themes.flatMap((t) => CUES.map((c) => paletteFor(t.id).sounds[c].play));
  expect(new Set(all).size).toBe(all.length);
  expect(paletteFor("no-such-world")).toBe(paletteFor("overhand"));
});

test("activity lines map to sounds, and a burst is one sound, the most urgent", () => {
  expect(cueOf("- 09:00 ⚡ Ops lead started headless (pid 2, dev)")).toBe("start");
  expect(cueOf("- 10:43 ⚡ Ops lead exited (0) after 43 min")).toBe("stop");
  expect(cueOf("- 13:40 🎉 KITE-9 PR merged")).toBe("merged");
  expect(cueOf("- 11:00 ✗ KITE-9 fix round 1 (sam): x")).toBe("failure");
  expect(cueOf("- 11:00 ❓ Ops lead asks: which database?")).toBe("needs");
  expect(cueOf("- 09:00 📋 plan written")).toBeNull();
  expect(pick(["- 07:00 🎉 HONEY-5 PR merged", "- 07:01 🎉 HONEY-7 PR merged"])).toBe("merged");
  expect(pick(["- 07:00 🎉 HONEY-5 PR merged", "- 07:00 ✗ HONEY-3 attempt 1: tests red"])).toBe("failure");
  expect(pick(["- 09:00 📋 plan written"])).toBeNull();
});

test("nothing plays before a gesture, or with sound off", () => {
  const { s, played } = rig();
  s.setOn(true);
  s.cue("failure");
  expect(played).toEqual([]);
  s.unlock();
  s.setOn(false);
  s.cue("failure");
  expect(played).toEqual([]);
  s.setOn(true);
  s.cue("failure");
  expect(played.map(([c]) => c)).toEqual(["failure"]);
});

test("never two sounds within 1.5 s; merges in a burst are one sound", () => {
  const { s, played, tick } = rig();
  s.unlock();
  s.setOn(true);
  s.cue("start");
  tick(GAP_MS - 1);
  s.cue("stop");
  expect(played.map(([c]) => c)).toEqual(["start"]);
  tick(1);
  s.cue("stop");
  expect(played.map(([c]) => c)).toEqual(["start", "stop"]);
  tick(GAP_MS);
  s.lines(["- 07:00 🎉 A-1 PR merged", "- 07:00 🎉 A-2 PR merged", "- 07:00 🎉 A-3 PR merged"]);
  s.lines(["- 07:00 🎉 A-4 PR merged"]);
  expect(played.map(([c]) => c)).toEqual(["start", "stop", "merged"]);
});

test("nothing plays on its own: no sound loops, and no ambient bed is left to start", () => {
  const root = join(import.meta.dir, "..");
  for (const f of new Bun.Glob("**/*.{ts,tsx}").scanSync(root)) {
    if (f.endsWith(".test.ts")) continue;
    const text = readFileSync(join(root, f), "utf8");
    expect({ f, loop: /\.loop\s*=\s*true|startBed|useAmbient/.test(text) }).toEqual({ f, loop: false });
  }
});
