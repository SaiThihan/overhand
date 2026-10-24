import { z } from "zod";

/**
 * How far agents may go on a project. `watch`: plan, investigate and report; never change code or open a PR. `propose`:
 * open draft PRs and stop; a person marks them ready. `act`: open PRs ready for review. `ship`: as `act`, then Overhand
 * (never the agent) turns on the code host's own auto-merge once the proof is on the PR, so it merges only when every
 * required check and branch rule passes. Without a required status check on the base branch, with a protected path in
 * the diff, or once the day's Ship cap is reached, the PR stays as on `act`.
 */
export const AUTONOMY_LEVELS = ["watch", "propose", "act", "ship"] as const;
export const AutonomySchema = z.enum(AUTONOMY_LEVELS);
export type Autonomy = z.infer<typeof AutonomySchema>;

/** The levels whose agents build on their own and open PRs ready for review: `act`, and `ship` on top of it. */
export const buildsItself = (level: Autonomy): boolean => level === "act" || level === "ship";

/** What a Ship project leaves out of its `ship` config: workflow files and code owners guard the gate itself. */
export const SHIP_DEFAULTS = { protect: [".github/", "**/CODEOWNERS"], perDay: 5 } as const;
