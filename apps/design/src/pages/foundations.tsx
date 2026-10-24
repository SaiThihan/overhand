/**
 * Foundations: the system's values, read live from the page (packages/themes/system.css and the theme ThemeProvider
 * sets), drawn on the dashboard's real surfaces in its real typeface. Nothing here defines a value of its own.
 */
import { iconSvg, MARK_GROUND, markParts, markSvg } from "@overhand/themes";
import { type CSSProperties, type ReactNode, useState, useSyncExternalStore } from "react";
import { Boot } from "@/components/Boot";
import { Mark } from "@/components/Connections";
import { BrandMark, Logo } from "@/components/Logo";
import { Pane } from "@/components/Pane";
import { Button } from "@/components/ui/button";
import { nth, useCountUp } from "@/lib/motion";

/** Re-renders when the theme rewrites the root's tokens (the look toggle), so every value read is the current one. */
function useLook(): string {
  return useSyncExternalStore(
    (f) => {
      const o = new MutationObserver(f);
      o.observe(document.documentElement, { attributes: true });
      return () => o.disconnect();
    },
    () => `${document.documentElement.getAttribute("style")}|${document.documentElement.dataset.appearance}`,
  );
}
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const RULES = [
  [
    "Colour means something",
    'Greys for everything. Orange only for "needs you" and the mark. Green only for a passed check. Crimson only for broken.',
  ],
  [
    "One typeface",
    "Atkinson Hyperlegible Next for every word. Atkinson Hyperlegible Mono only for data: times, numbers, counts, commands.",
  ],
  ["Motion only when something real happens", "A question arrives, a check passes, an agent starts. Nothing moves to decorate."],
  ["No illustrations", "On the site, every image is the live product on sample data. The mark is the only graphic."],
];
const INK = [
  "App background",
  "Subtle background",
  "Card",
  "Hover, popover",
  "Selected, pressed",
  "Subtle border",
  "Border",
  "Strong border",
  "Solid, muted",
  "Muted text",
  "Low-contrast text",
  "Text, primary fill",
];
const STATES = [
  ["--you-fill", "Needs you (fill)", "The count, the answer button, the mark"],
  ["--you", "Needs you (text)", "A question's name, a waiting agent"],
  ["--ok", "Done, passing, merged", "A passed check, a merge"],
  ["--bad", "Broken, failing", "A red check, a crash"],
  ["--destructive", "Stop or remove", "Behind white text, always behind a confirm"],
];
const TYPE: [string, string][] = [
  ["display", "The control room for your coding agents."],
  ["h2", "Only what needs you reaches you."],
  ["h3", "Proof on every pull request"],
  [
    "body",
    "Overhand runs the agents already working on your code, across every project, by your rules, and brings you only the decisions that are yours.",
  ],
  ["small", "Sample projects and people. Nothing here touches anything real."],
];
const RADII = ["control", "pane", "site", "card", "tile", "inset", "chip", "dot"];
const SURFACES = [
  ["--pane", "Resting pane", "Solid paper: every pane on the bridge"],
  ["--glass", "Glass", "The bar and the phone's jump bar, over moving content"],
  ["--glass-hi", "Raised glass", "Popovers, drawers, toasts and controls"],
  ["--hair", "Hairline", "A rule inside a pane"],
];
const MOTION = [
  ["--m-instant", "Hover, press, leave"],
  ["--m-base", "Panels, drawers, list items"],
  ["--m-slow", "Big moments: lock-on, the arrival"],
  ["--m-stagger", "Between items of a list build"],
  ["--m-loop", "Live indicators only"],
  ["--m-handover", "The loader's one cycle, only while the app starts"],
  ["--m-rise", "How far an entering item rises"],
  ["--m-arrive", "Anything entering or settling"],
  ["--m-leave", "Anything leaving"],
  ["--m-spring", "The tick of a lock-on only"],
];

const type = (t: string): CSSProperties => ({
  font: `var(--t-${t}-weight) var(--t-${t}-size)/var(--t-${t}-line) var(--font-body)`,
  letterSpacing: `var(--t-${t}-track)`,
});

function Section({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section className="mt-14 grid gap-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        <p className="mt-1 max-w-[46em] text-muted-foreground">{sub}</p>
      </div>
      {children}
    </section>
  );
}

function Swatch({ v, name, use }: { v: string; name: string; use: string }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
      <div className="h-16 border-b border-border" style={{ background: `var(${v})` }} />
      <div className="grid gap-0.5 px-3 py-2.5 text-sm">
        <span>
          <b>{name}</b> <code className="font-mono text-xs text-muted-foreground">{css(v)}</code>
        </span>
        <small className="text-muted-foreground">{use}</small>
      </div>
    </div>
  );
}

