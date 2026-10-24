/** Tracker-agnostic ticket operations: one adapter per client, by its tracker and by what's connected. */
import { withMark } from "@overhand/contract";
import { holdFinding } from "../assign";
import type { Client } from "../config";
import { CFG, LABEL, sh } from "../env";
import { connected } from "../mcp";
import { cleared, HeldError, holdLeak, scanOutward } from "../outward";
import { githubComment, githubCreateTicket, githubOwnerLabelled, githubSetLabels, githubTickets } from "./github";
import { jiraComment, jiraCreateTicket, jiraSetLabels, jiraTickets } from "./jira";
import { linearComment, linearCreateTicket, linearOwnerLabelled, linearSetLabels, linearTickets } from "./linear";
import {
  jiraMcpComment,
  jiraMcpCreateTicket,
  jiraMcpSetLabels,
  jiraMcpTickets,
  linearMcpComment,
  linearMcpCreateTicket,
  linearMcpSetLabels,
  linearMcpTickets,
} from "./mcp";
import type { Query, Ticket } from "./types";

export type { Query, Ticket } from "./types";

/** One client's ticket operations, and how they reach the tracker. */
export interface TrackerAdapter {
  via: "gh" | "mcp" | "token" | "none";
  tickets(q: Query): Promise<Ticket[]>;
  setLabels(tk: Ticket, add: string[], remove: string[]): Promise<void>;
  comment(tk: Ticket, text: string): Promise<void>;
  create(title: string, body: string, label: string): Promise<string>;
}

/**
 * The adapter for a client: GitHub Issues through `gh`; Linear and Jira through Overhand's MCP sign-in when it's
 * connected, else through the project's API token. A project with no tracker has no tickets and nothing to write to.
 */
export function adapterOf(c: Client): TrackerAdapter {
  const t = c.tracker;
  if (!t)
    return {
      via: "none",
      tickets: async () => [],
      setLabels: async () => {},
      comment: async () => {},
      create: async () => {
        throw new Error(`${c.name} has no tracker to file a ticket in`);
      },
    };
  if (t.kind === "github")
    return {
      via: "gh",
      tickets: (q) => githubTickets(c, t, q),
      setLabels: (tk, a, r) => githubSetLabels(t, tk, a, r),
      comment: (tk, x) => githubComment(t, tk, x),
      create: (ti, b, l) => githubCreateTicket(c, t, ti, b, l),
    };
  if (t.kind === "linear")
    return connected("linear")
      ? {
          via: "mcp",
          tickets: (q) => linearMcpTickets(c, t, q),
          setLabels: linearMcpSetLabels,
          comment: linearMcpComment,
          create: (ti, b, l) => linearMcpCreateTicket(c, ti, b, l),
        }
      : {
          via: "token",
          tickets: (q) => linearTickets(c, t, q),
          setLabels: (tk, a, r) => linearSetLabels(t, tk, a, r),
          comment: (tk, x) => linearComment(t, tk, x),
          create: (ti, b, l) => linearCreateTicket(c, t, ti, b, l),
        };
  return connected("jira")
    ? {
        via: "mcp",
        tickets: (q) => jiraMcpTickets(c, t, q),
        setLabels: (tk, a, r) => jiraMcpSetLabels(t, tk, a, r),
        comment: (tk, x) => jiraMcpComment(t, tk, x),
        create: (ti, b, l) => jiraMcpCreateTicket(t, ti, b, l),
      }
    : {
        via: "token",
        tickets: (q) => jiraTickets(c, t, q),
        setLabels: (tk, a, r) => jiraSetLabels(t, tk, a, r),
        comment: (tk, x) => jiraComment(t, tk, x),
        create: (ti, b, l) => jiraCreateTicket(t, ti, b, l),
      };
}

/** Fetches open tickets for a client by label, by "assigned to me", or a single ticket by key. */
export async function tickets(c: Client, q: Query): Promise<Ticket[]> {
  return adapterOf(c).tickets(q);
}

/**
 * Who a tracker write is for: Overhand on its own (`auto`), or you, from a button you pressed on the dashboard (`owner`).
 * On a watch project nothing `auto` reaches the tracker.
 */
export type WriteBy = "auto" | "owner";

/**
 * Whether Overhand may write to a ticket's tracker on its own: never on a watch project (its clients read the tracker,
 * and you decide what they see), and never for a task with no ticket. A ticket you assigned an agent to runs under its
 * assigned level (assign.ts runClient), so its own PR comment and labels go through.
 */
export const mayPost = (tk: Pick<Ticket, "client" | "local">): boolean => !tk.local && tk.client.autonomy !== "watch";

/**
 * Adds and removes labels on a ticket (creating missing labels) and mirrors the change on tk.labels. Skipped (nothing
 * written, nothing mirrored) when Overhand may not post there on its own.
 */
