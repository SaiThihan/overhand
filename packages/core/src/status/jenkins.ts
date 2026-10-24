import type { Client } from "../config";
import { basic, http, secret } from "../env";
import type { UiCi } from "./types";

export interface JenkinsBuild {
  result: string | null;
  building: boolean;
  url: string;
}
export interface JenkinsJob {
  name: string;
  lastBuild: JenkinsBuild | null;
  jobs?: JenkinsJob[];
}

/** A project's Jenkins: per-repo branch builds from its organization folder, plus the jobs in its plain folders. */
export async function jenkinsJobs(
  JENKINS: NonNullable<Client["status"]["jenkins"]>,
): Promise<{ repos: Map<string, JenkinsJob[]>; plain: JenkinsJob[] } | null> {
  let token = "";
  try {
    token = secret(JENKINS.secret);
  } catch {
    return null;
  }
  const h = { headers: { Authorization: basic(JENKINS.user, token) } };
  const build = "lastBuild%5Bresult,building,url%5D";
  const org = await http<{ jobs: JenkinsJob[] }>(
    `${JENKINS.url}/job/${encodeURIComponent(JENKINS.orgFolder)}/api/json?tree=jobs%5Bname,jobs%5Bname,${build}%5D%5D`,
    h,
  );
  const plain = await Promise.all(
    JENKINS.jobFolders.map((f) =>
      http<{ jobs: JenkinsJob[] }>(`${JENKINS.url}/job/${encodeURIComponent(f)}/api/json?tree=jobs%5Bname,${build}%5D`, h)
        .then((r) => r.jobs.map((j) => ({ ...j, name: `${f} ${j.name}` })))
        .catch(() => []),
    ),
  );
  return { repos: new Map(org.jobs.map((j) => [j.name.toLowerCase(), j.jobs ?? []])), plain: plain.flat() };
}

/** A Jenkins build as a dashboard CI state. */
export function jenkinsState(b: JenkinsBuild | null): UiCi["state"] {
  if (!b) return "none";
  if (b.building) return "running";
  return b.result === "SUCCESS" ? "pass" : b.result === "FAILURE" || b.result === "UNSTABLE" ? "fail" : "none";
}
