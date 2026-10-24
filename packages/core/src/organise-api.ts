/**
 * The dashboard's routes for organising: the grouping, group rules, lead scope, and the suggestions feed. GETs read; POSTs
 * (behind the server's origin check) change the config through the pure functions and save it, live.
 */
import {
  AcceptGroupingSchema,
  type Brief,
  GroupRulesInputSchema,
  LeadScopeInputSchema,
  MoveProjectSchema,
  SuggestionActSchema,
} from "@overhand/contract";
import { z } from "zod";
import { liveScope } from "./cleanup";
import { type Config, saveConfig } from "./config";
import { applyConfig, CFG, CODE, OPS, SRC } from "./env";
import { acceptGrouping, moveProject, setGroupRules } from "./groups";
import { planLeadScope, withLeadScope } from "./lead-scope";
import { leadOf, leadPid, loadLeads, saveLeads, superviseLeads } from "./leads";
import { report } from "./notify";
import {
  applyDedupe,
  applyTidy,
  dismissSuggestion,
  freeKept,
  gatherFacts,
  keptSuggestion,
  organiseView,
  projectFacts,
  refreshSuggestions,
  runningLeads,
  suggestionBriefs,
  undo,
  undoLogs,
} from "./organise";
import { suggestions } from "./suggestions";

const json = (x: unknown, status = 200) => Response.json(x, { status });

