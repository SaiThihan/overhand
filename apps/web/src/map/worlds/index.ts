import type { ThemeDefinition } from "@overhand/themes";
import type { World } from "../world";
import { catnap } from "./catnap";
import { instrument } from "./instrument";
import { koi } from "./koi";
import { observatory } from "./observatory";
import { transit } from "./transit";

export type WorldId = ThemeDefinition["world"];

/** Every world the attention map can be drawn in, by the id a theme names in `world`. */
export const WORLDS: Record<WorldId, World> = { instrument, observatory, transit, koi, catnap };
