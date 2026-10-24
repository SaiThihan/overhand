import type { DashboardState, Lead } from "@overhand/contract";
import type { Words } from "@overhand/themes";
import { type Beat, beats } from "./beats";
import { fmt } from "./format";

/** The leads that work in a client: its project in config, else the client's name in the lead's label. */
export function leadsIn(godmode: readonly Lead[], client: string): Lead[] {
  return godmode.filter((g) => (g.project ? g.project === client : g.label.toLowerCase().includes(client.toLowerCase())));
}

/** The client a sentence is about: the one it names first ("Ops lead woke up on work" is Ops). */
export function clientOf(clients: readonly { name: string }[], text: string): string | null {
  const lower = text.toLowerCase();
  const named = clients
    .map((c) => ({ name: c.name, at: lower.indexOf(c.name.toLowerCase()) }))
    .filter((c) => c.at >= 0)
    .sort((p, q) => p.at - q.at);
  return named[0]?.name ?? null;
}

/** The day's newest beat and the client it happened in, or null before anything happened. */
export function newestBeat(s: DashboardState): (Beat & { client: string | null }) | null {
  const last = beats(s.reports).at(-1);
  return last ? { ...last, client: clientOf(s.clients, last.text) } : null;
}

/** A project at a glance: agents at work there, whether something there waits on you, whether something is broken. */
export interface Place {
  name: string;
  /** Agents at work there: its running leads and its ticket agent runs. */
  working: number;
  /** Something there waits on you. */
  needs: boolean;
  /** Something there is broken: a red build, or its tracker unreachable. */
  failure: boolean;
}

/** Each project at a glance, in config order. */
export function placesFrom(s: DashboardState): Place[] {
  return s.clients.map((c) => {
    const leads = leadsIn(s.godmode, c.name);
    return {
      name: c.name,
      working:
        leads.filter((g) => g.running && !g.waiting && !g.open).length + s.running.filter((r) => r.name.startsWith(`${c.prefix}-`)).length,
      needs: leads.some((g) => g.waiting || g.open),
      failure: s.status.ci.some((k) => k.client === c.name && k.state === "fail") || !Array.isArray(s.tickets[c.name] ?? []),
    };
  });
}

/** A project's place in one line: what's broken, who waits on you, how many are at work, or quiet. */
export function placeStatus(p: Place, w: Words): string {
  const parts = [p.failure ? w.placeBroken : "", p.needs ? w.placeWaiting : "", p.working ? fmt(w.placeWorking, { n: p.working }) : ""];
  return parts.filter(Boolean).join(" · ") || w.placeQuiet;
}
