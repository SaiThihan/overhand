import { isObject, type Json, type JsonObject } from "@/lib/json";

/** A project's fields organising can change: its rules, and its folder (the folder tidy). */
const PROJECT_FIELDS = ["autonomy", "assignedAutonomy", "accounts", "fallbackToAll", "private", "dir"] as const;

const same = (a: Json | undefined, b: Json | undefined) => JSON.stringify(a) === JSON.stringify(b);
const list = (x: Json | undefined): JsonObject[] => (Array.isArray(x) ? x.filter(isObject) : []);

export interface Patched {
  draft: JsonObject;
  /** Rows organising changed while you had unsaved edits there (`lead:<key>`, `project:<name>`): your edit is kept. */
  conflicts: string[];
}

/**
 * Brings what an organise change saved into the Settings form without touching anything else you haven't saved. `base`
 * is the config the form last loaded, `fresh` the daemon's config after the change. Groups are taken whole; a lead or a
 * project field organising changed takes the new value where your draft still has the old one, and stays as you edited
 * it (listed in `conflicts`) where it doesn't. Every other field of the draft is left exactly as it was.
 */
export function patchOrganised(draft: JsonObject, base: JsonObject, fresh: JsonObject): Patched {
  const conflicts: string[] = [];
  const next: JsonObject = { ...draft, groups: fresh.groups ?? [] };

  // leads, by key: added, removed and changed ones
  const byKey = (x: Json | undefined) => new Map(list(x).map((l) => [String(l.key ?? ""), l]));
  const [was, now, mine] = [byKey(base.godmode), byKey(fresh.godmode), byKey(draft.godmode)];
  const leads: JsonObject[] = [];
  for (const l of list(draft.godmode)) {
    const key = String(l.key ?? "");
    const before = was.get(key);
    const after = now.get(key);
    if (!before || same(before, after))
      leads.push(l); // yours, or organising didn't touch it
    else if (same(l, before)) {
      if (after) leads.push(after); // changed there, untouched here: take it (gone there: drop it)
    } else {
      conflicts.push(`lead:${key}`);
      leads.push(l);
    }
  }
  for (const [key, l] of now) if (!was.has(key) && !mine.has(key)) leads.push(l);
  next.godmode = leads;

  // projects, by name: only the fields organising changes
  const freshClients = new Map(list(fresh.clients).map((c) => [String(c.name ?? ""), c]));
  const baseClients = new Map(list(base.clients).map((c) => [String(c.name ?? ""), c]));
  next.clients = list(draft.clients).map((c) => {
    const name = String(c.name ?? "");
    const before = baseClients.get(name);
    const after = freshClients.get(name);
    if (!before || !after) return c;
    const out: JsonObject = { ...c };
    let clash = false;
    for (const k of PROJECT_FIELDS) {
      if (same(before[k], after[k])) continue;
      if (!same(c[k], before[k])) {
        clash = true;
        continue;
      }
      const v = after[k];
      if (v === undefined) delete out[k];
      else out[k] = v;
    }
    if (clash) conflicts.push(`project:${name}`);
    return out;
  });
  return { draft: next, conflicts };
}
