/**
 * The design system's one source: every colour, face, size, radius and timing the dashboard and the public site draw
 * with. systemCss() writes it as custom properties (system.css, by build-css.ts); the CSS only ever reads `var(--…)`.
 * test/one-source.test.ts fails on a literal anywhere else. See docs/design-system.md.
 */

/** A state's colours: `you` is text on the page, `youFill` the fill, `youInk` the text on that fill. */
export interface State {
  you: string;
  youFill: string;
  youInk: string;
  ok: string;
  bad: string;
  destructive: string;
}

/** Surfaces the dashboard's house chrome and the site's panes draw with: solid paper at rest, frosted glass afloat. */
export interface Surface {
  pane: string;
  glass: string;
  glassHi: string;
  glassEdge: string;
  glassLift: string;
  hair: string;
}

/** The single source of every design value. */
export const SYSTEM = {
  ink: {
    /** Neutral grey by night: a near-black, 1–12 (app background → high-contrast text). */
    night: [
      "#0a0a0b", // 1 app background
      "#0f0f10", // 2 subtle background
      "#141416", // 3 card
      "#1a1a1c", // 4 hover, popover
      "#202023", // 5 selected
      "#252528", // 6 subtle border
      "#2a2a2d", // 7 border
      "#3e3e41", // 8 strong border
      "#6b6b6d", // 9 solid, muted
      "#9a9a9d", // 10 muted text
      "#c4c4c7", // 11 low-contrast text
      "#f4f4f5", // 12 high-contrast text
    ],
    /** Neutral grey by day: off-white paper, near-black ink for text. */
    day: [
      "#fafafa", // 1 app background
      "#f5f5f5", // 2 subtle background
      "#ffffff", // 3 card
      "#f1f1f2", // 4 hover
      "#ececee", // 5 selected
      "#e9e9eb", // 6 subtle border
      "#e4e4e7", // 7 border
      "#c9c9cc", // 8 strong border
      "#8e8e91", // 9 solid, muted
      "#6b6b6e", // 10 muted text
      "#3f3f42", // 11 low-contrast text
      "#0b0b0c", // 12 high-contrast text
    ],
  },
  state: {
    day: { you: "#a8390a", youFill: "#ff5a1f", youInk: "#0b0b0c", ok: "#24653f", bad: "#a0153e", destructive: "#a0153e" },
    night: { you: "#ff5a1f", youFill: "#ff5a1f", youInk: "#0a0a0b", ok: "#6cc490", bad: "#f2557a", destructive: "#a0153e" },
  },
  surface: {
    day: {
      pane: "#f7f7f8",
      glass: "rgb(238 238 239 / 0.74)",
      glassHi: "rgb(249 249 250 / 0.88)",
      glassEdge: "rgb(255 255 255 / 0.85)",
      glassLift: "inset 0 1px 0 rgb(255 255 255 / 0.9), 0 16px 34px -24px rgb(11 11 12 / 0.24), 0 4px 10px -8px rgb(11 11 12 / 0.16)",
      hair: "color-mix(in srgb, var(--ink-12) 8%, transparent)",
    },
    night: {
      pane: "#131315",
      glass: "rgb(20 20 22 / 0.64)",
      glassHi: "rgb(27 27 29 / 0.84)",
      glassEdge: "rgb(244 244 245 / 0.07)",
      glassLift: "inset 0 1px 0 rgb(244 244 245 / 0.06), 0 16px 34px -24px rgb(0 0 0 / 0.65)",
      hair: "color-mix(in srgb, var(--ink-12) 8%, transparent)",
    },
    /** The fills and shadows the site's controls and cards use by day (named by what they are). */
    site: {
      white: "#fff",
      shadowPill: "0 6px 14px -10px rgb(11 11 12 / 0.35)",
      shadowPillDark: "0 10px 22px -12px rgb(11 11 12 / 0.6)",
      shadowBar: "inset 0 1px 0 rgb(255 255 255 / 0.7), 0 0 0 1px var(--hair), 0 12px 28px -22px rgb(11 11 12 / 0.35)",
    },
    /** The same by night, the site on a dark computer: a card is night's card step, shadows go black, hairlines light. */
    siteNight: {
      white: "var(--ink-3)",
      shadowPill: "0 6px 14px -10px rgb(0 0 0 / 0.6)",
      shadowPillDark: "0 10px 22px -12px rgb(0 0 0 / 0.7)",
      shadowBar: "inset 0 1px 0 rgb(244 244 245 / 0.06), 0 0 0 1px var(--hair), 0 12px 28px -22px rgb(0 0 0 / 0.6)",
      frame: "0 0 0 1px rgb(244 244 245 / 0.1), 0 32px 80px -40px rgb(0 0 0 / 0.7), 0 8px 20px -12px rgb(0 0 0 / 0.5)",
      liftRing: "0 0 0 1px rgb(244 244 245 / 0.1), 0 6px 14px -8px rgb(0 0 0 / 0.5)",
    },
  },
  font: {
    /** The two families by name (Atkinson Hyperlegible, SIL OFL 1.1): the shots font check and every canvas read these. */
    name: { body: "Atkinson Hyperlegible Next", mono: "Atkinson Hyperlegible Mono" },
    body: '"Atkinson Hyperlegible Next", ui-sans-serif, system-ui, sans-serif',
    mono: '"Atkinson Hyperlegible Mono", ui-monospace, Menlo, monospace',
    /** The stylesheet that loads both, bundled with the dashboard, relative to the page. */
    href: "fonts/instrument.css",
  },
  type: {
    display: { size: "clamp(40px, 5.2vw, 76px)", line: "0.98", weight: 700, track: "-0.03em" },
    h2: { size: "clamp(30px, 3.4vw, 48px)", line: "1", weight: 700, track: "-0.025em" },
    h3: { size: "clamp(20px, 1.7vw, 24px)", line: "1.1", weight: 600, track: "-0.015em" },
    body: { size: "17px", line: "1.55", weight: 400, track: "0" },
    small: { size: "15px", line: "1.5", weight: 400, track: "0" },
    mono: { size: "13px", line: "1.3", weight: 500, track: "0" },
  },
  /** pane, site and control are the three shapes; the rest are today's smaller corners, named so CSS only reads them. */
  radius: {
    pane: "20px",
    site: "14px",
    control: "999px",
    chip: "8px",
    tick: "1px",
    dot: "2px",
    inset: "10px",
    tile: "12px",
    card: "16px",
    piece: "22px",
  },
  /** CSS px on the 4px grid: one gap between panes, and a pane's padding on a computer and on a phone. */
  space: {
    gap: 24,
    pane: 22,
    panePhone: 18,
  },
  /** Milliseconds, except `rise` (a distance in px, as a number), `dim`, `lift` and `zoom` (plain numbers) and the three easings. */
  motion: {
    instant: 120,
    base: 240,
    slow: 480,
    stagger: 50,
    loop: 1600,
    /** The loader's one cycle: your square slides over the work and back (the only loader, while the app starts). */
    handover: 1800,
    rise: 6,
    /** How long a live piece's one focus holds (the site's pages) before it settles and stays still. */
    hold: 2400,
    /** While a piece's focus holds: the opacity the rest dims to, and how much the card that matters grows. */
    dim: 0.5,
    lift: 1.015,
    /** How far the home page's live window zooms toward Needs you as it scrolls away. */
    zoom: 1.12,
    arrive: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    leave: "cubic-bezier(0.4, 0, 1, 1)",
    spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  },
  /** What frosted glass blurs behind it: the dashboard's floating surfaces and the site's bar. */
  glassBlur: "blur(16px) saturate(1.3)",
  /** The one soft shadow round the product window, on the site's day paper (night: surface.siteNight): a hairline and a long, quiet lift. */
  frame: "0 0 0 1px rgb(11 11 12 / 0.08), 0 32px 80px -40px rgb(11 11 12 / 0.32), 0 8px 20px -12px rgb(11 11 12 / 0.12)",
  /** The ring a live piece's lifted card wears: the frame's hairline and a short, tight lift that stays inside the piece's pane. */
  liftRing: "0 0 0 1px rgb(11 11 12 / 0.08), 0 6px 14px -8px rgb(11 11 12 / 0.24)",
} as const;

