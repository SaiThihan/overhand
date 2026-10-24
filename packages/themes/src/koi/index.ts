import { defineTheme, fromInk } from "../define";
import { SYSTEM } from "../system";
import { plainWords } from "../words";

/** Pond at dusk: deep teal ink, pale water light. */
const ink = [
  "#071a1c", // 1 app background
  "#0a2022", // 2 subtle background
  "#0c2326", // 3 card
  "#10292c", // 4 hover, popover
  "#143034", // 5 selected
  "#18373b", // 6 subtle border
  "#22454a", // 7 border
  "#2f575c", // 8 strong border
  "#4e7470", // 9 solid, muted
  "#8fa8a4", // 10 muted text
  "#bcd0cb", // 11 low-contrast text
  "#e8f2ee", // 12 high-contrast text
] as const;

/**
 * Koi Pond: a pond at dusk. Agents are koi; working ones swim, idle ones rest under the lily pads, and one that needs
 * you rises to the lantern by your stone, in lantern gold, the world's one colour. Always dusk.
 */
export default defineTheme({
  id: "koi",
  name: "Koi Pond",
  tagline: "A pond at dusk, lit by one lantern",
  ink,
  tokens: fromInk(ink, { you: "#f2b544", youFill: "#f2b544", youInk: "#071a1c", ok: "#8fd3a8", bad: "#f08a78", destructive: "#a8332a" }),
  fonts: {
    display: SYSTEM.font.body,
    greeting: '"Zen Old Mincho", ui-serif, Georgia, serif',
    body: SYSTEM.font.body,
    mono: SYSTEM.font.mono,
    href: "fonts/koi.css",
  },
  // projects are named, not coloured: colour is state and you
  hues: [ink[11], ink[10], ink[11], ink[10], ink[11], ink[10]],
  words: plainWords,
  voice: { prefer: ["Daniel", "Arthur", "Google UK English Male", "Microsoft Ryan", "Microsoft George"], rate: 1, pitch: 1 },
  world: "koi",
});
