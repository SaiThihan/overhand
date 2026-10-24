/** GitHub Issues tracker, through the `gh` CLI. */
import type { Client } from "../config";
import { shAsync } from "../env";
import type { Query, Ticket } from "./types";

export type GitHubIssues = Extract<Client["tracker"], { kind: "github" }>;

interface GhIssue {
  number: number;
  title: string;
  url: string;
  body: string;
  state: string;
  labels: { name: string }[];
  comments: { author: { login: string } | null; body: string }[];
}
const GH_FIELDS = "number,title,url,body,state,labels,comments";

/** Runs a `gh` subcommand against a tracker repo and parses its JSON output. */
async function gh<T>(t: GitHubIssues, args: string[]): Promise<T> {
  const r = await shAsync(["gh", ...args, "-R", t.repo]);
  if (!r.ok) throw new Error(`gh ${args.slice(0, 2).join(" ")} on ${t.repo}: ${r.err.slice(0, 200)}`);
  return JSON.parse(r.out || "null") as T;
}

function fromGithub(c: Client, i: GhIssue): Ticket {
  return {
    client: c,
    key: `${c.prefix}-${i.number}`,
    id: String(i.number),
    title: i.title,
    url: i.url,
    status: i.state,
    statusType: i.state === "CLOSED" ? "completed" : "started",
    priority: "",
    labels: i.labels.map((l) => l.name),
    description: i.body ?? "",
    comments: i.comments.map((x) => `${x.author?.login ?? "someone"}: ${x.body}`),
  };
}

/** GitHub issues: one by key, the open ones assigned to you, or the open ones with a label. */
export async function githubTickets(c: Client, t: GitHubIssues, q: Query): Promise<Ticket[]> {
  if ("key" in q) return [fromGithub(c, await gh<GhIssue>(t, ["issue", "view", q.key.split("-").pop() ?? "", "--json", GH_FIELDS]))];
  const filter = "mine" in q ? ["--assignee", "@me"] : ["--label", q.label];
  return (await gh<GhIssue[]>(t, ["issue", "list", "--state", "open", "--limit", "100", ...filter, "--json", GH_FIELDS])).map((i) =>
    fromGithub(c, i),
  );
}

/** Adds and removes labels on a GitHub issue, creating missing labels first. */
export async function githubSetLabels(t: GitHubIssues, tk: Ticket, add: string[], remove: string[]): Promise<void> {
  const adding = add.filter((x) => !tk.labels.includes(x));
  const removing = remove.filter((x) => tk.labels.includes(x));
  for (const l of adding) await shAsync(["gh", "label", "create", l, "--color", "D97757", "--force", "-R", t.repo]); // create if missing
  if (adding.length || removing.length) {
    const args = [
      "issue",
      "edit",
      tk.id,
      ...(adding.length ? ["--add-label", adding.join(",")] : []),
      ...(removing.length ? ["--remove-label", removing.join(",")] : []),
    ];
    const r = await shAsync(["gh", ...args, "-R", t.repo]);
    if (!r.ok) throw new Error(`gh issue edit ${tk.key}: ${r.err.slice(0, 200)}`);
  }
}

/** Posts a comment on a GitHub issue. */
export async function githubComment(t: GitHubIssues, tk: Ticket, text: string): Promise<void> {
  const r = await shAsync(["gh", "issue", "comment", tk.id, "--body", text, "-R", t.repo]);
  if (!r.ok) throw new Error(`gh issue comment ${tk.key}: ${r.err.slice(0, 200)}`);
}

/** Files an issue assigned to you and returns its key (prefix-number). */
export async function githubCreateTicket(c: Client, t: GitHubIssues, title: string, body: string, label: string): Promise<string> {
  await shAsync(["gh", "label", "create", label, "--color", "D97757", "--force", "-R", t.repo]);
  const r = await shAsync(["gh", "issue", "create", "--title", title, "--body", body, "--label", label, "--assignee", "@me", "-R", t.repo]);
  if (!r.ok) throw new Error(`gh issue create: ${r.err.slice(0, 200)}`);
  return `${c.prefix}-${r.out.trim().split("/").pop()}`;
}

/** A `labeled` event from an issue's timeline: the label and who added it. */
export interface LabelEvent {
  label: string;
  actor: string;
}

/**
 * Whether the newest time `label` went onto an issue, `owner` added it. Anyone else (a client's teammate, a bot) adding
 * the queue label must never count as you assigning an agent. Case-insensitive, like GitHub logins.
 */
export function ownerAddedLabel(events: readonly LabelEvent[], label: string, owner: string): boolean {
  const last = events.filter((e) => e.label === label).at(-1);
  return Boolean(owner) && last?.actor.toLowerCase() === owner.toLowerCase();
}

/** Whether `owner` added `label` to a GitHub issue (its timeline's newest labeled event for it). */
export async function githubOwnerLabelled(t: GitHubIssues, tk: Ticket, label: string, owner: string): Promise<boolean> {
  const r = await shAsync([
    "gh",
    "api",
    "--paginate",
    `repos/${t.repo}/issues/${tk.id}/timeline`,
    "--jq",
    '.[] | select(.event == "labeled") | {label: .label.name, actor: (.actor.login // "")}',
  ]);
  if (!r.ok) throw new Error(`gh api timeline ${tk.key}: ${r.err.slice(0, 200)}`);
  const events = r.out
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LabelEvent);
  return ownerAddedLabel(events, label, owner);
}