/** Saves a changed config and makes it live; a config the schema refuses comes back as a 400. */
function save(next: Config): Response | null {
  try {
    applyConfig(saveConfig(OPS, next));
    return null;
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}

/** An organise decision card (`organise:<id>`) for /api/brief, or null when it's gone or dismissed. */
export function organiseBrief(id: string): Brief | null {
  return suggestionBriefs(CFG, CODE, OPS, SRC).find((b) => b.id === id) ?? null;
}

/** GET /api/organise…; null for any other path. */
export function organiseGet(path: string): Response | null {
  if (path === "/api/organise") return json(organiseView(CFG, projectFacts(CFG, CODE), runningLeads(CFG)));
  if (path === "/api/organise/suggestions") return json({ suggestions: suggestionBriefs(CFG, CODE, OPS, SRC) });
  if (path === "/api/organise/undo") return json({ logs: undoLogs(OPS) });
  return null;
}

/** Stops the leads a lead scope removed, as Stop on the dashboard would (a session you opened by hand is left alone). */
function stopLeads(keys: readonly string[]): void {
  const leads = loadLeads();
  for (const key of keys) {
    const g = CFG.godmode.find((x) => x.key === key);
    if (!g) continue;
    const st = leadOf(leads, key);
    Object.assign(st, { stopped: true, reason: "its group's lead scope changed" });
    const pid = leadPid(g, st);
    if (pid) process.kill(pid, "SIGTERM");
  }
  saveLeads(leads);
}

/** Acts on one suggestion with facts gathered again now (never from what the card showed). */
function act(id: string, action: "apply" | "dismiss" | "preview"): Response {
  const kept = keptSuggestion(OPS, id);
  if (action === "dismiss") {
    if (kept) dismissSuggestion(OPS, kept);
    return json({ ok: true, lines: [], undo: "" });
  }
  const facts = gatherFacts(CFG, CODE, OPS, SRC);
  const s = suggestions(facts).find((x) => x.id === id);
  if (!s) return json({ error: "that suggestion no longer applies" }, 404);
  if (action === "preview") return json({ ok: true, lines: s.preview, undo: "" });
  const [kind = "", ...rest] = id.split(":");
  const key = rest.join(":");
  if (kind === "dedupe-clones") {
    const set = facts.clones.find((c) => c.remote === key);
    if (!set) return json({ error: "those clones changed" }, 409);
    const r = applyDedupe(set, liveScope(CFG, CODE, OPS, SRC));
    if (r.log) report(`🧹 ${r.log.what}`);
    return json({ ok: Boolean(r.log), lines: r.lines, undo: r.log?.id ?? "" });
  }
  if (kind === "tidy-folders") {
    const r = applyTidy(CFG, liveScope(CFG, CODE, OPS, SRC));
    if (!r) return json({ ok: false, lines: ["nothing could move"], undo: "" });
    const bad = save(r.cfg);
    if (bad) return bad;
    report(`🗂 ${r.log.what}`);
    return json({ ok: true, lines: r.lines, undo: r.log.id });
  }
  let next: Config = CFG;
  if (kind === "group-tracker") {
    const names = facts.projects.filter((p) => p.tracker === key).map((p) => p.name);
    next = acceptGrouping(CFG, [{ name: s.target || s.project, members: names }]);
  } else if (kind === "ungrouped") {
    next = acceptGrouping(CFG, [{ name: s.target || key, members: [key] }]);
  } else if (kind === "pause-lead") {
    next = { ...CFG, godmode: CFG.godmode.map((l) => (l.key === key ? { ...l, supervised: false } : l)) };
  } else if (kind === "split-lead") {
    const lead = CFG.godmode.find((l) => l.key === key);
    if (!lead || !CFG.groups.some((g) => g.name === lead.project)) return json({ error: "that lead no longer leads a group" }, 409);
    const plan = planLeadScope(CFG, lead.project, "repo", { running: runningLeads(CFG) });
    if (plan.blocked.length)
      return json({ ok: false, lines: [`${plan.blocked.join(", ")} is running: change it in Settings → Projects to confirm`], undo: "" });
    next = withLeadScope(CFG, lead.project, "repo", plan);
  }
  const bad = save(next);
  if (bad) return bad;
  if (kind === "split-lead" || kind === "pause-lead") superviseLeads();
  refreshSuggestions(CFG, CODE, OPS, SRC);
  return json({ ok: true, lines: s.preview, undo: "" });
}

/** POST /api/organise/…; null for any other path. */
export function organisePost(path: string, body: unknown): Response | null {
  if (!path.startsWith("/api/organise/")) return null;
  const bad = (e: z.ZodError) => json({ error: z.prettifyError(e) }, 400);
  switch (path) {
    case "/api/organise/accept": {
      const r = AcceptGroupingSchema.safeParse(body);
      if (!r.success) return bad(r.error);
      return save(acceptGrouping(CFG, r.data.groups)) ?? json({ ok: true });
    }
    case "/api/organise/rules": {
      const r = GroupRulesInputSchema.safeParse(body);
      if (!r.success) return bad(r.error);
      try {
        return save(setGroupRules(CFG, r.data.group, r.data.rules, r.data.reset)) ?? json({ ok: true });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 404);
      }
    }
    case "/api/organise/move": {
      const r = MoveProjectSchema.safeParse(body);
      if (!r.success) return bad(r.error);
      try {
        return save(moveProject(CFG, r.data.project, r.data.to)) ?? json({ ok: true });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 404);
      }
    }
    case "/api/organise/lead": {
      const r = LeadScopeInputSchema.safeParse(body);
      if (!r.success) return bad(r.error);
      const { group, scope, dryRun, confirm } = r.data;
      if (!CFG.groups.some((g) => g.name === group)) return json({ error: `no group ${group}` }, 404);
      const running = runningLeads(CFG);
      const plan = planLeadScope(CFG, group, scope, { running, confirm });
      const result = { added: plan.added, removed: plan.removed, blocked: plan.blocked };
      if (dryRun || plan.blocked.length) return json({ ...result, applied: false });
      const stopping = plan.removed.filter((k) => running.has(k));
      const failed = save(withLeadScope(CFG, group, scope, plan));
      if (failed) return failed;
      stopLeads(stopping);
      superviseLeads();
      return json({ ...result, applied: true });
    }
    case "/api/organise/suggestion": {
      const r = SuggestionActSchema.safeParse(body);
      if (!r.success) return bad(r.error);
      return act(r.data.id, r.data.action);
    }
    case "/api/organise/undo": {
      const r = z.object({ id: z.string().min(1) }).safeParse(body);
      if (!r.success) return bad(r.error);
      try {
        const u = undo(CFG, OPS, r.data.id);
        return save(u.cfg) ?? json({ ok: true, lines: u.lines });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 404);
      }
    }
    case "/api/organise/free": {
      const r = z.object({ id: z.string().min(1) }).safeParse(body);
      if (!r.success) return bad(r.error);
      return json({ ok: true, lines: freeKept(OPS, r.data.id).map((p) => `freed ${p}`) });
    }
  }
  return json({ error: "no such route" }, 404);
}
