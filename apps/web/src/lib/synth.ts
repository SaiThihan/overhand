/**
 * Each world's sounds, synthesised in WebAudio: no audio files, nothing to license, the same on every device (noise is
 * seeded). Every sound is diegetic, under 0.6 s, mixed quiet, and knows where its peak is, so it can land on a scene
 * beat's visual peak. The merge sound quotes the world's leitmotif. Spec: docs/creative-direction.md (Sound designer,
 * Composer). Loaded lazily, on the first sound.
 *
 * Levels: `TRIM` holds each sound's gain in dB, measured by `apps/web/scripts/sounds.ts` (OfflineAudioContext in
 * headless Chrome, BS.1770 loudness) so every event sound sits near -30 LUFS and starts and stops near -34.
 */
import type { Cue } from "./cues";

type Ctx = BaseAudioContext;

/** One sound: where its peak lands after it starts (s), how long it lasts (s), and how to play it at `t`. */
export interface Sound {
  peak: number;
  dur: number;
  play(c: Ctx, out: AudioNode, t: number): void;
}

/** A world's sounds: its leitmotif (MIDI notes) and one sound per event. */
export interface Palette {
  motif: readonly number[];
  sounds: Readonly<Record<Cue, Sound>>;
}

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** A small seeded generator (mulberry32): the same noise, and the same "random" key timing, on every device. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const noises = new WeakMap<Ctx, AudioBuffer>();
/** Eight seconds of seeded white noise per context: long enough that no two bursts sound alike. */
function noiseBuffer(c: Ctx): AudioBuffer {
  const had = noises.get(c);
  if (had) return had;
  const b = c.createBuffer(1, c.sampleRate * 8, c.sampleRate);
  const d = b.getChannelData(0);
  const r = seeded(46);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  noises.set(c, b);
  return b;
}

interface Shape {
  /** Rise (s). */
  a: number;
  /** Held at full until (s after start); defaults to the end of the rise. */
  h?: number;
  /** Silent by (s after start). */
  d: number;
  level: number;
}

/** A gain that rises, holds, then decays exponentially to silence: ramps at both ends, so never a click. */
function env(c: Ctx, out: AudioNode, t: number, s: Shape): GainNode {
  const g = c.createGain();
  const h = Math.max(s.h ?? s.a, s.a);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(s.level, t + s.a);
  if (h > s.a) g.gain.setValueAtTime(s.level, t + h);
  g.gain.exponentialRampToValueAtTime(Math.max(s.level * 1e-3, 1e-6), t + s.d - 0.004);
  g.gain.linearRampToValueAtTime(0, t + s.d);
  g.connect(out);
  return g;
}

interface ToneOpts extends Shape {
  f: number;
  type?: OscillatorType;
  /** Glides to this frequency by the end. */
  to?: number;
  /** Vibrato depth in cents, at 6 Hz. */
  vib?: number;
}

/** One oscillator under an envelope. */
function tone(c: Ctx, out: AudioNode, t: number, o: ToneOpts): OscillatorNode {
  const osc = c.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.d);
  if (o.vib) {
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = 6;
    depth.gain.value = o.vib;
    lfo.connect(depth).connect(osc.detune);
    lfo.start(t);
    lfo.stop(t + o.d + 0.01);
  }
  osc.connect(env(c, out, t, o));
  osc.start(t);
  osc.stop(t + o.d + 0.01);
  return osc;
}

interface NoiseOpts extends Shape {
  filter: BiquadFilterType;
  f: number;
  q?: number;
  /** The filter glides to this frequency by the end. */
  to?: number;
  /** Where in the noise to start (0..1), so two bursts never sound identical. */
  at?: number;
}

/** Filtered noise under an envelope. */
function noise(c: Ctx, out: AudioNode, t: number, o: NoiseOpts): void {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const bq = c.createBiquadFilter();
  bq.type = o.filter;
  bq.frequency.setValueAtTime(o.f, t);
  if (o.to) bq.frequency.exponentialRampToValueAtTime(o.to, t + o.d);
  bq.Q.value = o.q ?? 1;
  src.connect(bq).connect(env(c, out, t, o));
  src.start(t, (o.at ?? 0) * 7);
  src.stop(t + o.d + 0.01);
}

