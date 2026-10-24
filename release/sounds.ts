/**
 * The sound check, for ears that aren't in the room: renders every world's sounds with an OfflineAudioContext
 * in headless Chrome (the same WebAudio graph the dashboard plays), then measures each one:
 * length, sample and true peak, BS.1770 loudness (integrated, momentary and short-term max), DC offset, clicks at
 * either end, and whether the onset-to-peak time matches the peak the sound declares (the beat's visual peak lands
 * there). Writes a WAV per sound, report.json, a table (report.md) and an index.html that plays each one. Exits 1 on
 * any failure.
 *
 * Usage: bun release/sounds.ts [--out dir] [--calibrate]
 *   --calibrate prints the TRIM table that puts every sound on its loudness target (paste it into synth.ts).
 *
 * Needs playwright-core and its Chromium, as `bun run shots` does.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CUES, type Cue } from "../apps/web/src/lib/cues";
import { PALETTES, TRIM } from "../apps/web/src/lib/synth";

const ROOT = resolve(import.meta.dir, "..");
const RATE = 48_000;
/** Loudness targets (LUFS, integrated): events near -30, starts and stops quieter; each within ±2 LU across worlds. */
const TARGET: Record<Cue, number> = { needs: -30, merged: -30, failure: -30, repair: -32, start: -34, stop: -34 };
const TOLERANCE_LU = 2;
const MAX_TRUE_PEAK = -3;
/** How far the measured onset-to-peak may sit from the declared one (s). */
const PEAK_TOLERANCE = 0.03;

/** One render: interleaving-free channels at 48 kHz. */
type Channels = Float32Array[];

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : Number.NEGATIVE_INFINITY);

/** A biquad over a signal (direct form I). */
function biquad(x: Float32Array, b: readonly number[], a: readonly number[]): Float32Array {
  const y = new Float32Array(x.length);
  const [b0 = 0, b1 = 0, b2 = 0] = b;
  const [, a1 = 0, a2 = 0] = a;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i] ?? 0;
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    y[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return y;
}

