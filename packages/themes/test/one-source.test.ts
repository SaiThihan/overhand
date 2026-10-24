import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SYSTEM } from "../src/system";

/**
 * One source of truth: every design value lives in src/system.ts, and the dashboard's and the site's CSS only read
 * `var(--…)`. This walks both surfaces and fails, naming file and line, on a colour, an easing, a duration or a
 * font face or a radius written out anywhere else.
 */
const ROOT = join(import.meta.dir, "../../..");

const GLOBS = [
  "apps/web/src/**/*.{css,tsx}",
  "apps/design/src/**/*.{css,tsx,ts}",
  "apps/design/index.html",
  "site/public/site.css",
  "site/pages/**/*.html",
  "site/get/**/*.html",
  // the relay's pages and the site's build write CSS and markup inside template strings
  "relay/src/**/*.ts",
  "site/build.ts",
];
/** TypeScript files whose template strings are CSS: checked for radii, durations and font faces like a stylesheet. */
const CSS_IN_TS = /^(?:relay\/src\/.*|site\/build)\.ts$/;

/** Files allowed to hold literals, each with its one-line reason. Expected near-empty by the end of Task 4. */
const ALLOW: Record<string, string> = {
  "apps/web/src/map/map.css": "the central section keeps its art (owner 2026-10-22)",
  "apps/web/src/map/AttentionMap.tsx": "the central section keeps its art (owner 2026-10-22)",
  "apps/web/src/map/worlds/instrument.tsx": "the central section keeps its art (owner 2026-10-22)",
};
/** Path prefixes allowed too: the hidden worlds' art stays until they return. */
const ALLOW_PREFIX: Record<string, string> = {
  "apps/web/src/map/worlds/koi.tsx": "hidden world",
  "apps/web/src/map/worlds/catnap.tsx": "hidden world",
  "apps/web/src/map/worlds/observatory.tsx": "hidden world",
  "apps/web/src/map/worlds/transit.tsx": "hidden world",
};
/** CSS rules allowed to hold literals, by selector: the hidden worlds and Catnap, which keep their own chrome. */
const ALLOW_SELECTOR = /\[data-theme="(?:catnap|observatory|transit|koi)"\]/;
/** The worlds still hidden: the only ones whose CSS may write a blur out. */
const HIDDEN = /\[data-theme="(?:observatory|transit|koi)"\]/;

