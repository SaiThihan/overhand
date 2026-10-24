# One design system for overhand.dev and the dashboard

Status: draft for the owner's approval, 2026-10-22.

## Why

The owner opened overhand.dev and found it "comical", and said it "absolutely does not make sense about the product and
what are we offering". The night-harbour world (houses, a lighthouse, rain, a moon, sample project names lit along the
water) and the scroll story (a clock from 23:30 to 08:30 driven by scrolling) are confusing, and "the product is lost
somewhere in all these storylines". The owner wants a final design system, with motion, assets and animation on the
site and in the product that are "impeccable" with "no useless noise". The references they named are Apple, Tesla, Oura
and the newest design-led startups.

The owner then handed the direction over: "forget my liking … what design system direction would you use to get
maximum adoption". The lead recommended the direction below and the owner accepted it ("ok").

## What it is

**The live product, light, one signal colour.** The first screen says in one line what Overhand is, and the real
dashboard sits right under it. You can click it and try it before installing anything. The site and the dashboard use
one system.

Why this wins adoption (the lead's reasoning, accepted by the owner):

- **Understood in five seconds.** The headline names the category ("The control room for your coding agents") and the
  dashboard under it shows exactly that.
- **Try before install.** The biggest drop-off for a developer tool is having to install something to find out what it
  is. A clickable dashboard on the page removes that. Engineers, product people and designers all get the same proof.
- **It looks like a tool you'd trust with your code.** Apple and Oura sell feelings about hardware. Overhand asks for
  trust in software that touches your repos. Linear, Vercel and Raycast grew on this look: precise, readable, the real
  product. Take their principles only, never their motifs or exact values.
- **One moment of feeling.** Option B's idea (the morning notification, "12 PRs overnight. 1 needs you.") survives as
  the only motion on the first screen: the one thing that needs you arrives in the dashboard.

## Goals

1. A newcomer can say what Overhand is and who it's for within five seconds of landing.
2. A visitor can use the real dashboard on sample data without installing anything.
3. The site and the dashboard read as one product: same colours, type, spacing, controls and motion.
4. Every animation, image and colour on either surface carries a real fact. Nothing is decoration.
5. Impeccable craft: pixel-precise alignment, crisp at 1× and 2×, smooth at 60 fps, correct in light and dark, at phone
   width and at 3200px.

## Non-goals

- Changing what the dashboard does, its places (Now, Work, Crew, Health, Settings) or its words. This is a design pass,
  not a features pass.
- New themes or worlds. They stay hidden until after launch (decided 2026-10-22).
- Paddle, payments and verification. Those happen at the end (owner, 2026-10-22).

## Anti-goals (a failure even if it works)

- Anything that reads as a game, a story or a scene: no illustrated worlds, characters, weather, sky, night-to-morning,
  scroll-scrubbed clocks or narrated timelines.
- Decorative motion: parallax, scroll-linked effects (beyond the live window's one hand-over zoom), ambient loops, floating particles, glowing orbs, gradient blobs,
  gradient text, glows, noise textures.
- "Generic AI website": the centred gradient hero with a glowing mockup and three feature cards with icons.
- Copied motifs or exact values from the reference sites.
- Invented numbers. Every figure on the site comes from the sample data and the page says it is sample data.
- The product shrunk to a thumbnail too small to read.

## The system: four rules

1. **Colour means something.** Everything is a neutral grey from one ink scale. Signal orange means only "needs you"
   (and the brand mark); work in motion is shown by a pulse, not by a colour. Green means only a passed check, done or
   merged. Crimson means only broken. No other colour exists, including for projects.
2. **One typeface.** Geist for every word, Geist Mono only for data: times, numbers, counts, ticket keys, commands.
   Weight and size make the hierarchy. Sentence case, no letter-spaced labels or all caps.
3. **Motion only when something real happens.** A question arrives, a check passes, an agent starts or finishes, a panel
   opens. Nothing moves on its own except "still running" (a slow pulse) and the attention map's slow drift.
4. **No illustrations.** Every image is the real product, rendered from the real dashboard on sample data. The brand mark
   is the only graphic.

### Colour (the lead's call: neutral, not harbour fog)

Today's ink scale is "harbour fog", a cool green-grey, named and tuned for the harbour that is being removed. It becomes
a true neutral, the same 12 steps and roles (docs/design-system.md, "Ink scale"), light and dark, so it reads as a tool
rather than a theme. Starting points for the builder to tune to the AA tests:

| Step | Light | Dark |
| --- | --- | --- |
| 1 (page) | `#fafafa` | `#0a0a0b` |
| 3 (card) | `#ffffff` | `#141416` |
| 7 (border) | `#e4e4e7` | `#2a2a2e` |
| 10 (muted text) | `#6b6b72` | `#9a9aa2` |
| 12 (text, primary fill) | `#0b0b0c` | `#f4f4f5` |

The state colours keep their meanings: `you` orange (`#ff5a1f` fill), `ok` green, `bad` crimson, each tuned to reach AA
on step 5 in both modes. `packages/themes/test/themes.test.ts` (one colour that isn't ink or a state) keeps guarding it.

Light and dark come from the same tokens. **The site follows `prefers-color-scheme`** (owner, 2026-10-23), with no
toggle; `bun run shots` sweeps every site frame in both, with a WCAG AA contrast check. **The dashboard follows the
operating system**, with the existing override in Settings › Look & sound.

### Type

Geist and Geist Mono, self-hosted (already in `apps/web/public/fonts`), on the site too. Newsreader (the story serif)
and any other face on the site are removed (the lead's call: "one typeface"). The `bun run shots` font check extends to
the site.

Site scale (the builder may tune): display 56/60px desktop, 36/40px phone, weight 600, tracking -0.035em; section
headings 32px; body 17–18px, line height 1.5, ink 11; small 13–14px. Reading text stops near 68ch.

### Surfaces, radius, depth

- 4px grid, as today.
- Panes: a surface step and a 1px hairline. On the site, the one framed product window may carry a single soft shadow
  (the frame that holds the dashboard), nothing else.
- Radius (the lead's call): **today's Instrument shapes win** on both surfaces, because they're what the default world
  and the site already draw: every control a pill (`radius-control: 999px` in `house()`,
  `packages/themes/src/overhand/index.ts`), panes rounded (Instrument's 20px in the dashboard; 12–14px for panes and
  the product window on the site). docs/design-system.md's "6px controls" line is the old rule and is corrected when
  the doc is rewritten.
- **The Instrument surfaces stay** (owner, 2026-10-22, on app.overhand.dev's sign-in card: "I kinda liked this frosted
  glass … feel"): resting panes and cards are solid paper with a white edge, an inset top highlight and a soft lift;
  what floats (the bar, the phone's jump bar, popovers, menus, dialogs, toasts, drawers) is frosted glass. All of it
  reads its values from the system tokens, on both surfaces. What goes is the HUD chrome: chamfered panes, lit bevels,
  cut-corner buttons and the scanline veil (`apps/web/src/index.css`, "The HUD"), unless only a hidden world uses it.

### Motion

Keep the existing vocabulary in docs/design-system.md ("Motion": the `--m-*` tokens, enter, leave, list build, lock-on,
count-up, pulse, transform and opacity only, reduced motion as an instant state change). Changes:

- **Remove** what doesn't carry a fact: `sweep()` (the light along the horizon), the horizon's amber breath, `m-scan`
  where nothing is actually being detected, and any glow.
- **Keep the app's central section as it is** (owner, 2026-10-22: "the only motions, animation and art we keep is the
  central section in the app for default and different themes"): the attention map's art and motion in every world,
  including the real-hour sky tint (`apps/web/src/map/hour.ts`, `lightAt`, now in `packages/themes/src/light.ts`). Only the
  site's harbour code goes.
- **Keep** the attention map's slow clock (drift toward you when something waits, a green ring closing on a merge) but
  draw it in the new palette with no glow or halo beyond the existing soft one on your count.
- **On the site**, four motions only:
  1. **The arrival** (first screen, once): the dashboard paints already settled; about 1.2 s later the one "needs you"
     item arrives in Needs you (fade and 8px drop, 480 ms, `--m-arrive`), its count turns orange, and on the map the
     agent drifts in. It plays once per visit. Under reduced motion it is already there.
  2. **Each feature's moment** (once each, when half of its piece first scrolls into view): the live piece for that
     feature plays one real change in the real component (below, "What you get"), then stays interactive. While it
     plays, the item the moment is about lifts (scale ≤ 1.02 and a soft shadow) and the rest of the piece dims to half,
     for `--m-hold`; then all of it settles and stays still. Section text enters with a fade and 6px rise over 240 ms.
     A piece is a short slice of the real list (`data-max`) whose frame fits it exactly: nothing scrolls inside it, and
     a quiet "See it all in the live demo" link sits under it. No parallax, no scrubbing.
  3. **The hand-over** (owner, 2026-10-23): as the live window scrolls away, it zooms slowly toward Needs you
     (`--m-zoom`), one scroll-driven transform, never on a phone or under reduced motion. The only scroll-linked motion.
  4. **Feedback**: hover and press on 120 ms. The copy button says "Copied".

### Assets

- **No screenshots anywhere on the site** (owner, 2026-10-22: "I don't want screenshot. I want interactive and motions
  and animated art about the feature itself and we can use our default theme to do that"). Every product image is the
  real product running live on sample data, in the default look (Instrument).
- **One full live dashboard on the page**, in the first screen. Until it's ready, its frame shows the default look's
  empty paper with a quiet "Loading the live dashboard…" line (no picture of it); the real dashboard build
  (`site/public/demo`) then fades in, interactive, and the arrival plays inside it. The guided steps (answer a question, change a project's rules, quiet mode)
  sit directly under that window, so "Try it live" scrolls to them and needs no second copy of the app.
- **The demo shows one morning, not a night** (the lead's call): it opens settled at about 08:00 on the existing sample
  data, and the arrival is the existing 07:24 question. The scroll clock goes: the `overhand:clock` message, the time
  slots in `site/build.ts` (`{{time_*}}`), the night wording and the time labels on sections. The night engine in
  `apps/web/src/demo` is trimmed to what produces that morning; the dashboard's own "overnight" summary stays, since
  it's real product content.
- **Every feature is a live piece** of the real dashboard: the existing `piece.tsx` / `site/public/pieces.js` frames
  one real component (Needs you, In flight, the plan card, Cast, First win, the review drawer, the rules switch) with
  the app's own providers and the demo's sample data. Each piece loads when it nears the viewport, plays its one moment
  once, and stays usable; nothing it does touches anything real, and every refused action says it's a demo. A piece
  that hasn't loaded shows the same empty-paper frame as the hero.
- The sample projects keep neutral product-like names (today's Fernway, Bluekite, Honeycrust, Potluck are fine) and
  never appear as big decorative type.
- The Open Graph image (the link preview, the one place an image is unavoidable) is regenerated: the headline and the
  mark on the default paper, nothing else.
- Icons: one set, already in the app (Lucide through shadcn), at one stroke width. No emoji.

## The site

### Home page, top to bottom

1. **Header**: the mark and "Overhand", then Pricing, Docs on GitHub (only once the repo is public), and one primary
   button, "Get Overhand". Solid, hairline below on scroll.
2. **First screen**: a small mono line ("For coding agents" or similar), the headline "The control room for your coding
   agents.", one sentence ("Overhand runs the agents already working on your code, across every project, by your rules,
   and brings you only the decisions that are yours."), then two actions: **Try it live** (scrolls to the live
   dashboard, or focuses it if already visible) and the install command with a copy button. Under them, the real
   dashboard, large and readable, framed as one window. The arrival plays here.
3. **Try it live**: the full interactive dashboard on sample data with the existing guided steps (answer a question,
   change a project's rules, quiet mode), and the line saying it's sample data and nothing real is touched. On a phone,
   the dashboard's phone layout.
4. **What you get**, four blocks, each a plain heading, two sentences and one live piece that plays its moment once
   when it scrolls into view:
   - *Only what needs you reaches you*: the Needs you piece. A question arrives with its recommended answer and what
     the agent does if you're busy; you can answer it.
   - *Proof on every pull request*: the In flight piece. A red check turns green after a fix round; you can open the
     review with its checks and before-and-after evidence.
   - *Your rules, per project*: the rules switch. Move a project between Build, Drafts and Plan and the line under it
     says what its agents will do; Merging is always you.
   - *Start from a sentence*: the plan card for "make the invite page friendlier", with Go ahead and Change the plan.
   The lead picked these four moments; the owner may swap any.
5. **Safe by design**: agents work on their own branches and never merge; it runs on your machine; your code, keys and
   tokens stay there; a daily budget cap. Short, plain, no icons-in-circles.
6. **Works with the agents you have**: the supported agents named in text (Claude Code, Codex, Gemini CLI, Cursor Agent,
   OpenCode, Aider) and the models and providers they use. No logo wall unless every logo is licensed.
7. **Pricing in one row**: Free (everything local, forever), Pro, Team, Business (ask), linking to Pricing. The
   figures are read from the relay's catalog (`${APP}/relay/prices`) **when the site is built**, not in the browser, so
   they match checkout and cost no JavaScript; if the fetch fails the build falls back to "Prices at launch", like the
   pricing page today (the lead's call).
8. **Install**: the one command again, with copy, and what happens next ("it opens the dashboard in your browser").
9. **Footer**: the existing links and the licence line.

### Before the first public release

The existing `.when-public` switch (`live.css`, written at deploy) stays. Until a release is on the public mirror, the
install command and "Get Overhand" are replaced by one action, "Get notified" (the existing get-in-touch flow), and
"Try it live" stays as the first action, so the first screen always has two (the lead's call).

### Other pages

- **Pricing, contact and legal pages**: the same system, their content unchanged.
- **Features page**: folded into the home page (the lead's call: one page tells it); `/features` redirects to the home
  page's "What you get".
- **Use-case pages** (`site/pages/use-cases`): kept, restyled; they already use live pieces, which now play their
  moment on view instead of following a scroll clock, and open with a piece instead of a scene.
- **Removed**: the second (inert) dashboard iframe, the harbour scene (`site/scene.ts`, `site/public/scene.js`, `site/pages/_partials/shore.html`), the night
  clock rail, `site/BRIEF.md`'s night-shift brief (replaced by a short note pointing to this document), the concept
  pages under `site/concepts` if nothing else links them.

## The dashboard

Both surfaces are in scope: the site and the app share this one system. The frosted-glass surfaces chosen earlier on
2026-10-22 stay (owner, same day); the HUD chrome and the themed worlds' art outside the map give way.

- Adopts the neutral ink scale, Geist and Geist Mono only, the Instrument surfaces (solid raised panes, frosted floating layers), and the motion changes above.
- Instrument stays the default world, restyled; the attention map stays the picture on Now.
- Hidden worlds keep their code; where they rely on the old palette or the glass, they may stay broken while hidden and
  are fixed when they return after launch.
- Existing Catnap users keep Catnap until its upgrade ships (earlier owner decision).
- docs/design-system.md is rewritten to match, so it stays the single reference for both surfaces.

## Quality bar (how "impeccable" is checked)

- WCAG AA contrast in both modes (the existing tests), full keyboard use, visible focus, reduced motion honoured.
- Home page: Largest Contentful Paint under 2 s on a mid-range phone over 4G, no layout shift, no JavaScript beyond the
  copy button and section enter before the live dashboard loads, and the dashboard loads only when it nears the
  viewport.
- 60 fps on scroll and during the arrival on a mid-range laptop; the existing soak budgets for the dashboard still pass.
- `bun run shots` responsive sweep clean on site and dashboard at 375, 768, 1024, 1440, 2200 and 3200px wide.
- A side-by-side screenshot check of each page in light (and dark if shipped) reviewed before merge.
- The five-second test: show the first screen to people who haven't seen it; each can say what it is.

## Constraints

- Plain words and the glossary in docs/design-system.md; "agent", never a tool's name, except where it's that tool's.
- Site build stays `site/build.ts` on Cloudflare; the dashboard demo stays the real app build.
- Fonts self-hosted, no third-party requests, works offline.
- The repo stays private until launch; the site links only to public places.
- One PR per part, each with a preview link and screenshots.

## Left to the builder

The exact type sizes and ink values within the AA tests; the copy's final wording within the plain-words rules; the
order of PRs; how each piece's moment is scripted in the demo; whether the site ships dark mode (only if both are perfect).
