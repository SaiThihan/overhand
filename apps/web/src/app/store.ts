import { DEMO } from "@/demo/demo";

// The demo embedded in the landing page keeps its choices in memory, so a tab or theme picked in the full-screen demo
// (same origin, same localStorage) doesn't leak into the page's guided tour.
const memory = DEMO && typeof window !== "undefined" && window.parent !== window ? new Map<string, string>() : null;

/** localStorage that never throws (private windows, blocked site data): reads fall back to null. */
export const store = {
  get(k: string): string | null {
    if (memory) return memory.get(k) ?? null;
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    if (memory) {
      memory.set(k, v);
      return;
    }
    try {
      localStorage.setItem(k, v);
    } catch {
      // not persisted; the page still works
    }
  },
  remove(k: string): void {
    if (memory) {
      memory.delete(k);
      return;
    }
    try {
      localStorage.removeItem(k);
    } catch {
      // nothing to forget
    }
  },
};