const COLOUR = /(?<![&\w])#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
const EASING = /cubic-bezier\(/;
const DURATION = /(?<![\w.-])(?:\d*\.\d+|\d+)m?s\b/g;
/** A radius written out: any length other than 0 (`inherit` and `var(--radius-…)` pass). */
const RADIUS = /(?<![\w-])border(?:-[a-z]+)*-radius\s*:\s*([^;}"]*)/g;
const LENGTH = /(?<![\w.-])(?:\d*\.\d+|\d+)(?:px|rem|em|%)/g;
const FACE = /["']|\b(?:sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-monospace|Geist|Menlo|Inter|Arial|Helvetica)\b/;

/** Line numbers (1-based) inside a CSS rule whose selector matches `allow`. */
function allowedLines(src: string, allow = ALLOW_SELECTOR): Set<number> {
  const out = new Set<number>();
  const stack: { allowed: boolean }[] = [];
  let line = 1;
  let head = "";
  for (const ch of src) {
    if (ch === "\n") line++;
    if (ch === "{") {
      stack.push({ allowed: allow.test(head.replace(/\/\*[\s\S]*?\*\//g, "")) || (stack.at(-1)?.allowed ?? false) });
      head = "";
    } else if (ch === "}") {
      stack.pop();
      head = "";
    } else if (ch === ";") head = "";
    else head += ch;
    if (stack.at(-1)?.allowed) out.add(line);
  }
  return out;
}

/** Every literal in a file, as `file:line  text`. */
function findings(file: string, src: string): string[] {
  const isCss = file.endsWith(".css") || file.endsWith(".html") || CSS_IN_TS.test(file);
  const skip = file.endsWith(".css") ? allowedLines(src) : new Set<number>();
  const lineAt = (i: number) => src.slice(0, i).split("\n").length;
  const out: string[] = [];
  const add = (line: number, why: string) => {
    if (!skip.has(line)) out.push(`${file}:${line}  ${why}: ${src.split("\n")[line - 1]?.trim().slice(0, 100)}`);
  };
  src.split("\n").forEach((text, i) => {
    if (COLOUR.test(text)) add(i + 1, "colour");
    if (EASING.test(text)) add(i + 1, "easing");
  });
  if (isCss) {
    for (const m of src.matchAll(/(?:transition|animation)[\w-]*\s*:[^;{}]*/g)) {
      // 0s and 0.01ms are reduced motion's "no time at all", not a design value
      const times = (m[0].match(DURATION) ?? []).filter((t) => t !== "0s" && t !== "0.01ms");
      if (times.length) add(lineAt(m.index ?? 0), `duration ${times.join(" ")}`);
    }
    for (const m of src.matchAll(RADIUS)) {
      const lengths = (m[1] ?? "").replace(/var\([^)]*\)/g, "").match(LENGTH) ?? [];
      if (lengths.length) add(lineAt(m.index ?? 0), `radius ${lengths.join(" ")}`);
    }
    for (const m of src.matchAll(/(?:font-family\s*:|(?<![\w-])font\s*:)\s*([^;}]*)/g)) {
      if (FACE.test(m[1] ?? "")) add(lineAt(m.index ?? 0), "font face");
    }
  }
  return out;
}

test("no design value is written outside packages/themes", () => {
  const files = GLOBS.flatMap((g) => [...new Bun.Glob(g).scanSync({ cwd: ROOT })]).sort();
  expect(files.length).toBeGreaterThan(20);
  const found = files
    .filter((f) => !(f in ALLOW) && !Object.keys(ALLOW_PREFIX).some((p) => f.startsWith(p)))
    .flatMap((f) => findings(f, readFileSync(join(ROOT, f), "utf8")));
  expect(found).toEqual([]);
});

test("every allowance says why", () => {
  for (const [f, why] of [...Object.entries(ALLOW), ...Object.entries(ALLOW_PREFIX)]) expect(why.length, f).toBeGreaterThan(5);
});

test("the guard catches what it should", () => {
  expect(findings("x.css", "a { color: #fff; }")).toHaveLength(1);
  expect(findings("x.css", "a { transition: transform .2s ease; }")).toHaveLength(1);
  expect(findings("x.css", "a {\n  transition:\n    color 120ms;\n}")).toHaveLength(1);
  expect(findings("x.css", "a { animation: m var(--m-base) cubic-bezier(0,0,1,1); }")).toHaveLength(1);
  expect(findings("x.css", 'a { font: 600 1rem "Geist"; }')).toHaveLength(1);
  expect(findings("x.css", 'a[data-theme="koi"] { color: #fff; }')).toHaveLength(0);
  // the HUD's classes have no allowance of their own any more
  expect(findings("x.css", ".hud-pane { color: #fff; }")).toHaveLength(1);
  expect(findings("x.css", "a { color: var(--ink-1); font: 600 1rem var(--font-body); transition: color var(--m-base); }")).toHaveLength(0);
  expect(findings("x.html", "<p>&#8212; a</p>")).toHaveLength(0);
  expect(findings("x.css", "a { border-radius: 999px; }")).toHaveLength(1);
  expect(findings("x.css", "a { border-top-left-radius: 50%; }")).toHaveLength(1);
  expect(findings("x.css", "a { border-radius: 1rem !important; }")).toHaveLength(1);
  expect(findings("x.css", "a { border-start-end-radius: calc(var(--radius-pane) - 2px); }")).toHaveLength(1);
  expect(findings("x.css", "a { border-radius: var(--radius-control); }")).toHaveLength(0);
  expect(findings("x.css", "a { border-radius: 0; border-end-end-radius: inherit; }")).toHaveLength(0);
  // a relay page's CSS in a template string counts as CSS
  expect(findings("relay/src/x.ts", "const css = `button{border-radius:8px;font:15px system-ui}`;")).toHaveLength(2);
  expect(findings("relay/src/x.ts", "const css = `a{color:#2253c4}`;")).toHaveLength(1);
});

const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const scan = (g: string) => [...new Bun.Glob(g).scanSync({ cwd: ROOT })].sort();

/** Every backdrop-filter that writes a blur out (not `none`, not one `var(--…)`) outside a hidden world's rule. */
function blurs(file: string, src: string): string[] {
  const skip = allowedLines(src, HIDDEN);
  return src
    .split("\n")
    .flatMap((text, i) =>
      /backdrop-filter\s*:(?!\s*(?:none|var\(--[\w-]+\))\s*[;}])/.test(text) && !skip.has(i + 1)
        ? [`${file}:${i + 1}  ${text.trim()}`]
        : [],
    );
}

test("backdrop-filter reads a system token outside hidden worlds", () => {
  const found = [...scan("apps/web/src/**/*.css"), "site/public/site.css"].flatMap((f) => blurs(f, read(f)));
  expect(found).toEqual([]);
});

test("the blur guard catches what it should", () => {
  expect(blurs("x.css", "a { backdrop-filter: blur(4px); }")).toHaveLength(1);
  expect(blurs("x.css", "a { backdrop-filter: none; }")).toHaveLength(0);
  expect(blurs("x.css", "a { backdrop-filter: var(--glass-blur); }")).toHaveLength(0);
  expect(blurs("x.css", ':root[data-theme="koi"] {\n  a {\n    backdrop-filter: blur(4px);\n  }\n}')).toHaveLength(0);
});

test("nothing calls sweep, and motion only plays when something real happens", () => {
  const code = scan("apps/web/src/**/*.{ts,tsx,css}").filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
  const hits = (re: RegExp) => code.filter((f) => re.test(read(f)));
  expect(hits(/\bsweep\(/)).toEqual([]);
  expect(read("apps/web/src/lib/motion.ts")).not.toMatch(/export function (?:sweep|useBreath)\b/);
  // the horizon, its amber breath and the scan line are gone; Setup's scan shows the one loader (Boot, the mark)
  expect(hits(/\bhorizon\b|--breath\b|\bm-sweep\b|\bm-scan\b/)).toEqual([]);
});

test("every surface token is read somewhere", () => {
  const css = GLOBS.flatMap(scan).map(read).concat(Object.values(SYSTEM.surface.site)).join("\n");
  const names = [...Object.keys(SYSTEM.surface.day), ...Object.keys(SYSTEM.surface.site)].map((k) =>
    k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
  );
  expect(names.filter((n) => !new RegExp(`var\\(--${n}\\b(?!-)`).test(css))).toEqual([]);
});
