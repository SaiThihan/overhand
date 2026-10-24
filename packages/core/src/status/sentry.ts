import { clientByText, http, statusTokens } from "../env";
import { callTool, connected, field, rows } from "../mcp";
import type { UiIssue } from "./types";

/**
 * Issues from the Sentry MCP server's `search_issues` answer, which is markdown (getsentry's formatIssueResults): a
 * `## n. [SHORT-ID](url)` heading per issue, its title in bold, then `- **Users**: n`, `- **Events**: n` and
 * `- **First seen**: 5 hours ago`. It carries no level, so every issue counts as an error.
 */
export function parseSentryIssues(md: string, org: string): UiIssue[] {
  return md
    .split(/^## \d+\. /m)
    .slice(1)
    .flatMap((b) => {
      const head = b.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
      if (!head?.[1] || !head[2]) return [];
      const num = (label: string) => Number(b.match(new RegExp(`\\*\\*${label}\\*\\*: (\\d+)`))?.[1] ?? 0);
      const first = b.match(/\*\*First seen\*\*: (.+)/)?.[1] ?? "";
      return [
        {
          client: clientByText(`${org} ${head[1]}`),
          id: head[1],
          title: b.match(/^\*\*(.+)\*\*\s*$/m)?.[1] ?? head[1],
          count: num("Events"),
          users: num("Users"),
          isNew: /minute|hour/.test(first),
          level: "error",
          url: head[2],
        },
      ];
    });
}

/** Unresolved issues of the last 24h through Overhand's Sentry MCP sign-in, across every org it can see. */
async function sentryMcpIssues(): Promise<UiIssue[]> {
  const orgs = rows((await callTool("sentry", "find_organizations", {})).data);
  const out: UiIssue[] = [];
  for (const o of orgs) {
    const slug = field(o, "slug");
    if (!slug) continue;
    const r = await callTool("sentry", "search_issues", {
      organizationSlug: slug,
      regionUrl: field(o, "regionUrl") || null,
      query: "is:unresolved",
      period: "24h",
      sort: "freq",
      limit: 6,
    }).catch(() => null);
    if (r) out.push(...parseSentryIssues(r.text, slug));
  }
  return out;
}

/** Unresolved Sentry issues seen in the last 24h: through the MCP sign-in when connected, else every org the tokens see. */
export async function sentryIssues(): Promise<UiIssue[] | string> {
  if (connected("sentry")) return sentryMcpIssues();
  const tokens = statusTokens("sentrySecrets");
  if (!tokens.length) return "Connect Sentry in Settings to show production errors";
  const out: UiIssue[] = [];
  const seenOrgs = new Set<string>();
  for (const { token, client } of tokens) {
    const h = { headers: { Authorization: `Bearer ${token}` } };
    const orgs = await http<{ slug: string; name: string; links?: { regionUrl?: string } }[]>("https://sentry.io/api/0/organizations/", h);
    for (const o of orgs.filter((x) => !seenOrgs.has(x.slug))) {
      seenOrgs.add(o.slug);
      const base = o.links?.regionUrl ?? "https://sentry.io";
      const issues = await http<
        {
          shortId: string;
          title: string;
          count: string;
          userCount: number;
          firstSeen: string;
          level: string;
          permalink: string;
          project: { slug: string };
        }[]
      >(`${base}/api/0/organizations/${o.slug}/issues/?query=is:unresolved&statsPeriod=24h&sort=freq&limit=6`, h).catch(() => []);
      for (const i of issues) {
        out.push({
          client: client || clientByText(`${o.slug} ${o.name} ${i.project.slug}`),
          id: i.shortId,
          title: i.title,
          count: Number(i.count),
          users: i.userCount,
          isNew: Date.now() - Date.parse(i.firstSeen) < 864e5,
          level: i.level,
          url: i.permalink,
        });
      }
    }
  }
  return out;
}
