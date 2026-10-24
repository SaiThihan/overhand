import { clientOfOrg, shAsync } from "../env";
import type { UiPr } from "./types";

/** GitHub PRs matching a search query, with review and CI state; ones untouched for 90 days are left out. */
export async function githubPrs(query: string): Promise<UiPr[]> {
  const q = `query($q: String!) { search(query: $q, type: ISSUE, first: 50) { nodes { ... on PullRequest {
    number title url isDraft updatedAt reviewDecision repository { nameWithOwner owner { login } }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } }`;
  const r = await shAsync(["gh", "api", "graphql", "-f", `query=${q}`, "-f", `q=${query}`]);
  if (!r.ok) throw new Error(`GitHub: ${r.err.slice(0, 200)}`);
  type Node = {
    number: number;
    title: string;
    url: string;
    isDraft: boolean;
    updatedAt: string;
    reviewDecision: string | null;
    repository: { nameWithOwner: string; owner: { login: string } };
    commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
  };
  // PRs untouched for 90 days are abandoned, not work: keep them off the dashboard
  const nodes = (JSON.parse(r.out) as { data: { search: { nodes: Node[] } } }).data.search.nodes.filter(
    (n) => n.url && Date.now() - Date.parse(n.updatedAt) < 90 * 864e5,
  );
  return nodes.map((n) => ({
    client: clientOfOrg(n.repository.owner.login),
    repo: n.repository.nameWithOwner,
    number: n.number,
    title: n.title,
    url: n.url,
    draft: n.isDraft,
    review: n.reviewDecision ?? "",
    checks: n.commits.nodes[0]?.commit.statusCheckRollup?.state ?? "",
    updated: n.updatedAt,
  }));
}
