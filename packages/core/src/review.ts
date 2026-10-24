/** Reviewing an agent PR from the dashboard: read it with its diff, mark it ready (and approve), or close it. Never merge. */
import type { PrReview } from "@overhand/contract";
import { findCorners } from "./corners";
import { sh } from "./env";
import type { TrackedPr } from "./state";
import { status } from "./status/index";

/** The most diff the drawer gets; past it the text is cut at a line and marked truncated. */
const MAX_DIFF = 600_000;

/** The diff cut to `max` characters at a line boundary, and whether it was cut. */
export function capDiff(diff: string, max = MAX_DIFF): { diff: string; truncated: boolean } {
  if (diff.length <= max) return { diff, truncated: false };
  const cut = diff.slice(0, max);
  return { diff: cut.slice(0, Math.max(0, cut.lastIndexOf("\n"))), truncated: true };
}

/** The signed-in GitHub account Overhand acts as; "" when gh can't say. */
const viewer = (): string => sh(["gh", "api", "user", "-q", ".login"]).out.trim();

/** An agent PR as the Review drawer shows it: what it says, its checks and its diff, read through `gh`. */
export function readPr(key: string, pr: TrackedPr): PrReview {
  const target = ["-R", pr.repo];
  const view = sh(["gh", "pr", "view", String(pr.number), ...target, "--json", "title,body,author,isDraft,state,statusCheckRollup"]);
  if (!view.ok) throw new Error(`gh pr view: ${view.err.slice(0, 200)}`);
  const v = JSON.parse(view.out || "{}") as {
    title?: string;
    body?: string;
    author?: { login?: string };
    isDraft?: boolean;
    state?: string;
    statusCheckRollup?: { name?: string; context?: string; conclusion?: string; state?: string; status?: string }[];
  };
  const diff = sh(["gh", "pr", "diff", String(pr.number), ...target]);
  if (!diff.ok) throw new Error(`gh pr diff: ${diff.err.slice(0, 200)}`);
  return {
    key,
    url: pr.url,
    repo: pr.repo,
    number: pr.number,
    title: v.title ?? "",
    body: v.body ?? "",
    author: v.author?.login ?? "",
    viewer: viewer(),
    draft: v.isDraft ?? false,
    state: v.state ?? "",
    checks: (v.statusCheckRollup ?? []).map((c) => ({
      name: c.name ?? c.context ?? "check",
      state: c.conclusion || c.state || c.status || "",
    })),
    ...capDiff(diff.out),
    corners: findCorners(diff.out), // read from the whole diff, even when the drawer shows it cut
  };
}

/**
 * Marks a draft ready for review, and approves it when you aren't its author (GitHub refuses an approval of your own PR,
 * which is the usual case: Overhand opens PRs as you). Returns whether it approved.
 */
export function markReady(pr: TrackedPr): { approved: boolean } {
  const target = ["-R", pr.repo];
  const author = sh(["gh", "pr", "view", String(pr.number), ...target, "--json", "author", "-q", ".author.login"]).out.trim();
  const ready = sh(["gh", "pr", "ready", String(pr.number), ...target]);
  if (!ready.ok && !/already .*ready/i.test(ready.err)) throw new Error(`gh pr ready: ${ready.err.slice(0, 200)}`);
  const mine = viewer();
  let approved = false;
  if (author && mine && author !== mine) {
    const r = sh(["gh", "pr", "review", String(pr.number), ...target, "--approve"]);
    if (!r.ok) throw new Error(`Marked ready, but approving failed: ${r.err.slice(0, 200)}`);
    approved = true;
  }
  // the dashboard reads drafts from the last status refresh; don't wait three minutes for it to notice
  for (const p of status.myPrs) if (p.url === pr.url) p.draft = false;
  return { approved };
}

/** Closes the PR (its branch stays). The work pass then sees it closed and tidies the ticket's labels. */
export function closePr(pr: TrackedPr): void {
  const r = sh(["gh", "pr", "close", String(pr.number), "-R", pr.repo]);
  if (!r.ok) throw new Error(`gh pr close: ${r.err.slice(0, 200)}`);
}