export async function setLabels(tk: Ticket, add: string[], remove: string[], by: WriteBy = "auto"): Promise<void> {
  if (tk.local || (by === "auto" && !mayPost(tk))) return;
  await adapterOf(tk.client).setLabels(tk, add, remove);
  tk.labels = [...tk.labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !tk.labels.includes(l))];
}

/**
 * Posts a comment on a ticket. On GitHub Issues it carries the invisible `<!-- overhand -->` marker, so nothing
 * Overhand says as you is ever read back as your feedback; Linear and Jira would show the marker as text, and nothing
 * learns from their comments. Where Overhand may not post on its own, the comment is held for you as a finding
 * (dashboard: Post it, Assign an agent) instead. Everything else goes through the outward firewall first (`checked`:
 * you released it): a leak is held with its spans marked. True when it was posted.
 */
export async function comment(tk: Ticket, text: string, by: WriteBy = "auto", checked = false): Promise<boolean> {
  if (tk.local || (by === "auto" && !mayPost(tk))) {
    holdFinding({
      project: tk.client.name,
      key: tk.local ? "" : tk.key,
      title: tk.local ? tk.title : `${tk.key}: ${tk.title}`,
      text,
      post: tk.local ? "" : text,
      from: "agent",
    });
    return false;
  }
  const out = { kind: "comment", project: tk.client.name, dest: `${tk.client.name} tracker, ${tk.key}`, key: tk.key } as const;
  if (!checked && !cleared({ ...out, title: `${tk.key}: ${tk.title}`, text, payload: { key: tk.key } })) return false;
  await adapterOf(tk.client).comment(tk, tk.client.tracker?.kind === "github" ? withMark(text) : text);
  return true;
}

/**
 * Your answer to a ticket's question, picked on its decision card, through the outward gate: where Overhand may post
 * (act, propose) it goes on the ticket in your words, marked as sent through Overhand, and the ticket goes back in the
 * agents' queue; on watch it's held for you instead (Post it sends it) and nothing reaches the tracker.
 */
export async function answerTicket(tk: Ticket, text: string): Promise<"posted" | "held"> {
  if (!(await comment(tk, `${text}\n\n_(answered through Overhand)_`)) || !mayPost(tk)) return "held";
  await setLabels(tk, [LABEL.queue], [LABEL.blocked]);
  return "posted";
}

/** Throws when Overhand may not file a ticket in a project's tracker: on its own on a watch project. */
export function assertMayFile(c: Pick<Client, "name" | "autonomy">, by: WriteBy): void {
  if (by === "auto" && c.autonomy === "watch")
    throw new Error(`${c.name} is on Plan and warn only: Overhand files no tickets there on its own`);
}

/** Files a ticket assigned to you in the client's tracker, with one label, and returns its key. Never on its own on watch. */
export async function createTicket(
  c: Client,
  title: string,
  body: string,
  label: string,
  by: WriteBy = "auto",
  checked = false,
): Promise<string> {
  assertMayFile(c, by);
  if (checked) return adapterOf(c).create(title, body, label);
  const held = { kind: "ticket", project: c.name, dest: `${c.name} tracker, a new ticket`, payload: { label } } as const;
  const text = `${title}\n\n${body}`;
  const hits = scanOutward(text, [c.name]);
  if (hits.length) throw new HeldError(holdLeak({ ...held, title: `New ticket: ${title}`, text }, hits));
  return adapterOf(c).create(title, body, label);
}

let ghLogin = "";
/** Your GitHub login: config owner.githubLogin, else the login `gh` is signed in as (cached once known). */
function ownerLogin(): string {
  ghLogin ||= CFG.owner.githubLogin || sh(["gh", "api", "user", "-q", ".login"]).out.trim();
  return ghLogin;
}

/**
 * Whether you added the queue label to a ticket yourself: GitHub from the issue timeline, Linear (API token) from the
 * issue history. Jira and Linear through MCP can't say who added a label, so there it's never you: assign from the
 * dashboard instead. Errors read as not you.
 */
export async function labelledByOwner(tk: Ticket, label: string): Promise<boolean> {
  const t = tk.client.tracker;
  try {
    if (t?.kind === "github") return await githubOwnerLabelled(t, tk, label, ownerLogin());
    if (t?.kind === "linear" && !connected("linear")) return await linearOwnerLabelled(t, tk, label);
  } catch {
    return false;
  }
  return false;
}

/** Your tickets plus the ones labelled for the agent, each once. */
export async function myAndQueued(c: Client): Promise<Ticket[]> {
  const [mine, queued] = await Promise.all([tickets(c, { mine: true }), tickets(c, { label: LABEL.queue })]);
  const seen = new Set(mine.map((t) => t.key));
  return [...mine, ...queued.filter((t) => !seen.has(t.key))];
}