const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const decls = (pairs: readonly (readonly [string, string | number])[]): string[] => pairs.map(([k, v]) => `  --${k}: ${v};`);
const stateVars = (s: State) => decls(Object.entries(s).map(([k, v]) => [kebab(k), v] as const));
const surfaceVars = (s: Surface) => decls(Object.entries(s).map(([k, v]) => [kebab(k), v] as const));

/** Night's ink and state colours, as declarations. */
const nightInk = (): string[] => [
  "  color-scheme: dark;",
  ...decls(SYSTEM.ink.night.map((c, i) => [`ink-${i + 1}`, c] as const)),
  ...stateVars(SYSTEM.state.night),
];

/**
 * The system for a page with no script to set `data-appearance` (the relay's own pages and the public site): day by
 * default, night when the browser prefers dark, the same values the dashboard's dark appearance reads, plus the
 * site's night fills and shadows.
 */
export function systemSchemeCss(): string {
  return [
    systemCss(),
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    ...nightInk(),
    ...surfaceVars(SYSTEM.surface.night),
    ...decls(Object.entries(SYSTEM.surface.siteNight).map(([k, v]) => [kebab(k), v] as const)),
    "  }",
    "}",
    "",
  ].join("\n");
}

/** The system as CSS custom properties: the file packages/themes/system.css, imported by the dashboard and copied to the site. */
export function systemCss(): string {
  const { ink, state, surface, font, type, radius, motion, space } = SYSTEM;
  return [
    "/* written by packages/themes/build-css.ts from packages/themes/src/system.ts: edit that, not this file */",
    ":root, .paper {",
    "  color-scheme: light;",
    ...decls(ink.day.map((c, i) => [`ink-${i + 1}`, c] as const)),
    ...stateVars(state.day),
    ...decls([
      ["font-body", font.body],
      ["font-mono", font.mono],
    ]),
    ...Object.entries(type).flatMap(([name, t]) =>
      decls([
        [`t-${name}-size`, t.size],
        [`t-${name}-line`, t.line],
        [`t-${name}-weight`, t.weight],
        [`t-${name}-track`, t.track],
      ]),
    ),
    ...decls(Object.entries(radius).map(([k, v]) => [`radius-${k}`, v] as const)),
    ...decls(Object.entries(space).map(([k, v]) => [`space-${kebab(k)}`, `${v}px`] as const)),
    ...decls([
      ["m-instant", `${motion.instant}ms`],
      ["m-base", `${motion.base}ms`],
      ["m-slow", `${motion.slow}ms`],
      ["m-stagger", `${motion.stagger}ms`],
      ["m-loop", `${motion.loop}ms`],
      ["m-handover", `${motion.handover}ms`],
      ["m-arrive", motion.arrive],
      ["m-leave", motion.leave],
      ["m-spring", motion.spring],
      ["m-rise", `${motion.rise}px`],
      ["m-hold", `${motion.hold}ms`],
      ["m-dim", motion.dim],
      ["m-lift", motion.lift],
      ["m-zoom", motion.zoom],
      ["frame", SYSTEM.frame],
      ["lift-ring", SYSTEM.liftRing],
      ["glass-blur", SYSTEM.glassBlur],
    ]),
    ...surfaceVars(surface.day),
    ...decls(Object.entries(surface.site).map(([k, v]) => [kebab(k), v] as const)),
    "}",
    ':root[data-appearance="dark"], .ink {',
    ...nightInk(),
    "}",
    // the site's .ink panels keep today's light surfaces; only the dashboard's dark appearance turns them dark
    ':root[data-appearance="dark"] {',
    ...surfaceVars(surface.night),
    "}",
    "",
  ].join("\n");
}