/** A gain that wobbles at `rate` Hz between 1 - 2 * depth and 1: purrs, rattles, trills. */
function wobble(c: Ctx, out: AudioNode, t: number, d: number, rate: number, depth: number, type: OscillatorType = "sine"): GainNode {
  const g = c.createGain();
  g.gain.value = 1 - depth;
  const lfo = c.createOscillator();
  const k = c.createGain();
  lfo.type = type;
  lfo.frequency.value = rate;
  k.gain.value = depth;
  lfo.connect(k).connect(g.gain);
  lfo.start(t);
  lfo.stop(t + d + 0.01);
  g.connect(out);
  return g;
}

/** A filter between a sound and its output. */
function through(c: Ctx, out: AudioNode, type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
  const bq = c.createBiquadFilter();
  bq.type = type;
  bq.frequency.value = f;
  bq.Q.value = q;
  bq.connect(out);
  return bq;
}

/** A struck bell: inharmonic partials (hum, prime, tierce, quint, nominal), the high ones dying first. */
function bell(c: Ctx, out: AudioNode, t: number, f: number, d: number, level: number): void {
  const parts: [number, number, number][] = [
    [0.5, 0.3, 1],
    [1, 1, 1],
    [1.19, 0.35, 0.75],
    [1.5, 0.22, 0.55],
    [2, 0.45, 0.6],
    [2.74, 0.18, 0.4],
    [4.07, 0.08, 0.25],
  ];
  for (const [ratio, amp, life] of parts) tone(c, out, t, { f: f * ratio, a: 0.004, d: d * life, level: level * amp });
}

/** A drum: a sine knock whose pitch drops, plus a short burst of skin noise. */
function drum(c: Ctx, out: AudioNode, t: number, f: number, d: number, level: number): void {
  tone(c, out, t, { f: f * 1.6, to: f, a: 0.003, d, level });
  noise(c, out, t, { filter: "lowpass", f: 900, a: 0.002, d: Math.min(0.08, d), level: level * 0.5 });
}

/** A key on a keyboard: a bright click and a little hollow body. */
function key(c: Ctx, out: AudioNode, t: number, level: number, f = 3200, body = 240): void {
  noise(c, out, t, { filter: "bandpass", f, q: 2.5, a: 0.001, d: 0.03, level, at: (t * 13) % 1 });
  tone(c, out, t, { f: body, a: 0.001, d: 0.045, level: level * 0.4 });
}

/** A sound from its peak, length and playing function. */
const sound = (peak: number, dur: number, play: Sound["play"]): Sound => ({ peak, dur, play });

// Overhand: a harbour at night. Brass, rope, water. Leitmotif D5 G5 B5, the bosun's rising call.
const HELM = [74, 79, 83] as const;
const overhand: Palette = {
  motif: HELM,
  sounds: {
    // a soft ship's bell, struck once
    needs: sound(0.01, 0.58, (c, o, t) => bell(c, through(c, o, "lowpass", 3200), t, hz(HELM[1]), 0.58, 0.5)),
    // a warm two-note chime: the motif's first two notes, the second the payoff
    merged: sound(0.17, 0.58, (c, o, t) => {
      const warm = through(c, o, "lowpass", 2600);
      bell(c, warm, t, hz(HELM[0]), 0.4, 0.3);
      bell(c, warm, t + 0.16, hz(HELM[1]), 0.42, 0.5);
    }),
    // a muffled buoy bell, low, under water and fog
    failure: sound(0.01, 0.58, (c, o, t) => bell(c, through(c, o, "lowpass", 650), t, hz(HELM[1] - 24), 0.58, 0.9)),
    // a quiet tick of the ship's clock; the stop is the tock
    start: sound(0.01, 0.08, (c, o, t) => key(c, o, t, 0.6, 4200, 1200)),
    stop: sound(0.01, 0.08, (c, o, t) => key(c, o, t, 0.6, 2400, 800)),
    // the motif's last two notes, small and high: the call answered
    repair: sound(0.13, 0.5, (c, o, t) => {
      const warm = through(c, o, "lowpass", 3000);
      bell(c, warm, t, hz(HELM[1] + 12), 0.3, 0.2);
      bell(c, warm, t + 0.12, hz(HELM[2] + 12), 0.36, 0.3);
    }),
  },
};

