import catnap from "./catnap";
import type { ThemeDefinition } from "./define";
import koi from "./koi";
import observatory from "./observatory";
import overhand from "./overhand";
import transit from "./transit";

export {
  defineTheme,
  fromInk,
  type InkState,
  type ThemeDefinition,
  type ThemeFonts,
  TOKEN_KEYS,
  type TokenKey,
  type Tokens,
} from "./define";
export { day as dayInk, night as nightInk, you } from "./overhand/palette";
export { FLAVOUR_KEYS, placeholders, plainWords, type WordKey, type Words } from "./words";

/** Every first-party world, Instrument (the house theme) first; the code stays even for worlds not offered yet. */
export const allWorlds: readonly ThemeDefinition[] = [overhand, observatory, transit, koi, catnap];

/** The worlds people can pick. Launch offers the default only; add an id here to bring a world back. */
const LAUNCH = new Set(["overhand"]);

/** The worlds offered, in order: the picker, the command bar and the share card only ever see these. */
export const worlds: readonly ThemeDefinition[] = allWorlds.filter((t) => LAUNCH.has(t.id));

/** Every theme a browser can be on: the offered worlds. */
export const themes: readonly ThemeDefinition[] = worlds;

/**
 * The theme with this id, or Instrument when there's none. That fallback is also the migration: the house theme's
 * earlier id ("plain"), the retired worlds (Nexus, Legion, Syndicate, Tokenmaxx) and any world not
 * offered yet all load Instrument.
 */
export function themeById(id: string | null | undefined): ThemeDefinition {
  return themes.find((t) => t.id === id) ?? overhand;
}

/** Any first-party world by id, offered or not (for code and tests that name one), or Instrument. */
export function worldById(id: string): ThemeDefinition {
  return allWorlds.find((t) => t.id === id) ?? overhand;
}
export { iconSvg, lockupSvg, MARK_GROUND, MARK_INK, type MarkOn, type MarkParts, markParts, markSvg, WORDMARK } from "./brand";
export { type Light, lightAt } from "./light";
export { type State, type Surface, SYSTEM, systemCss } from "./system";
