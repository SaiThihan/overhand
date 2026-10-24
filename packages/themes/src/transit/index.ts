import { defineTheme, fromInk } from "../define";
import { SYSTEM } from "../system";
import { plainWords } from "../words";

/** Map paper: warm off-white, printer's ink. */
const ink = [
  "#f7f6f1", // 1 app background
  "#efeee8", // 2 subtle background
  "#fdfcf8", // 3 card
  "#e9e8e1", // 4 hover, popover
  "#e1e0d8", // 5 selected
  "#d9d8cf", // 6 subtle border
  "#c7c5bb", // 7 border
  "#aba99f", // 8 strong border
  "#83817a", // 9 solid, muted
  "#5c5a55", // 10 muted text
  "#393834", // 11 low-contrast text
  "#141414", // 12 high-contrast text
] as const;

/**
 * Transit: a living metro map. Each project is a line out from you, the interchange at the centre; agents are
 * trains, and one that needs you waits at your platform, in platform orange, the world's one colour. Always paper.
 */
export default defineTheme({
  id: "transit",
  name: "Transit",
  tagline: "A living metro map on paper",
  ink,
  tokens: fromInk(ink, { you: "#a3400a", youFill: "#f26b1d", youInk: "#141414", ok: "#25693f", bad: "#b8232b", destructive: "#b8232b" }),
  scheme: "light",
  fonts: {
    display: SYSTEM.font.body,
    greeting: '"Overpass", ui-sans-serif, system-ui, sans-serif',
    body: SYSTEM.font.body,
    mono: SYSTEM.font.mono,
    href: "fonts/transit.css",
  },
  // projects are named, not coloured: colour is state and you
  hues: [ink[11], ink[10], ink[11], ink[10], ink[11], ink[10]],
  words: plainWords,
  voice: { prefer: ["Daniel", "Arthur", "Google UK English Male", "Microsoft Ryan", "Microsoft George"], rate: 1, pitch: 1 },
  world: "transit",
});