/** BS.1770 K-weighting at 48 kHz: the head's high shelf, then the RLB high-pass. */
function kWeight(x: Float32Array): Float32Array {
  const shelf = biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]);
  return biquad(shelf, [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
}

/** Loudness of each window (`win` s, hopping `hop` s) over K-weighted channels, padded with silence to one window. */
function blocks(ch: Channels, win: number, hop: number): number[] {
  const n = Math.round(win * RATE);
  const step = Math.round(hop * RATE);
  const len = Math.max(n, ch[0]?.length ?? 0);
  const k = ch.map((c) => {
    const p = new Float32Array(len);
    p.set(c);
    return kWeight(p);
  });
  const out: number[] = [];
  for (let s = 0; s + n <= len; s += step) {
    let sum = 0;
    for (const c of k) for (let i = s; i < s + n; i++) sum += (c[i] ?? 0) ** 2;
    out.push(-0.691 + 10 * Math.log10(sum / n || 1e-20));
  }
  return out;
}

/** Integrated loudness (LUFS): 400 ms blocks, 75 % overlap, absolute gate -70, relative gate -10. */
function integrated(ch: Channels): number {
  const power = (l: number[]) => 10 * Math.log10(l.reduce((s, x) => s + 10 ** ((x + 0.691) / 10), 0) / l.length) - 0.691;
  const abs = blocks(ch, 0.4, 0.1).filter((l) => l > -70);
  if (!abs.length) return Number.NEGATIVE_INFINITY;
  const rel = power(abs) - 10;
  return power(abs.filter((l) => l > rel));
}

/** True peak (dBTP): 4× oversampled with a windowed-sinc interpolator. */
function truePeak(ch: Channels): number {
  const taps = 12;
  const kernels = [1, 2, 3].map((ph) =>
    Array.from({ length: 2 * taps }, (_, j) => {
      const x = j - taps + 1 - ph / 4;
      return (Math.sin(Math.PI * x) / (Math.PI * x)) * (0.5 + 0.5 * Math.cos((Math.PI * x) / taps));
    }),
  );
  let peak = 0;
  for (const c of ch)
    for (let i = 0; i < c.length; i++) {
      peak = Math.max(peak, Math.abs(c[i] ?? 0));
      for (const kern of kernels) {
        let v = 0;
        for (let j = 0; j < kern.length; j++) v += (c[i + j - taps + 1] ?? 0) * (kern[j] ?? 0);
        peak = Math.max(peak, Math.abs(v));
      }
    }
  return db(peak);
}

interface Row {
  theme: string;
  cue: string;
  file: string;
  declaredDur: number;
  audibleDur: number;
  samplePeak: number;
  truePeak: number;
  lufs: number;
  momentaryMax: number;
  shortTermMax: number;
  dc: number;
  edgeStart: number;
  edgeEnd: number;
  declaredPeak: number;
  measuredPeak: number;
  fails: string[];
}

/** Every measurement of one render, and what fails. */
function measure(theme: string, cue: string, ch: Channels, declaredPeak: number, declaredDur: number): Omit<Row, "file"> {
  const mono = ch[0] ?? new Float32Array();
  let sp = 0;
  for (const c of ch) for (const v of c) sp = Math.max(sp, Math.abs(v));
  let end = mono.length - 1;
  while (end > 0 && Math.abs(mono[end] ?? 0) < sp * 0.001) end--;
  // the peak: the loudest 20 ms window (2 ms hop), at its centre, timed from the onset (sample 0: every envelope
  // starts there from silence, and the dashboard schedules the start that far before the beat's peak)
  const w = Math.round(0.02 * RATE);
  const hop = Math.round(0.002 * RATE);
  let best = 0;
  let bestAt = 0;
  for (let s = 0; s + w <= mono.length; s += hop) {
    let e = 0;
    for (let i = s; i < s + w; i++) e += (mono[i] ?? 0) ** 2;
    if (e > best) {
      best = e;
      bestAt = s + w / 2;
    }
  }
  const dc = Math.max(...ch.map((c) => Math.abs(c.reduce((s, v) => s + v, 0) / c.length)));
  const edge = (from: number, to: number) => db(Math.max(...ch.map((c) => Math.max(...Array.from(c.subarray(from, to), Math.abs)))));
  const r = {
    theme,
    cue,
    declaredDur,
    audibleDur: end / RATE,
    samplePeak: db(sp),
    truePeak: truePeak(ch),
    lufs: integrated(ch),
    momentaryMax: Math.max(...blocks(ch, 0.4, 0.1)),
    shortTermMax: Math.max(...blocks(ch, 3, 0.1)),
    dc,
    edgeStart: edge(0, 2),
    edgeEnd: edge(mono.length - Math.round(0.002 * RATE), mono.length),
    declaredPeak,
    measuredPeak: bestAt / RATE,
    fails: [] as string[],
  };
  if (r.samplePeak >= -0.1) r.fails.push("clips");
  if (r.truePeak > MAX_TRUE_PEAK) r.fails.push(`true peak ${r.truePeak.toFixed(1)} dBTP`);
  if (dc > 1e-3) r.fails.push(`DC ${dc.toExponential(1)}`);
  if (r.edgeStart > -60) r.fails.push("click at start");
  if (r.edgeEnd > -60) r.fails.push("click at end");
  return r;
}

/** A 16-bit PCM WAV of the channels. */
function wav(ch: Channels): Uint8Array {
  const n = ch[0]?.length ?? 0;
  const buf = new ArrayBuffer(44 + n * ch.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + n * ch.length * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch.length, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * ch.length * 2, true);
  v.setUint16(32, ch.length * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * ch.length * 2, true);
  for (let i = 0; i < n; i++)
    for (const [k, c] of ch.entries())
      v.setInt16(44 + (i * ch.length + k) * 2, Math.round(Math.max(-1, Math.min(1, c[i] ?? 0)) * 32767), true);
  return new Uint8Array(buf);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const at = args.indexOf("--out");
  const out = resolve((at >= 0 ? args[at + 1] : undefined) ?? join(tmpdir(), "overhand-sounds"));
  const calibrate = args.includes("--calibrate");
  mkdirSync(out, { recursive: true });
  const built = await Bun.build({ entrypoints: [join(ROOT, "apps/web/src/lib/synth.ts")], format: "esm", target: "browser" });
  const code = await built.outputs[0]?.text();
  if (!code) throw new Error("couldn't bundle synth.ts");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const src = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  /** Renders a cue in the page; returns its channels. */
  const render = async (theme: string, what: Cue, seconds: number): Promise<Channels> => {
    const data = await page.evaluate(
      async ({ src, theme, what, seconds, rate }) => {
        const m = await import(src);
        const c = new OfflineAudioContext(2, Math.round(seconds * rate), rate);
        m.playCue(c, c.destination, theme, what, 0);
        const b = await c.startRendering();
        return [Array.from(b.getChannelData(0)), Array.from(b.getChannelData(1))];
      },
      { src, theme, what, seconds, rate: RATE },
    );
    return data.map((d) => Float32Array.from(d));
  };
  const rows: Row[] = [];
  const trims: Record<string, Partial<Record<Cue, number>>> = {};
  try {
    for (const [theme, palette] of Object.entries(PALETTES)) {
      for (const cue of CUES) {
        const s = palette.sounds[cue];
        const ch = await render(theme, cue, s.dur + 0.04);
        const file = `${theme}-${cue}.wav`;
        writeFileSync(join(out, file), wav(ch));
        const r: Row = { ...measure(theme, cue, ch, s.peak, s.dur), file };
        if (s.dur > 0.6) r.fails.push(`${s.dur} s long`);
        if (Math.abs(r.lufs - TARGET[cue]) > TOLERANCE_LU) r.fails.push(`${r.lufs.toFixed(1)} LUFS, target ${TARGET[cue]}`);
        if (Math.abs(r.measuredPeak - s.peak) > PEAK_TOLERANCE)
          r.fails.push(`peak at ${r.measuredPeak.toFixed(3)} s, declared ${s.peak} s`);
        rows.push(r);
        trims[theme] = { ...trims[theme], [cue]: Math.round(((TRIM[theme]?.[cue] ?? 0) + TARGET[cue] - r.lufs) * 10) / 10 };
      }
    }
  } finally {
    await browser.close();
  }
  if (calibrate) console.log(`export const TRIM = ${JSON.stringify(trims, null, 2)};`);
  const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "–");
  const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "–");
  const head =
    "| theme | sound | length s | true peak dBTP | LUFS (int.) | momentary max | short-term max | DC | start/end dBFS | peak declared / measured s | result |";
  const table = [
    head,
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) =>
      [
        r.theme,
        r.cue,
        f3(r.audibleDur),
        f1(r.truePeak),
        f1(r.lufs),
        f1(r.momentaryMax),
        f1(r.shortTermMax),
        r.dc.toExponential(1),
        `${f1(r.edgeStart)} / ${f1(r.edgeEnd)}`,
        Number.isNaN(r.measuredPeak) ? "–" : `${r.declaredPeak.toFixed(3)} / ${f3(r.measuredPeak)}`,
        r.fails.length ? `FAIL: ${r.fails.join("; ")}` : "ok",
      ].join(" | "),
    ),
  ]
    .map((l) => (l.startsWith("|") ? l : `| ${l} |`))
    .join("\n");
  // consistency across worlds: each event's loudness spread
  const spread = CUES.map((cue) => {
    const l = rows.filter((r) => r.cue === cue).map((r) => r.lufs);
    return `${cue}: ${f1(Math.min(...l))} to ${f1(Math.max(...l))} LUFS (target ${TARGET[cue]} ±${TOLERANCE_LU})`;
  }).join("\n");
  writeFileSync(join(out, "report.md"), `# Overhand sounds\n\n${table}\n\nSpread across worlds:\n\n${spread}\n`);
  writeFileSync(join(out, "report.json"), JSON.stringify(rows, null, 2));
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  writeFileSync(
    join(out, "index.html"),
    [
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overhand sounds</title>',
      "<style>body{font:14px system-ui;margin:16px;background:#0e1116;color:#e6e6e6}table{border-collapse:collapse}td,th{padding:4px 8px;border-bottom:1px solid #333;text-align:left}.f{color:#f77}</style>",
      "<h1>Overhand sounds</h1><p>Every world's palette, as synthesised in Overhand (48 kHz, rendered offline).</p>",
      `<pre>${esc(spread)}</pre><table><tr><th>theme</th><th>sound</th><th>play</th><th>LUFS</th><th>dBTP</th><th>peak s (declared / measured)</th><th>result</th></tr>`,
      ...rows.map(
        (r) =>
          `<tr><td>${r.theme}</td><td>${r.cue}</td><td><audio controls preload="none" src="${r.file}"></audio></td><td>${f1(r.lufs)}</td><td>${f1(r.truePeak)}</td><td>${Number.isNaN(r.measuredPeak) ? "–" : `${r.declaredPeak} / ${f3(r.measuredPeak)}`}</td><td class="${r.fails.length ? "f" : ""}">${esc(r.fails.join("; ") || "ok")}</td></tr>`,
      ),
      "</table>",
    ].join("\n"),
  );
  const failed = rows.filter((r) => r.fails.length);
  console.log(`${table}\n\n${spread}\n\n${rows.length} sounds, ${failed.length} failing → ${out}/index.html`);
  if (failed.length && !calibrate) process.exit(1);
}

await main();