/** Replays a motion by remounting what it animates. */
function Demo({ name, about, children }: { name: string; about: string; children: (n: number) => ReactNode }) {
  const [n, setN] = useState(0);
  return (
    <div className="hud-pane gap-3">
      <b>{name}</b>
      <p className="text-sm text-muted-foreground">{about}</p>
      <div className="grid h-28 place-items-center overflow-hidden rounded-[var(--radius-inset)] border border-border bg-background">
        {children(n)}
      </div>
      <Button variant="outline" size="sm" className="self-start justify-self-start" onClick={() => setN(n + 1)}>
        Replay
      </Button>
    </div>
  );
}

function Count({ to }: { to: number }) {
  return (
    <span data-data className="font-mono text-4xl tabular-nums">
      {Math.round(useCountUp(to))}
    </span>
  );
}

/** A brand file as brand.ts draws it, shown as an image: what the favicons and icons are. */
const svgSrc = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
const GROUNDS = [
  ["light", "On paper"],
  ["dark", "On dark"],
] as const;
const DOS = [
  "Two equal squares, you lifted up and right by just under half a square, as drawn.",
  "The outline in ink 12 on paper, the light ink on dark; the square always signal orange.",
  "One lift of clear space all round; nothing closer.",
  "At 24px and under, the small master (the 16px drawing): its outline is thicker so it holds.",
];
const DONTS = [
  "Recolour either square, or use the orange anywhere else as decoration.",
  "Add a gradient, glow, shadow, rounding or a third square.",
  "Change the lift, rotate it or fill the work square.",
  "Animate it outside the loader, or use the loader for a pane: panes draw skeletons.",
];

