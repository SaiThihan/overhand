/**
 * Instrument's palette, re-exported from the one source (../system.ts), so the hour's light (../light.ts) lands on the
 * same paper as the dashboard. index.ts builds the theme from these.
 */
import { SYSTEM } from "../system";

/** Instrument at night: harbour-fog ink, 1–12 (app background → high-contrast text). */
export const night = SYSTEM.ink.night;

/** Instrument by day: harbour fog, a cool green-grey paper, ink for text. */
export const day = SYSTEM.ink.day;

/** The one colour that means you: the fill everywhere, and its text shade on day paper (AA on day[0]). */
export const you = { fill: SYSTEM.state.night.youFill, dayText: SYSTEM.state.day.you } as const;
