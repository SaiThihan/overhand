import { activeRepos } from "../agent";
import { CLIENTS, shAsync } from "../env";
import { jenkinsJobs, jenkinsState } from "./jenkins";
import type { UiCi } from "./types";

/** Latest CI result on each active repo's base branch (develop if it exists, else the default branch). */
export async function ciHealth(): Promise<UiCi[]> {
  const out: UiCi[] = [];
  for (const c of CLIENTS) {
    const JENKINS = c.status.jenkins;
    const jenkins = JENKINS ? await jenkinsJobs(JENKINS).catch(() => null) : null;
    for (const job of jenkins?.plain ?? []) {
      if (!job.lastBuild) continue;
      const state = jenkinsState(job.lastBuild);
      out.push({
        client: c.name,
        repo: job.name,
        branch: "",
        state,
        failing: state === "fail" ? [job.name] : [],
        url: job.lastBuild.url,
      });
    }
    for (const repo of activeRepos(c)) {
      const remote = (await shAsync(["git", "remote", "get-url", "origin"], repo)).out;
      const slug = remote.replace(/\.git$/, "").replace(/^.*[:/]([^/]+\/[^/]+)$/, "$1");
      const hasDevelop = (await shAsync(["git", "rev-parse", "-q", "--verify", "origin/develop"], repo)).ok;
      const branch = hasDevelop
        ? "develop"
        : (await shAsync(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repo)).out.replace(/^origin\//, "") || "main";
      const name = slug.split("/").pop() ?? slug;
      try {
        if (remote.includes("github.com")) {
          const r = await shAsync([
            "gh",
            "run",
            "list",
            "-R",
            slug,
            "-b",
            branch,
            "-L",
            "15",
            "--json",
            "conclusion,status,workflowName,url",
          ]);
          const runs = JSON.parse(r.out || "[]") as { conclusion: string; status: string; workflowName: string; url: string }[];
          const latest = new Map<string, (typeof runs)[number]>();
          for (const run of runs) if (!latest.has(run.workflowName)) latest.set(run.workflowName, run);
          const all = [...latest.values()];
          const failing = all.filter((x) => ["failure", "timed_out", "startup_failure"].includes(x.conclusion));
          out.push({
            client: c.name,
            repo: name,
            branch,
            state: !all.length ? "none" : failing.length ? "fail" : all.some((x) => x.status !== "completed") ? "running" : "pass",
            failing: failing.map((x) => x.workflowName),
            url: failing[0]?.url ?? all[0]?.url ?? `https://github.com/${slug}/actions`,
          });
        } else if (remote.includes("bitbucket.org") && JENKINS) {
          // Bitbucket repos build on the project's Jenkins, one multibranch job per repo
          const branches = jenkins?.repos.get(name.toLowerCase()) ?? [];
          const job = branches.find((b) => b.name === branch) ?? branches.find((b) => ["develop", "master", "main"].includes(b.name));
          const state = jenkinsState(job?.lastBuild ?? null);
          out.push({
            client: c.name,
            repo: name,
            branch: job?.name ?? branch,
            state,
            failing: state === "fail" ? [`${name} ${job?.name ?? ""}`.trim()] : [],
            url: job?.lastBuild?.url ?? `${JENKINS.url}/job/${JENKINS.orgFolder}/job/${name}/`,
          });
        }
      } catch {
        out.push({ client: c.name, repo: name, branch, state: "none", failing: [], url: "" });
      }
    }
  }
  return out;
}
