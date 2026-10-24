import type { DashboardState, PendingTicket, Ticket } from "@overhand/contract";

/** A ticket the planner picked for the agent; `on` = armed for the next pass. */
export interface AgentItem {
  /** Line number in today's plan file, which `/api/plan/toggle` needs. */
  i: number;
  key: string;
  title: string;
  why: string;
  on: boolean;
}

/** Something the planner left for you to do yourself. */
export interface YouItem {
  i: number;
  key: string;
  url: string;
  title: string;
  why: string;
}

export interface Plan {
  top: string[];
  clients: Record<string, { agent: AgentItem[]; you: YouItem[] }>;
  inbox: { line: string; i: number }[];
  notes: string[];
}

const KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;

/** Reads today's plan file (markdown written by the planner) into its sections. */
export function parsePlan(lines: readonly string[]): Plan {
  const m: Plan = { top: [], clients: {}, inbox: [], notes: [] };
  let h2 = "";
  let h3 = "";
  lines.forEach((line, i) => {
    if (line.startsWith("## ")) {
      h2 = line.slice(3).trim();
      h3 = "";
      return;
    }
    if (line.startsWith("### ")) {
      h3 = line.slice(4).trim();
      return;
    }
    if (!line.trim() || line.startsWith(">") || line.startsWith("# ")) return;
    if (/^Top 3/i.test(h2)) {
      const t = line.replace(/^\d+\.\s*/, "");
      if (t) m.top.push(t);
      return;
    }
    if (/^Inbox/i.test(h2)) {
      m.inbox.push({ line, i });
      return;
    }
    if (/^Notes/i.test(h2)) {
      m.notes.push(line.replace(/^[-*]\s+/, ""));
      return;
    }
    const c = m.clients[h2] ?? { agent: [], you: [] };
    m.clients[h2] = c;
    const key = line.match(KEY)?.[1] ?? "";
    const url = line.match(/https?:\/\/\S+/)?.[0] ?? "";
    const rest = line
      .replace(/^\s*(-\s*\[[ xX]\]|\d+\.|-)\s*/, "")
      .replace(url, "")
      .replace(key, "")
      .replace(/^\s*[:·-]?\s*/, "");
    const [title = "", why = ""] = rest.split(" — ");
    if (/^Agent/i.test(h3)) {
      const box = line.match(/^\s*-\s*\[([ xX])\]/);
      if (box) c.agent.push({ i, key, title: title.trim(), why: why.replace(/\s*\(~0m\)\s*$/, "").trim(), on: box[1] !== " " });
    } else if (/^You/i.test(h3) && !/^- nothing/.test(line)) c.you.push({ i, key, url, title: title.trim(), why: why.trim() });
  });
  return m;
}

/** Ticket keys armed for the agent today. */
export function plannedKeys(plan: Plan): Set<string> {
  return new Set(Object.values(plan.clients).flatMap((c) => c.agent.filter((a) => a.on).map((a) => a.key)));
}

type ReadyState = Pick<DashboardState, "running" | "labels" | "prs" | "tickets">;

/**
 * Armed items the agents' next pass would actually start: the daemon's own gate (packages/core agent.ts) skips a
 * ticket that is running, has a PR it tracks, or carries the working, review or blocked label, and a line without a
 * ticket key never starts. This is Work's Queued column, so the count can't promise more than the board shows.
 */
export function readyItems(plan: Plan, s: ReadyState): AgentItem[] {
  const busy = [s.labels.working, s.labels.review, s.labels.blocked];
  const prs = new Set(s.prs.map((p) => p.key));
  return Object.values(plan.clients).flatMap((c) =>
    c.agent.filter((a) => {
      if (!a.on || !a.key || prs.has(a.key) || s.running.some((r) => r.name.startsWith(a.key))) return false;
      return !findTicket(s.tickets, a.key)?.labels.some((l) => busy.includes(l));
    }),
  );
}

/** How many armed items the next pass would start (`readyItems`). */
export function armedCount(plan: Plan, s: ReadyState): number {
  return readyItems(plan, s).length;
}

export type TicketStatus = "working" | "blocked" | "review" | "queued" | "planned" | "mine";

/** Where a ticket stands, from its labels, the running agent and today's plan. */
export function statusOf(t: Ticket, s: Pick<DashboardState, "running" | "labels">, planned: Set<string>): TicketStatus {
  const L = t.labels;
  if (s.running.some((r) => r.name.startsWith(t.key)) || L.includes(s.labels.working)) return "working";
  if (L.includes(s.labels.blocked)) return "blocked";
  if (L.includes(s.labels.review)) return "review";
  if (L.includes(s.labels.queue)) return "queued";
  if (planned.has(t.key)) return "planned";
  return "mine";
}

/** A ticket from any client's open list, with the client it belongs to. */
export function findTicket(tickets: DashboardState["tickets"], key: string): (Ticket & { client: string }) | null {
  for (const [client, list] of Object.entries(tickets)) {
    if (!Array.isArray(list)) continue;
    const t = list.find((x) => x.key === key);
    if (t) return { ...t, client };
  }
  return null;
}

export type InboxItem =
  /** A Slack request about to become a ticket; `on` = it will be filed. */
  | { kind: "new"; line: number; on: boolean; title: string; when: "filed" | "skipped" | "at" | "filing"; at: number }
  /** Someone waiting on your reply, with the suggested answer and a Slack link. */
  | { kind: "reply"; text: string; suggested: string; link: string }
  | { kind: "note"; text: string };

/** The plan's Inbox section, as things waiting on you. */
export function parseInbox(inbox: Plan["inbox"], pending: readonly PendingTicket[], now: number): InboxItem[] {
  const out: InboxItem[] = [];
  for (let k = 0; k < inbox.length; k++) {
    const entry = inbox[k];
    if (!entry) continue;
    const { line, i } = entry;
    const nt = line.match(/^\s*-\s*\[([ xX])\]\s*(new-[a-z0-9]+)\s*(.*)$/);
    if (nt) {
      const on = nt[1] !== " ";
      const p = pending.find((x) => x.id === nt[2]);
      const when = !p ? "filed" : !on ? "skipped" : p.createAfter > now ? "at" : "filing";
      out.push({ kind: "new", line: i, on, title: nt[3] ?? "", when, at: p?.createAfter ?? 0 });
    } else if (line.startsWith("- ↩")) {
      const suggested = (inbox[k + 1]?.line ?? "").replace(/^\s*Suggested:\s*/, "");
      const link = (inbox[k + 2]?.line ?? "").trim();
      out.push({ kind: "reply", text: line.slice(4), suggested, link: link.startsWith("http") ? link : "" });
      k += 2;
    } else if (line.startsWith("- 💬")) out.push({ kind: "note", text: line.slice(2) });
  }
  return out;
}
