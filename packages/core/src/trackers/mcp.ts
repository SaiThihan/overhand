/**
 * Linear and Jira through Overhand's own MCP sign-in (mcp.ts): the same operations as the token adapters, as direct tool
 * calls on the official servers. Linear's tool arguments are the server's published input schemas; Atlassian publishes
 * tool names only, so its arguments follow the tools' documented form (cloudId first, then the issue).
 */
import type { Client } from "../config";
import { callTool, field, rows } from "../mcp";
import { fromJira, JIRA_FIELDS, type Jira, type JiraIssue, jiraJql } from "./jira";
import type { Linear } from "./linear";
import type { Query, Ticket } from "./types";

// ---------- Linear ----------

const LINEAR_FIELDS = ["id", "title", "description", "url", "priority", "status", "statusType", "labels"];
const CLOSED = new Set(["completed", "canceled", "duplicate"]);

/** An issue from Linear's MCP tools as a Ticket; comments are filled in separately. */
function fromLinearMcp(c: Client, i: unknown): Ticket {
  const key = field(i, "identifier") || field(i, "id");
  const labels = typeof i === "object" && i !== null && "labels" in i ? rows(i.labels) : [];
  return {
    client: c,
    key,
    id: key, // the tools take the identifier wherever they take an id
    title: field(i, "title"),
    url: field(i, "url"),
    status: field(i, "status") || field(i, "state"),
    statusType: field(i, "statusType"),
    priority: field(i, "priority") || field(i, "priorityLabel"),
    labels: labels.map((l) => (typeof l === "string" ? l : field(l, "name"))).filter(Boolean),
    description: field(i, "description"),
    comments: [],
  };
}

async function linearComments(key: string): Promise<string[]> {
  const r = await callTool("linear", "list_comments", { issueId: key, limit: 10, orderBy: "createdAt" });
  return rows(r.data)
    .map((n) => ({ at: field(n, "createdAt"), line: `${field(n, "author") || field(n, "user") || "?"}: ${field(n, "body")}` }))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((n) => n.line);
}

/** Open Linear issues over MCP: one by key, the ones assigned to you, or the ones with a label; each with its last comments. */
export async function linearMcpTickets(c: Client, _t: Linear, q: Query): Promise<Ticket[]> {
  const found =
    "key" in q
      ? [(await callTool("linear", "get_issue", { id: q.key, fields: LINEAR_FIELDS })).data]
      : rows(
          (
            await callTool("linear", "list_issues", {
              ...("mine" in q ? { assignee: "me" } : { label: q.label }),
              limit: 50,
              fields: LINEAR_FIELDS,
            })
          ).data,
        );
  const open = found.map((i) => fromLinearMcp(c, i)).filter((t) => t.key && ("key" in q || !CLOSED.has(t.statusType)));
  // ponytail: one comments call per issue, all at once; batch them if a long list ever hits Linear's rate limit
  await Promise.all(open.map(async (t) => (t.comments = await linearComments(t.key).catch(() => []))));
  return open;
}

/** Adds and removes labels on a Linear issue; a label Linear doesn't have yet is created first. */
export async function linearMcpSetLabels(tk: Ticket, add: string[], remove: string[]): Promise<void> {
  const args = {
    id: tk.key,
    addLabels: add.filter((l) => !tk.labels.includes(l)),
    removeLabels: remove.filter((l) => tk.labels.includes(l)),
  };
  if (!args.addLabels.length && !args.removeLabels.length) return;
  try {
    await callTool("linear", "save_issue", args);
  } catch (e) {
    if (!args.addLabels.length) throw e;
    for (const name of args.addLabels) await callTool("linear", "create_issue_label", { name, color: "#D97757" }).catch(() => undefined);
    await callTool("linear", "save_issue", args);
  }
}

/** Posts a comment on a Linear issue. */
export async function linearMcpComment(tk: Ticket, text: string): Promise<void> {
  await callTool("linear", "save_comment", { issueId: tk.key, body: text });
}

/** Files an issue in the team whose key is the client's prefix, assigned to you, and returns its identifier. */
export async function linearMcpCreateTicket(c: Client, title: string, body: string, label: string): Promise<string> {
  const r = await callTool("linear", "save_issue", { team: c.prefix, title, description: body, assignee: "me", labels: [label] });
  const key = field(r.data, "identifier") || field(r.data, "id") || (r.text.match(/\b[A-Z][A-Z0-9]*-\d+\b/)?.[0] ?? "");
  if (!key) throw new Error("Linear created the issue but didn't say its key");
  return key;
}

// ---------- Jira ----------

const cloudIds = new Map<string, string>();

/** The Atlassian cloud id of the Jira site, from the sites this sign-in can reach. */
async function cloudId(t: Jira): Promise<string> {
  const known = cloudIds.get(t.site);
  if (known) return known;
  const sites = rows((await callTool("jira", "getAccessibleAtlassianResources", {})).data);
  const site = sites.find((s) => URL.parse(field(s, "url"))?.host === t.site);
  const id = site ? field(site, "id") : "";
  if (!id) throw new Error(`Jira: this sign-in can't reach ${t.site}`);
  cloudIds.set(t.site, id);
  return id;
}

const isJiraIssue = (x: unknown): x is JiraIssue =>
  typeof x === "object" && x !== null && "key" in x && "fields" in x && typeof x.fields === "object" && x.fields !== null;

/** Open Jira issues over MCP, by the same JQL as the token adapter. */
export async function jiraMcpTickets(c: Client, t: Jira, q: Query): Promise<Ticket[]> {
  const r = await callTool("jira", "searchJiraIssuesUsingJql", {
    cloudId: await cloudId(t),
    jql: jiraJql(t, q),
    fields: JIRA_FIELDS,
    maxResults: 100,
  });
  return rows(r.data)
    .filter(isJiraIssue)
    .map((i) => fromJira(c, t, i));
}

/** Sets a Jira issue's labels to what they are after the change. */
export async function jiraMcpSetLabels(t: Jira, tk: Ticket, add: string[], remove: string[]): Promise<void> {
  const labels = [...tk.labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !tk.labels.includes(l))];
  await callTool("jira", "editJiraIssue", { cloudId: await cloudId(t), issueIdOrKey: tk.key, fields: { labels } });
}

/** Posts a comment on a Jira issue. */
export async function jiraMcpComment(t: Jira, tk: Ticket, text: string): Promise<void> {
  await callTool("jira", "addOrEditJiraIssueComment", { cloudId: await cloudId(t), issueIdOrKey: tk.key, commentBody: text });
}

/** Files a Task in the project with one label and returns its key. */
export async function jiraMcpCreateTicket(t: Jira, title: string, body: string, label: string): Promise<string> {
  const r = await callTool("jira", "createJiraIssue", {
    cloudId: await cloudId(t),
    projectKey: t.project,
    issueTypeName: "Task",
    summary: title,
    description: body,
    additional_fields: { labels: [label] },
  });
  const key = field(r.data, "key") || (r.text.match(new RegExp(`\\b${t.project}-\\d+\\b`))?.[0] ?? "");
  if (!key) throw new Error("Jira created the issue but didn't say its key");
  return key;
}
