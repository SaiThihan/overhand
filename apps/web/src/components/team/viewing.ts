import { useEffect } from "react";
import { teamPost } from "./store";

/**
 * Tells the team what this tab has open (a static dot on that item for teammates): one message when it opens, one when
 * it closes, none while nothing changes. A hidden tab shows nothing open, and says so once.
 */
export function useTeamViewing(target: { item: string; label: string } | null, enabled = true): void {
  const item = target?.item ?? "";
  const label = target?.label ?? "";
  useEffect(() => {
    if (!enabled || !item) return;
    const say = (on: boolean) => void teamPost("viewing", on ? { item, label } : {}).catch(() => {});
    const onVisibility = () => say(document.visibilityState === "visible");
    if (document.visibilityState === "visible") say(true);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      say(false);
    };
  }, [item, label, enabled]);
}