// Nexus: a neural sky. Clean synth, glass. Leitmotif C5 E5 G5 B5, a rising major seventh.
const NEX = [72, 76, 79, 83] as const;
const pluck = (c: Ctx, o: AudioNode, t: number, midi: number, level: number, d = 0.25) => {
  tone(c, o, t, { f: hz(midi), type: "triangle", a: 0.004, d, level });
  tone(c, o, t, { f: hz(midi + 12), a: 0.002, d: d * 0.5, level: level * 0.3 });
};
const nexus: Palette = {
  motif: NEX,
  sounds: {
    // a rising synth chord: the filter opens as it swells
    needs: sound(0.28, 0.58, (c, o, t) => {
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 3;
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.exponentialRampToValueAtTime(2800, t + 0.3);
      lp.frequency.exponentialRampToValueAtTime(900, t + 0.58);
      lp.connect(o);
      for (const [i, n] of [NEX[0] - 12, NEX[1] - 12, NEX[2] - 12].entries())
        tone(c, lp, t, { f: hz(n) * 0.985, to: hz(n), type: "sawtooth", a: 0.28, h: 0.3, d: 0.58, level: 0.2 - i * 0.03 });
    }),
    // a bright arpeggio: the whole motif, landing on its seventh
    merged: sound(0.22, 0.58, (c, o, t) => {
      NEX.forEach((n, i) => {
        pluck(c, o, t + i * 0.07, n, 0.18 + i * 0.07, i === 3 ? 0.37 : 0.22);
      });
    }),
    // a glitch: a square stutters, then falls away
    failure: sound(0.01, 0.5, (c, o, t) => {
      const st = wobble(c, through(c, o, "lowpass", 2400), t, 0.5, 31, 0.5, "square");
      tone(c, st, t, { f: hz(NEX[3]), to: hz(NEX[0] - 24), type: "square", a: 0.003, d: 0.5, level: 0.35 });
    }),
    // a soft blip up; the stop blips down
    start: sound(0.01, 0.12, (c, o, t) => tone(c, o, t, { f: 1046, to: 1568, a: 0.004, d: 0.12, level: 0.5 })),
    stop: sound(0.01, 0.12, (c, o, t) => tone(c, o, t, { f: 1568, to: 1046, a: 0.004, d: 0.12, level: 0.5 })),
    // two notes of the motif, soft: the link restored
    repair: sound(0.09, 0.4, (c, o, t) => {
      pluck(c, o, t, NEX[2], 0.15, 0.2);
      pluck(c, o, t + 0.08, NEX[3], 0.22, 0.32);
    }),
  },
};

// Legion: a field army in the open. Brass, skin, steel. Leitmotif D3 A3 D4, a horn call in fifths.
const LEG = [50, 57, 62] as const;
const horn = (c: Ctx, o: AudioNode, t: number, midi: number, d: number, level: number, cut = 1100) => {
  const lp = through(c, o, "lowpass", cut, 1.2);
  tone(c, lp, t, { f: hz(midi), type: "sawtooth", a: 0.06, h: d * 0.5, d, level, vib: 8 });
  tone(c, lp, t, { f: hz(midi) * 1.004, type: "sawtooth", a: 0.07, h: d * 0.5, d, level: level * 0.6 });
};
const legion: Palette = {
  motif: LEG,
  sounds: {
    // a distant horn, two notes: the call to orders
    needs: sound(0.3, 0.58, (c, o, t) => {
      horn(c, o, t, LEG[0], 0.24, 0.16, 700);
      horn(c, o, t + 0.22, LEG[1], 0.36, 0.24, 800);
    }),
    // a war drum, then a short cheer swelling under the horn's last two notes
    merged: sound(0.02, 0.58, (c, o, t) => {
      drum(c, o, t, 62, 0.4, 0.9);
      noise(c, o, t + 0.06, { filter: "bandpass", f: 900, q: 0.8, a: 0.2, d: 0.52, level: 0.12, at: 0.3 });
      horn(c, o, t + 0.08, LEG[1], 0.2, 0.06, 900);
      horn(c, o, t + 0.24, LEG[2], 0.34, 0.08, 900);
    }),
    // a drum misstep: a light beat, then a stumble out of time
    failure: sound(0.13, 0.5, (c, o, t) => {
      drum(c, o, t, 70, 0.12, 0.35);
      drum(c, o, t + 0.12, 52, 0.38, 0.9);
    }),
    // steel drawn: a rising scrape that rings at the end
    start: sound(0.26, 0.5, (c, o, t) => {
      noise(c, o, t, { filter: "bandpass", f: 2400, to: 6500, q: 6, a: 0.3, h: 0.32, d: 0.4, level: 0.5, at: 0.6 });
      const ring = through(c, o, "highpass", 2000);
      tone(c, ring, t + 0.33, { f: 3150, a: 0.004, d: 0.17, level: 0.08 });
      tone(c, ring, t + 0.33, { f: 4730, a: 0.004, d: 0.12, level: 0.05 });
    }),
    // steel sheathed: a falling scrape that ends in the scabbard's thunk
    stop: sound(0.28, 0.4, (c, o, t) => {
      noise(c, o, t, { filter: "bandpass", f: 5200, to: 1800, q: 5, a: 0.03, h: 0.2, d: 0.28, level: 0.3, at: 0.2 });
      tone(c, o, t + 0.27, { f: 140, to: 90, a: 0.003, d: 0.12, level: 0.5 });
      noise(c, o, t + 0.27, { filter: "lowpass", f: 1200, a: 0.002, d: 0.05, level: 0.4, at: 0.9 });
    }),
    // the horn's answer, high and short: the tent pitched again
    repair: sound(0.23, 0.48, (c, o, t) => {
      horn(c, o, t, LEG[1], 0.18, 0.08, 1000);
      horn(c, o, t + 0.16, LEG[2], 0.32, 0.12, 1000);
    }),
  },
};

