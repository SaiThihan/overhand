/**
 * How far agents may go on a project (config `clients[].autonomy`), as decisions the daemon enforces and the words the
 * agent is told. Pure: callers pass the level.
 */
import { type Autonomy, buildsItself } from "@overhand/contract";

export type { Autonomy };

/** What a level allows. */
export interface AutonomyPolicy {
  /** The agent may change files, commit and push its own branch; off, its CLI runs read-only. */
  write: boolean;
  /** What Overhand does with a finished ticket: open a PR, open a draft PR, or open nothing and report. */
  pr: "open" | "draft" | "none";
  /** Fix rounds on an open agent PR (review feedback, red checks) may run. */
  fix: boolean;
}

/** The decisions for one level; `ship` builds as `act` does (its auto-merge is Overhand's own step, ship.ts). */
export function policyOf(level: Autonomy): AutonomyPolicy {
  if (level === "watch") return { write: false, pr: "none", fix: false };
  if (level === "propose") return { write: true, pr: "draft", fix: true };
  return { write: true, pr: "open", fix: true };
}

/** The level for a project by name; a project the config doesn't list (or no project) acts, as before levels existed. */
export function autonomyOf(clients: readonly { name: string; autonomy: Autonomy }[], project: string): Autonomy {
  return clients.find((c) => c.name === project)?.autonomy ?? "act";
}

/** The `gh pr create` flags a level adds; null when Overhand must not open a PR at all. */
export function prCreateFlags(level: Autonomy): string[] | null {
  const { pr } = policyOf(level);
  return pr === "none" ? null : pr === "draft" ? ["--draft"] : [];
}

/** What a ticket agent is told about the level; empty for `act`, whose workflow is the agent's CLAUDE.md as is. */
export function ticketRules(level: Autonomy): string {
  if (level === "watch")
    return [
      "This project is on watch: investigate and report only. Don't edit files, commit, push or open a PR (your tools are read-only).",
      "Return status done with message = what you found and the change you'd make (files, approach, risks); leave pr_title and pr_body empty.",
    ].join("\n");
  if (level === "propose")
    return "This project is on propose: Overhand opens your PR as a draft and a person marks it ready. Never mark a PR ready yourself.";
  return "";
}

/** What a lead is told about the level; empty for `act`. */
export function leadRules(level: Autonomy): string {
  if (level === "watch")
    return [
      "This project is on watch: you investigate and report, nothing else. Don't edit files, create branches, commit, push, open or update pull requests, or comment anywhere.",
      "Your tools are read-only. End your run with your report as your final message (what you checked, what's wrong, what you'd do); Overhand files it for the owner.",
    ].join("\n");
  if (level === "propose")
    return "This project is on propose: open every pull request as a draft (`gh pr create --draft`), and never mark one ready (`gh pr ready`), approve or merge. A person reviews and marks drafts ready.";
  if (level === "ship")
    return "This project is on Ship: open your pull requests ready for review with `gh pr create`, and run the repo's checks before you push, since they are the proof Overhand puts on the PR. Never merge or turn on auto-merge yourself: once your run ends, Overhand hands each PR to GitHub's auto-merge, which merges it only when every required check passes.";
  return "";
}

/**
 * The level a ticket runs at: the project's own, or for a ticket you assigned an agent to on a watch or propose project,
 * the project's `assignedAutonomy`. Only that ticket: everything else there keeps the project's level.
 */
export function levelFor(c: { autonomy: Autonomy; assignedAutonomy: Autonomy }, assigned: boolean): Autonomy {
  return assigned && !buildsItself(c.autonomy) ? c.assignedAutonomy : c.autonomy;
}

/** The client a ticket runs under: the project's own, or (assigned) a copy at `levelFor`, so env, prompt and PR all follow it. */
export function runAs<C extends { autonomy: Autonomy; assignedAutonomy: Autonomy }>(c: C, assigned: boolean): C {
  const level = levelFor(c, assigned);
  return level === c.autonomy ? c : { ...c, autonomy: level };
}
