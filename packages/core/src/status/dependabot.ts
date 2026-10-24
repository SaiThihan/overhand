/** Open security advisories: GitHub's own Dependabot alerts on each project's active GitHub repos, read with the person's gh. */
import type { Advisory } from "@overhand/contract";
import { activeRepos } from "../agent";
import { CLIENTS, shAsync } from "../env";
import type { Run } from "../ship";
import { githubSlug } from "../ship";

/** One Dependabot alert line from `gh api --jq`: only the fields an advisory keeps. */
const JQ =
  '.[] | {number, url: .html_url, package: .dependency.package.name, ecosystem: .dependency.package.ecosystem, severity: .security_advisory.severity, summary: .security_advisory.summary, fix: (.security_vulnerability.first_patched_version.identifier // "")}';

/**
 * A repo's open Dependabot alerts. Alerts switched off, or no access to them (GitHub answers 403 or 404), is no
 * advisory work there, not an error; any other failure throws, so the status keeps its last list and says why.
 */
export async function repoAdvisories(client: string, slug: string, run: Run = shAsync): Promise<Advisory[]> {
  const r = await run(["gh", "api", "--paginate", `repos/${slug}/dependabot/alerts?state=open&per_page=100`, "--jq", JQ]);
  if (!r.ok) {
    if (/HTTP 40[34]\b/.test(r.err)) return [];
    throw new Error(`${slug}: ${r.err.trim().split("\n")[0] ?? "gh failed"}`);
  }
  const repo = slug.split("/").pop() ?? slug;
  return r.out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const a = JSON.parse(line) as Partial<Record<"package" | "ecosystem" | "severity" | "summary" | "fix" | "url", string>> & {
        number?: number;
      };
      return {
        client,
        repo,
        number: a.number ?? 0,
        package: a.package ?? "",
        ecosystem: a.ecosystem ?? "",
        severity: a.severity ?? "",
        summary: a.summary ?? "",
        fix: a.fix ?? "",
        url: a.url ?? "",
      };
    });
}

/** Every project's open advisories, from its active repos on GitHub (others have no Dependabot). */
export async function dependabotAlerts(): Promise<Advisory[]> {
  const out: Advisory[] = [];
  for (const c of CLIENTS)
    for (const repo of activeRepos(c)) {
      const slug = githubSlug((await shAsync(["git", "remote", "get-url", "origin"], repo)).out);
      if (slug) out.push(...(await repoAdvisories(c.name, slug)));
    }
  return out;
}