// Syndicate: a covert room in the rain. Wood, phones, locks. Leitmotif A3 C4 Eb4, a held breath.
const SYN = [57, 60, 63] as const;
const buzz = (c: Ctx, o: AudioNode, t: number, d: number, level: number) => {
  const wood = through(c, through(c, o, "lowpass", 1400), "peaking", 240, 3);
  const rattle = wobble(c, wood, t, d, 23, 0.25);
  tone(c, rattle, t, { f: 150, type: "square", a: 0.015, h: 0.05, d, level });
};
const swell = (c: Ctx, o: AudioNode, t: number, notes: readonly number[], peak: number, d: number, level: number) => {
  const lp = through(c, o, "lowpass", 900);
  notes.forEach((n, i) => {
    tone(c, lp, t + i * 0.03, { f: hz(n - 12), type: "triangle", a: peak - i * 0.03, d: d - i * 0.03, level });
  });
};
const lock = (c: Ctx, o: AudioNode, t: number, level: number) => {
  noise(c, o, t, { filter: "highpass", f: 2800, a: 0.001, d: 0.025, level, at: 0.41 });
  noise(c, o, t + 0.03, { filter: "bandpass", f: 1800, q: 3, a: 0.001, d: 0.03, level: level * 0.7, at: 0.77 });
};
const syndicate: Palette = {
  motif: SYN,
  sounds: {
    // a phone vibrating on wood, twice
    needs: sound(0.04, 0.56, (c, o, t) => {
      buzz(c, o, t, 0.24, 0.3);
      buzz(c, o, t + 0.32, 0.24, 0.18);
    }),
    // a soft lock click on top of a low swell of the motif
    merged: sound(0.21, 0.58, (c, o, t) => {
      swell(c, o, t, SYN, 0.21, 0.58, 0.1);
      lock(c, o, t + 0.2, 1.2);
    }),
    // a burst of static
    failure: sound(0.035, 0.36, (c, o, t) => {
      const crackle = wobble(c, o, t, 0.36, 37, 0.45, "square");
      noise(c, crackle, t, { filter: "bandpass", f: 2600, q: 0.5, a: 0.003, h: 0.12, d: 0.36, level: 0.6, at: 0.5 });
    }),
    // a burst of typing; the stop ends on the return key
    start: sound(0.23, 0.36, (c, o, t) => {
      const r = seeded(7);
      for (const [i, at] of [0, 0.07, 0.13, 0.22, 0.29].entries()) key(c, o, t + at, i === 3 ? 0.55 : 0.25 + r() * 0.15);
    }),
    stop: sound(0.17, 0.26, (c, o, t) => {
      key(c, o, t, 0.25);
      key(c, o, t + 0.07, 0.22);
      key(c, o, t + 0.16, 0.6, 1800, 160);
    }),
    // a relay tick and a smaller swell: the dead screen back to life
    repair: sound(0.17, 0.46, (c, o, t) => {
      swell(c, o, t, [SYN[1], SYN[2]], 0.17, 0.46, 0.1);
      noise(c, o, t + 0.16, { filter: "highpass", f: 3500, a: 0.001, d: 0.02, level: 0.35, at: 0.12 });
    }),
  },
};

