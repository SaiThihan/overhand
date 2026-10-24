/**
 * The light at any hour of the day: sky, far and near land, water, and how much day there is. The attention map tints
 * itself with it (apps/web/src/map/hour.ts), so it warms at dawn and dusk and cools at night.
 */
import { day as DAY_INK } from "./overhand/palette";

export type Rgb = [number, number, number];
/** The light at one hour: the colours every layer is painted with. */
export interface Light {
  skyTop: Rgb;
  skyLow: Rgb;
  far: Rgb;
  near: Rgb;
  water: Rgb;
  /** 0 at midnight dark, 1 in full day: windows, stars and glows scale by its inverse. */
  day: number;
}

// the dashboard's day paper: the day's light lands on it
const PAPER = DAY_INK[0];
// the Night Watch palette (git 3800f97) at night, landing on the dashboard's day paper by day
const MIDNIGHT: Light = {
  skyTop: hex("#070b16"),
  skyLow: hex("#0e1426"),
  far: hex("#121a30"),
  near: hex("#0a0f1d"),
  water: hex("#060a14"),
  day: 0,
};
const KEYS: [number, Light][] = [
  [0, MIDNIGHT],
  [4.5, { skyTop: hex("#1a1d44"), skyLow: hex("#5a3d63"), far: hex("#2a2850"), near: hex("#141634"), water: hex("#14163a"), day: 0.15 }],
  [6.6, { skyTop: hex("#35598a"), skyLow: hex("#f2cf98"), far: hex("#5d6a8e"), near: hex("#2c3552"), water: hex("#3b4f78"), day: 0.5 }],
  [9, { skyTop: hex("#bccbd2"), skyLow: hex(PAPER), far: hex("#a7b6b6"), near: hex("#6f8282"), water: hex("#b9c8c8"), day: 1 }],
  [16, { skyTop: hex("#b3c4cc"), skyLow: hex("#e6e8e1"), far: hex("#a1b0b0"), near: hex("#687b7b"), water: hex("#b3c3c3"), day: 1 }],
  [18.8, { skyTop: hex("#2f3666"), skyLow: hex("#e9a46a"), far: hex("#4a4f75"), near: hex("#262a48"), water: hex("#36406a"), day: 0.45 }],
  [20.6, { skyTop: hex("#0b1022"), skyLow: hex("#1c2440"), far: hex("#151d36"), near: hex("#0c1222"), water: hex("#0a0f20"), day: 0.06 }],
  [24, MIDNIGHT],
];

function hex(h: string): Rgb {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (t: number) => t * t * (3 - 2 * t);

/** The light at an hour, eased between the keyframes. */
export function lightAt(hour: number): Light {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && (KEYS[i + 1]?.[0] ?? 24) <= h) i++;
  const [h0, a] = KEYS[i] ?? [0, MIDNIGHT];
  const [h1, b] = KEYS[i + 1] ?? [24, MIDNIGHT];
  const t = smooth(h1 === h0 ? 0 : (h - h0) / (h1 - h0));
  return {
    skyTop: mixRgb(a.skyTop, b.skyTop, t),
    skyLow: mixRgb(a.skyLow, b.skyLow, t),
    far: mixRgb(a.far, b.far, t),
    near: mixRgb(a.near, b.near, t),
    water: mixRgb(a.water, b.water, t),
    day: a.day + (b.day - a.day) * t,
  };
}
