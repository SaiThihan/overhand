#!/usr/bin/env bun
/**
 * Ops orchestrator across all clients. First run: `bun run setup` writes overhand.config.json and checks keys and tools.
 *   bun run.ts daemon – runs 24/7 under launchd: plans once a day, reads Slack and works the queue on config.schedule
 *   bun run.ts plan   – collect everything on your plate, write plans/YYYY-MM-DD.md (Agent vs You)
 *   bun run.ts work   – one pass: fix feedback on agent PRs, then run the plan items you armed
 *   bun run.ts ui     – the dashboard alone
 *   bun run.ts inbox  – one Slack triage pass
 * Kill switch: `touch PAUSE` in this folder. The code lives in packages/core; this file is the entry point launchd runs.
 */
import { startOrExplain } from "@overhand/core/config";

// core loads the config as it is imported: inside startOrExplain, a broken one is one plain line
if (import.meta.main) await startOrExplain(async () => (await import("@overhand/core")).main(process.argv[2]));