// Tokenmaxx: a satirical office. Plastic, chrome, brass that misses. Leitmotif C5 E5 G5 C6, the jingle.
const TOK = [72, 76, 79, 84] as const;
const tokenmaxx: Palette = {
  motif: TOK,
  sounds: {
    // an office phone ring: two tones trilled
    needs: sound(0.02, 0.5, (c, o, t) => {
      const trill = wobble(c, through(c, o, "lowpass", 3000), t, 0.5, 17, 0.5, "square");
      tone(c, trill, t, { f: 1046, a: 0.008, h: 0.03, d: 0.5, level: 0.25 });
      tone(c, trill, t, { f: 1318, a: 0.008, h: 0.03, d: 0.5, level: 0.18 });
    }),
    // ka-ching: the drawer's clack, then the bell rings the jingle's top
    merged: sound(0.1, 0.58, (c, o, t) => {
      noise(c, o, t, { filter: "bandpass", f: 2200, q: 2, a: 0.001, d: 0.04, level: 0.5, at: 0.33 });
      tone(c, o, t + 0.03, { f: 180, a: 0.002, d: 0.06, level: 0.3 });
      const bright = through(c, o, "highpass", 900);
      bell(c, bright, t + 0.09, hz(TOK[1] + 12), 0.48, 0.18);
      bell(c, bright, t + 0.1, hz(TOK[2] + 12), 0.46, 0.14);
      bell(c, bright, t + 0.11, hz(TOK[3] + 12), 0.45, 0.12);
    }),
    // a sad trombone: wah, wah, wah, waaah
    failure: sound(0.035, 0.58, (c, o, t) => {
      [62, 61, 60, 59].forEach((n, i) => {
        const at = t + i * 0.12;
        const last = i === 3;
        const wah = c.createBiquadFilter();
        wah.type = "lowpass";
        wah.Q.value = 4;
        wah.frequency.setValueAtTime(400, at);
        wah.frequency.linearRampToValueAtTime(1400, at + 0.05);
        wah.frequency.exponentialRampToValueAtTime(500, at + (last ? 0.22 : 0.12));
        wah.connect(o);
        tone(c, wah, at, {
          f: hz(n),
          type: "sawtooth",
          a: 0.02,
          h: last ? 0.1 : 0.06,
          d: last ? 0.22 : 0.12,
          level: 0.3 - i * 0.04,
          vib: last ? 30 : 0,
        });
      });
    }),
    // a keyboard clack-clack; the stop is the space bar
    start: sound(0.09, 0.14, (c, o, t) => {
      key(c, o, t, 0.4, 1800, 180);
      key(c, o, t + 0.08, 0.6, 1900, 190);
    }),
    stop: sound(0.01, 0.06, (c, o, t) => key(c, o, t, 0.7, 1200, 120)),
    // one bell on the jingle's top note: a tiny raise
    repair: sound(0.01, 0.45, (c, o, t) => bell(c, through(c, o, "highpass", 900), t, hz(TOK[3] + 12), 0.45, 0.2)),
  },
};

