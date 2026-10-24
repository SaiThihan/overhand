import { askGate, type DashboardState } from "@overhand/contract";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { post } from "@/lib/api";

/**
 * Runs `look` whenever the app comes into view: when it opens (or `ready` turns true, the state in), when its tab is
 * shown again, when its window gets focus.
 */
export function useOnReturn(look: () => void, ready = true): void {
  const latest = useRef(look);
  latest.current = look;
  useEffect(() => {
    const go = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    if (!ready) return;
    go();
    document.addEventListener("visibilitychange", go);
    window.addEventListener("focus", go);
    return () => {
      document.removeEventListener("visibilitychange", go);
      window.removeEventListener("focus", go);
    };
  }, [ready]);
}

/** This tab's side of the automatic asks: a glance every few seconds still asks once per FRESH_MIN. */
const slack = askGate();
const usage = askGate();

/**
 * What the app asks for when you come back to it, so nothing waits on a button: a Slack pass when Slack's last read is
 * old (and none is running), and fresh usage readings. The daemon throttles them again for every tab and device.
 */
export function freshAsks(s: DashboardState, now: number): string[] {
  const reading = s.running.some((r) => r.name === "inbox");
  const oldest = Math.min(...s.accounts.map((a) => a.usage?.at ?? 0));
  return [
    ...(s.slackReadAt && !reading && slack(s.slackReadAt, now) ? ["/api/request/inbox"] : []),
    ...(s.accounts.length && usage(oldest, now) ? ["/api/usage/refresh"] : []),
  ];
}

/** Asks for fresh reads whenever the app comes back into view (see `freshAsks`). */
export function useFreshOnReturn(s: DashboardState | undefined): void {
  useOnReturn(() => {
    if (!s) return;
    for (const url of freshAsks(s, Date.now())) void post(url, { auto: true }, z.object({})).catch(() => {});
  }, Boolean(s));
}
