import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND_FILES, decodePng, encodePng, rasterise } from "../build-brand";
import { iconSvg, lockupSvg, markParts, markSvg } from "../src/brand";
import { SYSTEM } from "../src/system";

const ROOT = join(import.meta.dir, "../../..");

/** Every colour the system defines, lower-cased. */
const SYSTEM_COLOURS = new Set(
  [...SYSTEM.ink.day, ...SYSTEM.ink.night, ...Object.values(SYSTEM.state.day), ...Object.values(SYSTEM.state.night)].map((c) =>
    c.toLowerCase(),
  ),
);
const colours = (svg: string) => [...svg.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());

test("the mark, the lockup and the icons draw only with the system's colours", () => {
  const all = [16, 24, 32, 64, 512].flatMap((size) =>
    (["light", "dark", "auto"] as const).flatMap((on) => [markSvg({ size, on }), iconSvg({ size, on: on === "auto" ? "light" : on })]),
  );
  all.push(lockupSvg({ on: "light" }), lockupSvg({ on: "dark" }));
  for (const svg of all) {
    expect(colours(svg).length, svg).toBeGreaterThan(1);
    expect(
      colours(svg).filter((c) => !SYSTEM_COLOURS.has(c)),
      svg,
    ).toEqual([]);
    // no gradients, no glow
    expect(svg).not.toMatch(/gradient|filter|blur|opacity/i);
  }
  // the outline in ink 12 on paper, light ink on dark, the square always you-fill
  expect(markSvg({ size: 32, on: "light" })).toContain(SYSTEM.ink.day[11]);
  expect(markSvg({ size: 32, on: "dark" })).toContain(SYSTEM.ink.night[11]);
  expect(markSvg({ size: 32, on: "dark" })).toContain(SYSTEM.state.day.youFill);
});

test("two equal squares, the orange lifted up and right by just under half a square", () => {
  for (const size of [16, 20, 24, 28, 32, 64, 512]) {
    const p = markParts(size);
    expect(p.side + p.lift, String(size)).toBeCloseTo(size, 6);
    expect(p.lift / p.side, String(size)).toBeGreaterThan(0.4);
    expect(p.lift / p.side, String(size)).toBeLessThan(0.5);
  }
});

test("it holds at 16px: the outline at least 1.5px, thicker for its size than at 28px", () => {
  expect(markParts(16).stroke).toBeGreaterThanOrEqual(1.5);
  expect(markSvg({ size: 16, on: "light" })).toContain(`stroke-width="${markParts(16).stroke}"`);
  expect(markParts(28).stroke).toBe(2);
  expect(markParts(16).stroke / 16).toBeGreaterThan(markParts(28).stroke / 28);
});

test("at the sizes a screen draws in whole pixels, every edge lands on a pixel", () => {
  for (const size of [16, 20, 24, 28, 32, 48, 64]) {
    const p = markParts(size);
    for (const v of [p.side, p.lift, p.stroke]) expect(Number.isInteger(v), `${size}: ${v}`).toBe(true);
  }
});

test("the files in the repo are what brand.ts draws, pixel for pixel (run `bun run brand` after a change)", () => {
  expect(BRAND_FILES.length).toBeGreaterThan(10);
  for (const f of BRAND_FILES) {
    const path = join(ROOT, f.path);
    expect(existsSync(path), f.path).toBe(true);
    if (!f.png) {
      expect(readFileSync(path, "utf8"), f.path).toBe(f.text);
      continue;
    }
    const got = decodePng(readFileSync(path));
    expect([got.w, got.h], f.path).toEqual([f.png.w, f.png.h]);
    // compared as one buffer: a per-pixel expect over a million pixels would take minutes
    expect(Buffer.from(got.rgba).equals(Buffer.from(rasterise(f.png))), `${f.path}: pixels differ from brand.ts`).toBe(true);
  }
});

test("the rasteriser: whole-pixel edges are solid, a half-covered pixel is half, an outline is hollow, PNGs round-trip", () => {
  const ink = SYSTEM.ink.day[11];
  const px = (d: Parameters<typeof rasterise>[0], x: number, y: number) => [
    ...rasterise(d).subarray((y * d.w + x) * 4, (y * d.w + x) * 4 + 4),
  ];
  const solid = { w: 4, h: 4, shapes: [{ x: 1, y: 1, w: 2, h: 2, fill: ink }] };
  expect(px(solid, 1, 1)).toEqual([11, 11, 12, 255]);
  expect(px(solid, 0, 0)).toEqual([0, 0, 0, 0]);
  expect(px({ w: 2, h: 1, shapes: [{ x: 0, y: 0, w: 1.5, h: 1, fill: ink }] }, 1, 0)[3]).toBe(128);
  const frame = { w: 6, h: 6, shapes: [{ x: 0, y: 0, w: 6, h: 6, fill: ink, stroke: 2 }] };
  expect(px(frame, 1, 1)[3]).toBe(255);
  expect(px(frame, 3, 3)[3]).toBe(0);
  const round = { w: 8, h: 8, shapes: [{ x: 0, y: 0, w: 8, h: 8, fill: ink, r: 4 }] };
  expect(px(round, 0, 0)[3]).toBeLessThan(80);
  expect(px(round, 4, 4)[3]).toBe(255);
  const rgba = rasterise(round);
  expect(decodePng(encodePng(8, 8, rgba)).rgba).toEqual(rgba);
});
