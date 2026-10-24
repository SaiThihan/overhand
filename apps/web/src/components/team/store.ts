/**
 * The Team view's own state: Me or Team on Now, and whom you follow. A tiny external store so the header's facepile and
 * Now share it without a provider; the choice of view is remembered per browser.
 */
import { useSyncExternalStore } from "react";
import { z } from "zod";
import { store } from "@/app/store";
import { post } from "@/lib/api";

type TeamUi = { view: "me" | "team"; follow: string | null };
let ui: TeamUi = { view: store.get("team.view") === "team" ? "team" : "me", follow: null };
const subs = new Set<() => void>();
const set = (next: Partial<TeamUi>) => {
  ui = { ...ui, ...next };
  store.set("team.view", ui.view);
  for (const f of subs) f();
};

/** Me / Team on Now, and the person followed (their map as they see it), or null. */
export function useTeamUi(): TeamUi & { setView: (v: TeamUi["view"]) => void; setFollow: (user: string | null) => void } {
  const now = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => ui,
    () => ui,
  );
  return { ...now, setView: (view) => set({ view }), setFollow: (follow) => set({ follow, ...(follow ? { view: "team" as const } : {}) }) };
}

/** Sends one team action to the daemon (POST /api/team/<action>); throws the daemon's message. */
export const teamPost = (action: string, body: object = {}) => post(`/api/team/${action}`, body, z.looseObject({}));
