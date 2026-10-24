/**
 * The layout system: breakpoints, the bridge's columns at each width, and the docked side panels on wide screens. Pure,
 * so it can be tested; the components apply it.
 */

/** Viewport widths (CSS px) where the layout changes; `short` is a landscape screen under 500px tall (a phone). */
const BREAKPOINTS = { md: 768, lg: 1024, xl: 1280, "2xl": 1536, "3xl": 2200, "4xl": 3200 } as const;
/** The content never grows wider than this; beyond it the scene fills the edges. */
export const CONTENT_MAX = 3200;
/** `main`'s side padding from `lg`, which the bridge's width doesn't include. */
const GUTTER = 48;

/** What a slot on the bridge holds. */
export type BridgeSlot = "needs" | "today" | "activity" | "window" | "crew" | "work" | "health";

export interface BridgeLayout {
  name: "two" | "three" | "four" | "five";
  /** The grid's column tracks. */
  columns: string;
  /** Each column's slots, top to bottom. */
  tracks: BridgeSlot[][];
}

/**
 * The bridge at `width` (its own width, so a docked panel beside it counts): two columns at `lg` (the side glances drop
 * out: the header's places carry them, and the window keeps its height), three from `xl` (wider wings from `2xl`), four from `3xl` (Needs you | window | Crew | Work
 * and Health) and five from `4xl` (Needs you | today and the day so far | window | Crew | Work and Health). Below `lg`
 * the bridge is one column and isn't laid out here.
 */
export function bridgeLayout(width: number): BridgeLayout {
  const at = (bp: number) => width + GUTTER >= bp;
  if (at(BREAKPOINTS["4xl"]))
    return {
      name: "five",
      columns: "26rem 26rem minmax(0,1fr) 28rem 28rem",
      tracks: [["needs"], ["today", "activity"], ["window"], ["crew"], ["work", "health"]],
    };
  if (at(BREAKPOINTS["3xl"]))
    return {
      name: "four",
      columns: "24rem minmax(0,1fr) 26rem 26rem",
      tracks: [["needs", "today", "activity"], ["window"], ["crew"], ["work", "health"]],
    };
  if (at(BREAKPOINTS.xl))
    return {
      name: "three",
      columns: at(BREAKPOINTS["2xl"]) ? "24rem minmax(0,1fr) 26rem" : "21rem minmax(0,1fr) 22rem",
      tracks: [["needs", "today", "activity"], ["window"], ["crew", "work", "health"]],
    };
  return { name: "two", columns: "minmax(18rem,22rem) minmax(0,1fr)", tracks: [["needs", "today", "activity"], ["window"]] };
}

/** A place that docks beside the bridge on a wide screen instead of covering it. */
export type Dockable = "work" | "crew" | "health" | "settings";

/**
 * From `3xl` a place opens as a side panel docked beside the bridge, the world still in view: its width in CSS px, or
 * 0 where it opens as a drawer over the bridge. Work is wider, so the pipeline and Yours fit side by side, but always
 * leaves the bridge at least 960px.
 */
export function dockWidth(place: Dockable, viewport: number): number {
  if (viewport < BREAKPOINTS["3xl"]) return 0;
  return place === "work" ? Math.min(1600, viewport - 960) : 768;
}
