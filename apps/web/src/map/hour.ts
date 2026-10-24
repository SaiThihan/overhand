/**
 * The real hour's light on the attention map (Instrument): the tint of the sky at that hour from the shared light model
 * (packages/themes/src/light.ts), so the map warms at dawn and dusk and cools at night, and how dark it is, which brightens the
 * lights of working agents after dark. A tint over the theme, never a theme of its own: light and dark stay the user's.
 */
import { lightAt } from "@overhand/themes";

export interface HourLight {
  /** The sky's low colour at that hour, as CSS. */
  tint: string;
  /** 1 at midnight dark, 0 in full day. */
  night: number;
}

/** The light at the local hour of `ms`, eased to the quarter hour so the map doesn't redraw on every poll. */
export function hourLight(ms: number): HourLight {
  const d = new Date(ms);
  const h = d.getHours() + Math.floor(d.getMinutes() / 15) / 4;
  const L = lightAt(h);
  return { tint: `rgb(${L.skyLow.map(Math.round).join(" ")})`, night: Math.round((1 - L.day) * 100) / 100 };
}