// Catnap: a sunny flat of cats. Fur, felt, porcelain. Leitmotif E5 G5 B5, a question a cat asks.
const CAT = [76, 79, 83] as const;
const mrrp = (c: Ctx, o: AudioNode, t: number, from: number, top: number, end: number, d: number, level: number) => {
  const mouth = through(c, o, "lowpass", 2600);
  const f1 = through(c, mouth, "bandpass", 900, 4);
  const f2 = through(c, mouth, "bandpass", 2000, 5);
  const rr = wobble(c, f1, t, d, 30, 0.35);
  rr.connect(f2);
  const osc = c.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(top, t + d * 0.55);
  osc.frequency.exponentialRampToValueAtTime(end, t + d);
  osc.connect(env(c, rr, t, { a: 0.03, h: d * 0.45, d, level }));
  osc.start(t);
  osc.stop(t + d + 0.01);
};
const purr = (c: Ctx, o: AudioNode, t: number, d: number, level: number) => {
  const pr = wobble(c, through(c, o, "lowpass", 300), t, d, 25, 0.5);
  noise(c, pr, t, { filter: "lowpass", f: 420, a: d * 0.35, h: d * 0.5, d, level, at: 0.15 });
};
const catnap: Palette = {
  motif: CAT,
  sounds: {
    // a short "mrrp": a rising chirp, then a quick fall
    needs: sound(0.04, 0.26, (c, o, t) => mrrp(c, o, t, 420, 620, 480, 0.26, 0.5)),
    // a happy trill: the motif rolled, with a flutter, the last note on the gift's drop
    merged: sound(0.2, 0.46, (c, o, t) => {
      const flutter = wobble(c, o, t, 0.46, 28, 0.3);
      CAT.forEach((n, i) => {
        tone(c, flutter, t + i * 0.09, { f: hz(n), type: "triangle", a: 0.01, d: i === 2 ? 0.28 : 0.12, level: 0.18 + i * 0.08 });
      });
    }),
    // a soft thump: the mug lands
    failure: sound(0.01, 0.22, (c, o, t) => {
      tone(c, o, t, { f: 110, to: 80, a: 0.003, d: 0.22, level: 0.9 });
      noise(c, o, t, { filter: "bandpass", f: 2400, q: 2, a: 0.001, d: 0.02, level: 0.2, at: 0.8 });
    }),
    // a soft purr as a cat gets up; a shorter one as it settles
    start: sound(0.25, 0.5, (c, o, t) => purr(c, o, t, 0.5, 0.9)),
    stop: sound(0.13, 0.3, (c, o, t) => purr(c, o, t, 0.3, 0.9)),
    // a small contented trill, the motif's top two notes
    repair: sound(0.1, 0.36, (c, o, t) => {
      const flutter = wobble(c, o, t, 0.36, 28, 0.3);
      tone(c, flutter, t, { f: hz(CAT[1]), type: "triangle", a: 0.01, d: 0.12, level: 0.14 });
      tone(c, flutter, t + 0.09, { f: hz(CAT[2]), type: "triangle", a: 0.01, d: 0.27, level: 0.2 });
    }),
  },
};

// the launch worlds took the retired worlds' palettes (Observatory the neural sky's glass, Transit the office's chime, Koi the
// rain); Legion's waits for a world of its own
/** Every world's palette, by theme id. */
export const PALETTES: Readonly<Record<string, Palette>> = {
  overhand,
  observatory: nexus,
  transit: tokenmaxx,
  koi: syndicate,
  legion,
  catnap,
};

/** Each sound's trim in dB, from the loudness measurements; 0 where none is set. */
export const TRIM: Readonly<Record<string, Partial<Record<Cue, number>>>> = {
  overhand: { needs: -13.2, merged: -14, failure: -17.5, start: -2.9, stop: -1.4, repair: -15.3 },
  observatory: { needs: -11.1, merged: -10.3, failure: -6.6, start: -11.9, stop: -13.1, repair: -6.4 },
  legion: { needs: -13.3, merged: -12.4, failure: -16, start: -11.3, stop: -12.5, repair: -8.7 },
  koi: { needs: -7.8, merged: -10.6, failure: -12.5, start: -4.4, stop: -2.2, repair: -6 },
  transit: { needs: -9.5, merged: -10.7, failure: -10.4, start: -2.9, stop: -1.4, repair: -11.8 },
  catnap: { needs: -5.3, merged: -5, failure: -13.9, start: -5.2, stop: -3.3, repair: -1.8 },
};

/** The palette for a theme; the house palette for one without its own. */
export function paletteFor(theme: string): Palette {
  return PALETTES[theme] ?? overhand;
}

/** Plays `cue` in `theme`'s palette at `t` (context seconds), through its trim. */
export function playCue(c: Ctx, out: AudioNode, theme: string, cue: Cue, t: number): void {
  const g = c.createGain();
  g.gain.value = 10 ** ((TRIM[PALETTES[theme] ? theme : "overhand"]?.[cue] ?? 0) / 20);
  g.connect(through(c, out, "highpass", 30)); // no DC from a drum's pitch drop or a key's body
  paletteFor(theme).sounds[cue].play(c, g, t);
}
