import { defineTheme, fromInk } from "../define";
import { SYSTEM } from "../system";
import { plainWords } from "../words";

/** The flat by day: cream walls and walnut ink, the window's light on the floor. */
const day = [
  "#fbf5ea", // 1 app background
  "#f5ecdc", // 2 subtle background
  "#fffcf6", // 3 card
  "#f1e7d5", // 4 hover, popover
  "#eaddc7", // 5 selected
  "#e3d4ba", // 6 subtle border
  "#d3c1a2", // 7 border
  "#bca685", // 8 strong border
  "#98826a", // 9 solid, muted
  "#6e5e49", // 10 muted text
  "#4a3e30", // 11 low-contrast text
  "#2f2620", // 12 high-contrast text
] as const;

/** The same flat after dusk: walnut and lamplight. */
const evening = [
  "#1d1814", // 1 app background
  "#221c17", // 2 subtle background
  "#27201a", // 3 card
  "#2e261f", // 4 hover, popover
  "#352c24", // 5 selected
  "#3c3229", // 6 subtle border
  "#4a3e33", // 7 border
  "#5e5043", // 8 strong border
  "#7e6e5d", // 9 solid, muted
  "#a8968a", // 10 muted text
  "#d3c4b4", // 11 low-contrast text
  "#f3eadf", // 12 high-contrast text
] as const;

/**
 * Catnap: a sunny flat full of cats who secretly do your work while you're away. The rug is the map and you are the
 * armchair at its centre; cats sleep curled when there's nothing to do, sit up to work, and come close, orange-eyed with
 * a question-mark tail, when they need you. The cats are art: every word on screen is the house's, apart
 * from the greeting's flavour lines and the cats' names. Light first: by day the window
 * lights the floor, after dusk the lamp comes on. Its one colour is the cats' eyes.
 */
export default defineTheme({
  id: "catnap",
  name: "Catnap",
  tagline: "They'd deny everything.",
  ink: evening,
  lightInk: day,
  tokens: fromInk(evening, {
    you: "#f0a25c",
    youFill: "#f0a25c",
    youInk: "#1d1814",
    ok: "#a4cf96",
    bad: "#ff8f80",
    destructive: "#a8332a",
  }),
  light: fromInk(day, { you: "#954810", youFill: "#a14f12", youInk: "#ffffff", ok: "#336a3c", bad: "#a8332a", destructive: "#a8332a" }),
  fonts: {
    display: SYSTEM.font.body,
    greeting: '"Fraunces", ui-serif, Georgia, serif',
    body: SYSTEM.font.body,
    mono: SYSTEM.font.mono,
    href: "fonts/catnap.css",
  },
  // projects are named, not coloured: colour is state and you
  hues: [evening[11], evening[10], evening[11], evening[10], evening[11], evening[10]],
  lightHues: [day[11], day[10], day[11], day[10], day[11], day[10]],
  words: {
    ...plainWords,
    brHelloNight: "Still up, {name}? They're watching you.",
    brCalm: "Nothing got knocked off the table. | All quiet. Suspiciously quiet.",
    brIdle: "Everyone's asleep in the sun. | Suspiciously productive dozing.",
    calm: "Nothing needs you. Everyone's dozing.",
    emptyMine: "Your list is clear. Have a stretch.",
    emptyActivity: "Quiet so far. Suspiciously quiet.",
  },
  voice: { prefer: ["Moira", "Karen", "Serena", "Google UK English Female", "Microsoft Libby"], rate: 0.98, pitch: 1.1 },
  world: "catnap",
});
