import { defineTheme, fromInk, type Tokens } from "../define";
import { SYSTEM } from "../system";
import { plainWords } from "../words";
import { day, night } from "./palette";

/** Rounded panes, and every control a pill. The paper is plain: no pattern or glow behind it. */
function house(t: Tokens): Tokens {
  return { ...t, radius: SYSTEM.radius.pane, "radius-control": SYSTEM.radius.control };
}

export default defineTheme({
  id: "overhand",
  name: "Instrument",
  tagline: "Ink, paper and one light",
  ink: night,
  lightInk: day,
  tokens: house(fromInk(night, SYSTEM.state.night)),
  light: house(fromInk(day, SYSTEM.state.day)),
  fonts: {
    display: SYSTEM.font.body,
    body: SYSTEM.font.body,
    mono: SYSTEM.font.mono,
    href: SYSTEM.font.href,
  },
  // projects are named, not coloured: colour is state and you; and all in one ink, since two alternating greys read as
  // a difference there isn't
  hues: [night[11]],
  lightHues: [day[11]],
  words: plainWords,
  voice: { prefer: ["Daniel", "Arthur", "Google UK English Male", "Microsoft Ryan", "Microsoft George"], rate: 1, pitch: 1 },
  world: "instrument",
});
