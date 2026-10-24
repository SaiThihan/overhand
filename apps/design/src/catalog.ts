/**
 * The design catalog: every part of the dashboard, in every state, on the demo's sample data. Overhand's own reference
 * (overhand.dev/docs/design), never shipped in a release. catalog.test.ts keeps it complete: every ui primitive and
 * every component exported from the dashboard's main folders has an entry here, or a line in SKIP saying why not.
 */
import type { JSX } from "react";
import { COMPONENTS } from "./pages/components";
import { PATTERNS } from "./pages/patterns";
import { SCREENS } from "./pages/screens";

/** One part of the dashboard and the states it can be in. */
export interface Entry {
  /** Its address: `#/<group>/<id>`. A primitive's id is its file name in components/ui. */
  id: string;
  group: "components" | "patterns" | "screens";
  title: string;
  /** What it is and where the dashboard shows it, in plain words. */
  about?: string;
  /** Each state, rendering the real component on a sample. */
  states: Record<string, () => JSX.Element>;
  /** What a state shows, when its name doesn't say it all. */
  notes?: Record<string, string>;
  /** The exported components this entry renders besides the one its id names. */
  covers?: string[];
  /** Why a component has no hover, focus or disabled state of its own. */
  passive?: string;
  /** Shown in frames of their own: overlays, whole screens and anything that needs its own viewport or clock. */
  frame?: { height: number; only?: string[] };
}

/** Every entry, in the catalog's order. */
export const CATALOG: Entry[] = [...COMPONENTS, ...PATTERNS, ...SCREENS];

/** Exported components with no entry of their own, each with the reason. */
export const SKIP: Record<string, string> = {};

/** Whether a state renders in a frame of its own. */
export const framed = (e: Entry, state: string): boolean => Boolean(e.frame && (!e.frame.only || e.frame.only.includes(state)));
