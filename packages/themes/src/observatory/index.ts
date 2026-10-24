import { defineTheme, fromInk } from "../define";
import { SYSTEM } from "../system";
import { plainWords } from "../words";

/** Night sky: deep navy ink, starlight text. */
const ink = [
  "#04070d", // 1 app background
  "#070c15", // 2 subtle background
  "#0a111c", // 3 card
  "#0e1724", // 4 hover, popover
  "#131e2e", // 5 selected
  "#182538", // 6 subtle border
  "#213149", // 7 border
  "#2e4260", // 8 strong border
  "#4a5f7e", // 9 solid, muted
  "#8fa0b6", // 10 muted text
  "#bcc8d8", // 11 low-contrast text
  "#e6eef8", // 12 high-contrast text
] as const;

/**
 * Observatory: a night sky through a dome. Agents are satellites holding their orbits; one that needs you becomes a
 * comet falling toward you, in comet gold, the world's one colour. Always night.
 */
export default defineTheme({
  id: "observatory",
  name: "Observatory",
  tagline: "A night sky that watches with you",
  ink,
  tokens: fromInk(ink, { you: "#ffc76b", youFill: "#ffc76b", youInk: "#04070d", ok: "#6fe0b8", bad: "#ff5c7a", destructive: "#b0263f" }),
  fonts: {
    display: SYSTEM.font.body,
    greeting: '"Cormorant Garamond", ui-serif, Georgia, serif',
    body: SYSTEM.font.body,
    mono: SYSTEM.font.mono,
    href: "fonts/observatory.css",
  },
  // projects are named, not coloured: colour is state and you
  hues: [ink[11], ink[10], ink[11], ink[10], ink[11], ink[10]],
  words: plainWords,
  voice: { prefer: ["Daniel", "Arthur", "Google UK English Male", "Microsoft Ryan", "Microsoft George"], rate: 1, pitch: 1 },
  world: "observatory",
});
