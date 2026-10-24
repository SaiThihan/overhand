/**
 * Cursor Agent (`cursor-agent -p`). Flags from `cursor-agent --help` (2026.01.23) and cursor.com/docs/cli/reference/
 * output-format: `-p` prints headless, `--output-format json` prints one { type: "result", is_error, result } object (on
 * failure: a non-zero exit and stderr, no JSON), `-f` allows commands unless denied, `--model` picks the model,
 * CURSOR_API_KEY authenticates (else `cursor-agent login`). No schema enforcement: ops asks for JSON in the prompt.
 * It reads rules only from the project (.cursor/rules, AGENTS.md, CLAUDE.md; cursor.com/docs/cli/using), so Overhand's
 * agent instructions lead the prompt instead. Overhand's guard comes in as a local plugin (`--plugin-dir`) whose hooks
 * (cursor.com/docs/agent/hooks: beforeShellExecution, beforeReadFile, beforeMCPExecution, preToolUse) call it, failing
 * closed.
 */
import { GUARD_CONFIG } from "../agent-home";
import { type AgentRuntime, at, baseEnv, guardEnv, keyFrom, promptFor, type RunInput, readOnly, withInstructions } from "./runtime";
import { cursorModel, tuneArgs } from "./tune";

function spawn(r: RunInput) {
  // on watch, its read-only plan mode, and commands aren't forced through. `--trust` is separate: headless, an untrusted
  // folder stops at "Workspace Trust Required" and exits 1 (plan mode has no -f to imply it), so every run trusts the
  // checkout Overhand itself picked; it allows nothing more than the mode does
  const mode = readOnly(r) ? ["--mode", "plan"] : ["-f"];
  const argv = ["cursor-agent", "-p", withInstructions(r, promptFor(cursor, r)), "--output-format", "json", "--trust", ...mode];
  const model = cursorModel(r.model, r.tune?.effort);
  if (model) argv.push("--model", model);
  argv.push(...tuneArgs("cursor", r.osSandbox ? { ...r.tune, sandbox: false } : r.tune, true));
  // Overhand's guard as a plugin's hooks (agent-home.ts writes it), for this run only: your own ~/.cursor stays yours
  argv.push("--plugin-dir", GUARD_CONFIG.cursor);
  return { argv, env: guardEnv(r, keyFrom(baseEnv(), "CURSOR_API_KEY", `cursor-key-${r.account}`, r.read)), files: {} };
}

export const cursor: AgentRuntime = {
  id: "cursor",
  label: "Cursor Agent",
  bin: "cursor-agent",
  status: "verified",
  caps: { jsonSchema: false, autoMode: true, subagents: false, usage: false, transcripts: false },
  models: "`--model <model>` from the account's runtime model (see `cursor-agent models`); the account's default otherwise.",
  task: spawn,
  lead: spawn,
  parse(stdout, stderr, code) {
    let out: unknown;
    try {
      out = JSON.parse(stdout);
    } catch {
      return { ok: false, text: [stdout, stderr].join("\n").trim().slice(-500), structured: undefined, cost: 0, usage: null };
    }
    const result = at(out, "result");
    return {
      ok: code === 0 && at(out, "is_error") !== true,
      text: typeof result === "string" ? result : "",
      structured: undefined,
      cost: 0,
      usage: null,
    };
  },
};
