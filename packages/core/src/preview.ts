import { shAsync } from "./env";

/** A GitHub deployment's latest status, as `repos/{repo}/deployments/{id}/statuses` lists it (newest first). */
export interface DeployStatus {
  state: string;
  environment_url?: string;
  target_url?: string;
}

/** A commit status, as `repos/{repo}/commits/{sha}/status` lists it. */
export interface CommitStatus {
  state: string;
  context: string;
  target_url?: string | null;
}

/** Contexts of commit statuses that point at a running preview (Netlify posts one; others use deployments). */
const PREVIEW_CONTEXT = /preview|netlify|deploy/i;

/**
 * Where a PR can be seen running, from what its head commit already reports: a successful non-production deployment's
 * URL first (Vercel, Cloudflare and Render post these), then a successful preview-like commit status (Netlify). "" = none yet.
 * `deployments` pairs each deployment's environment with its statuses, newest deployment first.
 */
export function pickPreview(deployments: { environment: string; statuses: DeployStatus[] }[], statuses: CommitStatus[]): string {
  for (const d of deployments) {
    if (/^prod/i.test(d.environment)) continue;
    const ok = d.statuses.find((s) => s.state === "success");
    const url = ok?.environment_url || ok?.target_url || "";
    if (/^https:\/\//.test(url)) return url;
  }
  const s = statuses.find((x) => x.state === "success" && PREVIEW_CONTEXT.test(x.context) && /^https:\/\//.test(x.target_url ?? ""));
  return s?.target_url ?? "";
}

const ghJson = async <T>(path: string, fallback: T): Promise<T> => {
  const r = await shAsync(["gh", "api", path]);
  try {
    return r.out ? (JSON.parse(r.out) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** The preview URL GitHub knows for `sha` in `repo` (owner/name), or "". Read-only; never throws. */
export async function previewOf(repo: string, sha: string): Promise<string> {
  // ponytail: the 5 newest deployments for the commit; enough for one PR head, page further if a repo deploys more per commit
  const ds = await ghJson<{ id: number; environment: string }[]>(`repos/${repo}/deployments?sha=${sha}&per_page=5`, []);
  const deployments = await Promise.all(
    ds.map(async (d) => ({
      environment: d.environment,
      statuses: await ghJson<DeployStatus[]>(`repos/${repo}/deployments/${d.id}/statuses`, []),
    })),
  );
  const combined = await ghJson<{ statuses?: CommitStatus[] }>(`repos/${repo}/commits/${sha}/status`, {});
  return pickPreview(deployments, combined.statuses ?? []);
}
