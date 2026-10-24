/** Every agent CLI ops can drive, by config id. Claude Code is the reference; the others degrade where their caps say. */
import type { RuntimeId } from "../config";
import { aider } from "./aider";
import { claudeCode } from "./claude-code";
import { codex } from "./codex";
import { cursor } from "./cursor";
import { gemini } from "./gemini";
import { opencode } from "./opencode";
import type { AgentRuntime } from "./runtime";

export const RUNTIMES: Record<RuntimeId, AgentRuntime> = {
  "claude-code": claudeCode,
  codex,
  gemini,
  cursor,
  opencode,
  aider,
};

/** A CLI's `--version` line, or "" when it isn't installed or won't say. */
export function versionOf(rt: AgentRuntime): string {
  if (Bun.which(rt.bin) === null) return "";
  const r = Bun.spawnSync([rt.bin, "--version"], { timeout: 15_000 });
  return r.exitCode === 0 ? (r.stdout.toString().trim().split("\n")[0] ?? "") : "";
}
