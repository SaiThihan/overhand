import { useSyncExternalStore } from "react";
import { store } from "./store";

/** The map's motion: moving, or one still frame per change. Kept in this browser. */
export type MapMode = "on" | "still";
// the key from when this was the painted scene's setting; its old "off" holds the map still
const KEY = "overhand-backdrop";
const toMode = (v: string | null): MapMode => (v === "still" || v === "off" ? "still" : "on");
const listeners = new Set<() => void>();

/** The map's motion setting (Settings › Look & sound, Quick settings), shared by the map and both settings. */
export function useMapMode(): [MapMode, (mode: MapMode) => void] {
  const mode = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toMode(store.get(KEY)),
  );
  return [
    mode,
    (next) => {
      store.set(KEY, next);
      for (const l of listeners) l();
    },
  ];
}