/** The brand: the mark, the lockup and their rules, every file drawn live from packages/themes/src/brand.ts. */
function Brand() {
  const lift = markParts(48).lift;
  return (
    <Section
      title="The mark"
      sub="Hand over: the work, an outline square in ink, and you, the signal-orange square lifted over it. The orange already means needs you; here it is you, standing over the work."
    >
      <div className="grid gap-(--space-gap)">
        <div className="grid gap-(--space-gap) lg:grid-cols-2">
          <div className="grid grid-cols-2 content-start gap-3">
            {GROUNDS.map(([on, name]) => (
              <figure key={on} className="grid gap-2">
                <div
                  className="grid h-48 place-items-center rounded-[var(--radius-card)] border border-border"
                  style={{ background: MARK_GROUND[on] }}
                >
                  <img alt={`The mark, ${name.toLowerCase()}`} src={svgSrc(markSvg({ size: 96, on }))} width={96} height={96} />
                </div>
                <figcaption className="text-sm text-muted-foreground">{name}</figcaption>
              </figure>
            ))}
          </div>
          <div className="hud-pane gap-4">
            <b>Lockup</b>
            <p className="text-sm text-muted-foreground">
              The mark, then Overhand in Atkinson Hyperlegible Next Bold, tracking -0.02em. The work square is one cap height and stands on
              the baseline, so you rise above the letters. The gap and the clear space are one lift.
            </p>
            <div className="justify-self-start outline-1 outline-border outline-dashed" style={{ padding: lift }}>
              <Logo size={48} />
            </div>
            <div className="flex flex-wrap items-end gap-6">
              <Logo size={28} />
              <Logo size={20} />
            </div>
          </div>
        </div>
        <div className="grid gap-(--space-gap) sm:grid-cols-2 xl:grid-cols-4">
          <div className="hud-pane gap-3">
            <b>Smallest size: 16px</b>
            <p className="text-sm text-muted-foreground">
              The favicon. Drawn on a 16-pixel grid: each square 11, the lift 5, the outline 2.
            </p>
            <div className="flex items-end gap-4">
              {[16, 20, 24, 32].map((size) => (
                <span key={size} className="grid justify-items-center gap-1 text-xs text-muted-foreground">
                  <BrandMark size={size} />
                  <code className="font-mono">{size}</code>
                </span>
              ))}
            </div>
          </div>
          <div className="hud-pane gap-3">
            <b>Favicon</b>
            <p className="text-sm text-muted-foreground">
              SVG that follows the browser's light or dark; a 32px PNG on its paper tile where SVG isn't read.
            </p>
            <div className="flex items-center gap-4">
              <img alt="The favicon" src={svgSrc(markSvg({ size: 16, on: "auto" }))} width={16} height={16} />
              <img
                alt="The PNG favicon"
                src={svgSrc(iconSvg({ size: 32, on: "light", mark: 0.75, radius: 0.1875 }))}
                width={32}
                height={32}
              />
            </div>
          </div>
          <div className="hud-pane gap-3">
            <b>App icon</b>
            <p className="text-sm text-muted-foreground">
              The phone's home screen (it rounds the corners itself) and macOS, light and dark.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {GROUNDS.map(([on, name]) => (
                <img
                  key={on}
                  alt={`The phone icon, ${name.toLowerCase()}`}
                  src={svgSrc(iconSvg({ size: 180, on }))}
                  width={56}
                  height={56}
                  className="rounded-[var(--radius-tile)]"
                />
              ))}
              {GROUNDS.map(([on, name]) => (
                <img
                  key={on}
                  alt={`The macOS icon, ${name.toLowerCase()}`}
                  src={svgSrc(iconSvg({ size: 1024, on, inset: 100, radius: 0.2245 }))}
                  width={64}
                  height={64}
                />
              ))}
            </div>
          </div>
          <div className="hud-pane gap-3">
            <b>Colours</b>
            <p className="text-sm text-muted-foreground">
              Ink 12 for the work (the light ink on dark), you-fill for you. No other colour, ever.
            </p>
            <div className="flex gap-3">
              {["--ink-12", "--you-fill"].map((v) => (
                <span key={v} className="grid gap-1 text-xs">
                  <span className="size-10 rounded-[var(--radius-chip)] border border-border" style={{ background: `var(${v})` }} />
                  <code className="font-mono">{css(v)}</code>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="grid gap-(--space-gap) lg:grid-cols-[1fr_2fr]">
          <div className="hud-pane gap-3">
            <b>The loader</b>
            <p className="text-sm text-muted-foreground">
              Only while the whole app is starting or connecting: the first load, reaching your computer from the phone, Setup's scan. Your
              square slides over the work and back on the arrive curve. With reduced motion it's the still mark and the words. Every pane
              that loads draws skeletons instead.
            </p>
            <div className="rounded-[var(--radius-inset)] border border-border bg-background">
              <Boot ready={false} label="Starting…" className="min-h-40" />
            </div>
          </div>
          <div className="grid gap-(--space-gap) sm:grid-cols-2">
            <div className="hud-pane gap-2">
              <b>Do</b>
              <ul className="grid list-disc gap-1.5 pl-5 text-sm">
                {DOS.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
            <div className="hud-pane gap-2">
              <b>Don't</b>
              <ul className="grid list-disc gap-1.5 pl-5 text-sm">
                {DONTS.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

/** The foundations page. */
export function Foundations() {
  useLook();
  return (
    <article>
      <h1 className="max-w-[16em]" style={type("display")}>
        One system for overhand.dev and Overhand.
      </h1>
      <p className="mt-4 max-w-[38em] text-muted-foreground">
        Every value on this page is read from the single source. Change a value in <code className="font-mono text-sm">system.ts</code>, run{" "}
        <code className="font-mono text-sm">bun run build:css</code>, reload, and this page, overhand.dev and Overhand itself all change
        together. A test fails if a colour, face, radius or timing is written anywhere else.
      </p>

      <Section title="Four rules" sub="Everything below follows from these.">
        <div className="grid gap-(--space-gap) sm:grid-cols-2 xl:grid-cols-4">
          {RULES.map(([t, p]) => (
            <div key={t} className="hud-pane gap-1.5">
              <b>{t}</b>
              <p className="text-sm text-muted-foreground">{p}</p>
            </div>
          ))}
        </div>
      </Section>

      <Brand />

      <Section title="Ink" sub="Twelve steps, one role each. Surfaces, borders and text are always a step, never a grey of their own.">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {INK.map((role, i) => (
            <Swatch key={role} v={`--ink-${i + 1}`} name={String(i + 1)} use={role} />
          ))}
        </div>
      </Section>

      <Section title="State colours" sub="The only colours that aren't ink. Each means one thing, everywhere.">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {STATES.map(([v = "", name = "", use = ""]) => (
            <Swatch key={v} v={v} name={name} use={use} />
          ))}
        </div>
      </Section>

      <Section title="Type" sub="One family; weight, size and tracking make the hierarchy. Sentence case, no letter-spaced labels.">
        <div className="grid">
          {TYPE.map(([t, text]) => (
            <div key={t} className="grid gap-1.5 border-t border-border py-4 sm:grid-cols-[10rem_1fr] sm:items-baseline sm:gap-4">
              <code className="font-mono text-xs text-muted-foreground">
                {t} {css(`--t-${t}-size`)} / {css(`--t-${t}-weight`)}
              </code>
              <span style={type(t)}>{text}</span>
            </div>
          ))}
          <div className="grid gap-1.5 border-y border-border py-4 sm:grid-cols-[10rem_1fr] sm:items-baseline sm:gap-4">
            <code className="font-mono text-xs text-muted-foreground">
              mono {css("--t-mono-size")} / {css("--t-mono-weight")}
            </code>
            <code className="font-mono tabular-nums" style={type("mono")}>
              07:24 · BOOK-88 · €3.40 of €10
            </code>
          </div>
        </div>
      </Section>

      <Section title="Shape" sub="Controls are pills. Panes are rounded. Counts are square.">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
          {RADII.map((r) => (
            <div key={r} className="grid gap-2">
              <div className="h-16 border border-border bg-muted" style={{ borderRadius: `var(--radius-${r})` }} />
              <code className="font-mono text-xs">
                {r} · {css(`--radius-${r}`)}
              </code>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Surfaces"
        sub="Resting panes are solid paper with a white edge and a soft lift. Only what floats over content is frosted glass: the bar, popovers, drawers and toasts."
      >
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Pane title="paneAlerts" count={1} countTone="var(--you-fill)">
            <p className="text-sm">Merge Booking app's booking fix?</p>
            <p className="mt-1 text-sm text-muted-foreground">Tests and before-and-after screenshots passed. The agent recommends merge.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="answer" size="sm">
                Merge
              </Button>
              <Button variant="outline" size="sm">
                See proof
              </Button>
            </div>
          </Pane>
          <div className="relative overflow-hidden rounded-[var(--radius-pane)] border border-border p-4">
            <div aria-hidden="true" className="grid gap-1 text-sm text-muted-foreground">
              {INK.map((role, i) => (
                <p key={role} style={{ color: `var(--ink-${12 - i})` }}>
                  {role} · {role} · {role}
                </p>
              ))}
            </div>
            {/* drawn by the product's own popover rule (index.css), not a copy: the glass a popover, a menu or a toast floats on */}
            <div data-slot="popover-content" className="absolute inset-x-6 top-8 grid gap-1 p-4 text-sm">
              <b>Frosted glass</b>
              <span className="text-muted-foreground">What floats over content: it blurs what's behind, so text on it stays legible.</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {SURFACES.map(([v = "", name = "", use = ""]) => (
            <Swatch key={v} v={v} name={name} use={use} />
          ))}
        </div>
      </Section>

      <Section title="Motion" sub="Transform and opacity only, on these clocks. With reduced motion on, each one is an instant change.">
        <div className="grid gap-(--space-gap) sm:grid-cols-2 xl:grid-cols-4">
          <Demo name="Enter" about="A pane or list item arrives: fade and a small rise.">
            {(n) => (
              <div key={n} className="m-enter w-4/5 rounded-[var(--radius-tile)] border border-border bg-card px-3 py-2 text-sm">
                Fixed a failing test · Booking app
              </div>
            )}
          </Demo>
          <Demo name="List build" about="Items arrive one after another, a stagger apart.">
            {(n) => (
              <div key={n} className="m-stagger grid w-4/5 gap-1 text-sm">
                {["SHOP-142", "BOOK-88", "WEB-31"].map((k, i) => (
                  <span key={k} style={nth(i)} className="rounded-[var(--radius-inset)] border border-border bg-card px-2 py-0.5 font-mono">
                    {k}
                  </span>
                ))}
              </div>
            )}
          </Demo>
          <Demo name="Lock-on" about="A check passes: a ring contracts, then the tick springs in.">
            {(n) => <Mark key={n} tone="ok" />}
          </Demo>
          <Demo name="Count-up" about="A number climbs to its value when it first appears.">
            {(n) => <Count key={n} to={12} />}
          </Demo>
        </div>
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-2 font-medium">Token</th>
              <th className="py-2 font-medium">Value</th>
              <th className="py-2 font-medium">Use</th>
            </tr>
          </thead>
          <tbody>
            {MOTION.map(([v = "", use]) => (
              <tr key={v} className="border-t border-border align-top">
                <td className="py-2 pr-3">
                  <code className="font-mono text-xs">{v}</code>
                </td>
                <td className="py-2 pr-3">
                  <code className="font-mono text-xs break-all">{css(v)}</code>
                </td>
                <td className="py-2">{use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </article>
  );
}
