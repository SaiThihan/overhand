import { expect, test } from "bun:test";
import { placeholders, plainWords, TOKEN_KEYS, type Tokens, allWorlds as themes, type WordKey } from "../src/index";
import { SYSTEM } from "../src/system";

const keys = Object.keys(plainWords) as WordKey[];

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

for (const theme of themes) {
  test(`${theme.id}: every word is present, non-empty, and uses only plain English's placeholders`, () => {
    expect(Object.keys(theme.words).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      expect(theme.words[k].trim().length, k).toBeGreaterThan(0);
      const allowed = new Set(placeholders(plainWords[k]));
      for (const p of placeholders(theme.words[k])) expect(allowed.has(p), `${k} uses {${p}}`).toBe(true);
    }
  });

  test(`${theme.id}: every token is set`, () => {
    for (const k of TOKEN_KEYS) expect(theme.tokens[k].length, k).toBeGreaterThan(0);
    expect(theme.lightHues === undefined || theme.lightHues.length === theme.hues.length).toBe(true);
  });

  const sets: [string, Tokens, readonly string[]][] = [["dark", theme.tokens, theme.hues]];
  if (theme.light) sets.push(["light", theme.light, theme.lightHues ?? theme.hues]);
  for (const [mode, t, hues] of sets)
    test(`${theme.id} ${mode}: text colours reach WCAG AA (4.5:1)`, () => {
      const pairs: [string, string, string][] = [
        ["foreground", t.foreground, t.background],
        ["muted-foreground", t["muted-foreground"], t.background],
        ["muted-foreground on card", t["muted-foreground"], t.card],
        ["primary", t.primary, t.background],
        ["primary-foreground", t["primary-foreground"], t.primary],
        ["accent-foreground", t["accent-foreground"], t.accent],
        ["popover-foreground", t["popover-foreground"], t.popover],
        ["white on destructive", "#ffffff", t.destructive],
        ["ok", t.ok, t.card],
        ["warn", t.warn, t.card],
        ["bad", t.bad, t.card],
        ...hues.map((h): [string, string, string] => [`hue ${h}`, h, t.card]),
        ...hues.map((h): [string, string, string] => [`hue ${h} on background`, h, t.background]),
      ];
      for (const [name, fg, bg] of pairs) expect(contrast(fg, bg), `${theme.id} ${mode} ${name}`).toBeGreaterThanOrEqual(4.5);
    });

  const inks: [string, readonly string[] | undefined][] = [
    ["dark", theme.ink],
    ["light", theme.lightInk],
  ];
  for (const [mode, ink] of inks)
    if (ink)
      test(`${theme.id} ${mode}: the ink scale has 12 steps and its text steps reach AA on every surface`, () => {
        expect(ink).toHaveLength(12);
        // text: 10 muted, 11 low, 12 high; surfaces: 1 app, 2 subtle, 3 card, 4 hover, 5 selected
        for (const text of [10, 11, 12])
          for (const surface of [1, 2, 3, 4, 5])
            expect(
              contrast(ink[text - 1] ?? "", ink[surface - 1] ?? ""),
              `${theme.id} ${mode} ink ${text} on ink ${surface}`,
            ).toBeGreaterThanOrEqual(4.5);
        // state colours read on the selected surface too, where a hovered or picked row sits
        const t = mode === "light" ? theme.light : theme.tokens;
        for (const k of ["primary", "warn", "ok", "bad"] as const)
          expect(contrast(t?.[k] ?? "", ink[4] ?? ""), `${theme.id} ${mode} ${k} on ink 5`).toBeGreaterThanOrEqual(4.5);
      });
}

/**
 * Palette A: in a world with an ink scale, every colour token and client hue is an ink step or a state (done, broken,
 * the destructive fill), except one: you. Nothing else may bring its own colour.
 */
for (const theme of themes) {
  const sets: [string, Tokens | undefined, readonly string[] | undefined, readonly string[]][] = [
    ["dark", theme.tokens, theme.ink, theme.hues],
    ["light", theme.light, theme.lightInk, theme.lightHues ?? theme.hues],
  ];
  for (const [mode, t, ink, hues] of sets)
    if (t && ink)
      test(`${theme.id} ${mode}: "you" is the only colour that isn't ink or a state`, () => {
        const lower = (c: string) => c.toLowerCase();
        const allowed = new Set([...ink, t.ok, t.bad, t.destructive].map(lower));
        const you = new Set([t.you, t["you-fill"], t["you-ink"]].map(lower));
        const colours: [string, string][] = [...Object.entries(t), ...hues.map((h, i): [string, string] => [`hue ${i}`, h])];
        const strays = colours.filter(
          ([k, v]) => v.startsWith("#") && !allowed.has(lower(v)) && !(you.has(lower(v)) && /^(you|warn)/.test(k)),
        );
        expect(strays).toEqual([]);
        // the fills a theme draws in: primary and focus are ink, never a second accent
        for (const k of ["primary", "ring"] as const) expect(allowed.has(lower(t[k])), `${k} is ink`).toBe(true);
        // and you is a colour of its own, not an ink step
        expect(allowed.has(lower(t["you-fill"]))).toBe(false);
      });
}

const rgb = (c: string): number[] => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));

test("the ink is neutral: no step leans green or blue by more than 3/255", () => {
  for (const c of [...SYSTEM.ink.day, ...SYSTEM.ink.night]) {
    const v = rgb(c);
    expect(Math.max(...v) - Math.min(...v), c).toBeLessThanOrEqual(3);
  }
});

test("the anchor steps", () => {
  expect([SYSTEM.ink.day[0], SYSTEM.ink.day[2], SYSTEM.ink.day[11]]).toEqual(["#fafafa", "#ffffff", "#0b0b0c"]);
  expect(SYSTEM.state.day.youFill).toBe("#ff5a1f");
});

test("no surface or shadow keeps the old green-grey tint", () => {
  expect(JSON.stringify(SYSTEM.surface)).not.toMatch(/28 48 42|235 240 238|248 250 249|236 241 239|19 26 24/);
});

// projects are named, not coloured, and not toned either: every project name takes the same ink (alternating two greys
// read as a meaning there isn't)
test("Instrument draws every project name in one ink", () => {
  const instrument = themes.find((t) => t.id === "overhand");
  expect(new Set(instrument?.hues).size).toBe(1);
  expect(new Set(instrument?.lightHues).size).toBe(1);
});
