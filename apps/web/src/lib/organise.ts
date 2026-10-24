import {
  type GroupRules,
  type LeadScope,
  LeadScopeResultSchema,
  OrganiseSchema,
  type ProposedGroup,
  SuggestionResultSchema,
  SuggestionsSchema,
} from "@overhand/contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { useWords } from "@/app/theme";
import { get, post } from "@/lib/api";
import { fmt } from "@/lib/format";

const ORGANISE = ["organise"] as const;
const SUGGESTIONS = ["organise", "suggestions"] as const;
const Ok = z.looseObject({ ok: z.boolean() });
const UndoLogsSchema = z.object({ logs: z.array(z.object({ id: z.string(), at: z.number(), what: z.string() })) });

const listeners = new Set<() => void>();
/**
 * Calls `fn` after every organise change the daemon saved (Settings patches its form from the fresh config, so its next
 * Save doesn't put the old groups back). Returns the unsubscribe.
 */
export function onOrganised(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Your groups, the projects in none, and the proposal (`GET /api/organise`). */
export const useOrganise = () => useQuery({ queryKey: ORGANISE, queryFn: () => get("/api/organise", OrganiseSchema), staleTime: 10_000 });

/** The open suggestions, as decision cards (`GET /api/organise/suggestions`). */
export const useSuggestions = () =>
  useQuery({ queryKey: SUGGESTIONS, queryFn: () => get("/api/organise/suggestions", SuggestionsSchema), staleTime: 60_000 });

/** Recent disk changes that can be undone. */
export const useUndoLogs = () =>
  useQuery({ queryKey: ["organise", "undo"], queryFn: () => get("/api/organise/undo", UndoLogsSchema), staleTime: 10_000 });

/** "a, b , c" → ["a", "b", "c"]; empty → undefined (the rule is cleared and follows the default). */
export function csv(text: string): string[] | undefined {
  const list = text
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

/** "09:00-17:00, 22:00-07:00" → hold windows for every kind; anything that isn't a window is dropped. */
export function parseQuiet(text: string): GroupRules["windows"] {
  const ws = text
    .split(",")
    .map((x) => x.trim().match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/))
    .flatMap((m) => (m?.[1] && m[2] ? [{ from: m[1], to: m[2], kinds: [] }] : []));
  return ws.length ? ws : undefined;
}

/** Hold windows back as "09:00-17:00, …". */
export const quietText = (ws: GroupRules["windows"]): string => (ws ?? []).map((w) => `${w.from}-${w.to}`).join(", ");

/** Every organising action, each reporting its outcome as a toast and refreshing what it changed. */
export function useOrganiseActions() {
  const qc = useQueryClient();
  const w = useWords();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ORGANISE });
    for (const l of listeners) l();
  };
  const guard = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
      return null;
    }
  };
  return {
    /** Keeps a grouping: as proposed, or as you adjusted it. */
    accept: (groups: readonly Pick<ProposedGroup, "name" | "members">[]) =>
      guard(async () => {
        await post("/api/organise/accept", { groups }, Ok);
        toast(w.saidGrouped);
        refresh();
      }),
    /** Sets a group's rules; `reset` makes every member follow them. */
    rules: (group: string, rules: GroupRules, reset = false) =>
      guard(async () => {
        await post("/api/organise/rules", { group, rules, reset }, Ok);
        toast(fmt(w.saidOrganised, { what: group }));
        refresh();
      }),
    /** Moves a project into a group ("" = out of every group). */
    move: (project: string, to: string) =>
      guard(async () => {
        await post("/api/organise/move", { project, to }, Ok);
        refresh();
      }),
    /** A group's lead scope: a dry run, the change, or (`confirm`) the change stopping running leads. */
    lead: (group: string, scope: LeadScope, o: { dryRun?: boolean; confirm?: boolean } = {}) =>
      guard(async () => {
        const r = await post(
          "/api/organise/lead",
          { group, scope, dryRun: o.dryRun ?? false, confirm: o.confirm ?? false },
          LeadScopeResultSchema,
        );
        if (r.applied) refresh();
        return r;
      }),
    /** Acts on a suggestion; what it did (or would do) comes back as a toast. */
    act: async (id: string, action: "apply" | "dismiss" | "preview"): Promise<void> => {
      await guard(async () => {
        const r = await post("/api/organise/suggestion", { id, action }, SuggestionResultSchema);
        if (r.lines.length) toast(r.lines.join("\n"));
        refresh();
        void qc.invalidateQueries({ queryKey: ["brief"] });
      });
    },
    /** Puts a disk change back. */
    undo: (id: string) =>
      guard(async () => {
        await post("/api/organise/undo", { id }, Ok);
        toast(w.saidUndone);
        refresh();
      }),
    /** Deletes the clones a change set aside (it can't be undone after). */
    free: (id: string) =>
      guard(async () => {
        await post("/api/organise/free", { id }, Ok);
        refresh();
      }),
  };
}
