import { GUARD_CONFIG } from "../agent-home";
import { SECRET_STORE } from "../platform";
import { repoRefusal } from "./repo-config";
import {
  type AgentRuntime,
  at,
  baseEnv,
  extractJson,
  guardEnv,
  keyFrom,
  lastLines,
  promptFor,
  type RunInput,
  readOnly,
  withInstructions,
} from "./runtime";
import { tuneArgs } from "./tune";

function spawn(r: RunInput) {
  const refused = repoRefusal("gemini", r.cwd);
  if (refused) throw new Error(refused);
  // on watch, the default approval mode: headless, nothing can approve an edit or a shell command, so only reads run.
  // Otherwise yolo, which only skips Gemini CLI's own confirmation prompts: every tool call still goes through its
  // BeforeTool hooks first (core/coreToolHookTriggers.ts runs them in every mode), and the guard is one of them. A stricter
  // mode can't run headless: auto_edit denies every shell command, so an agent couldn't even run the tests.
  const approval = readOnly(r) ? "default" : "yolo";
  const argv = ["gemini", "-p", withInstructions(r, promptFor(gemini, r)), "-o", "json", "--approval-mode", approval, "--skip-trust"];
  if (r.model) argv.push("-m", r.model);
  argv.push(...tuneArgs("gemini", r.osSandbox ? { ...r.tune, sandbox: false } : r.tune, true));
  const env = guardEnv(r, keyFrom(baseEnv(), "GEMINI_API_KEY", `gemini-key-${r.account}`, r.read));
  if (!env.GEMINI_API_KEY) throw new Error(`no Gemini API key for ${r.account} in ${SECRET_STORE} (gemini-key-${r.account})`);
  // the guard's hook lives in the user settings of a Gemini home of Overhand's (checked live: "Hook registry initialized
  // with 1 hook entries" on 0.65.0)
  env.GEMINI_CLI_HOME = GUARD_CONFIG.gemini;
  return { argv, env, files: {} };
}

export const gemini: AgentRuntime = {
  id: "gemini",
  label: "Gemini CLI",
  bin: "gemini",
  status: "flags verified",
  caps: { jsonSchema: false, autoMode: true, subagents: false, usage: false, transcripts: false },
  models: "`-m <model>` from the account's runtime model; Gemini CLI's default otherwise.",
  task: spawn,
  lead: spawn,
  parse(stdout, stderr, code) {
    let out: unknown;
    try {
      out = JSON.parse(stdout);
    } catch {
      return { ok: false, text: [stdout, stderr].join("\n").slice(-500), structured: undefined, cost: 0, usage: null };
    }
    const error = at(out, "error", "message");
    const response = at(out, "response");
    const text = typeof error === "string" ? error : typeof response === "string" ? response : "";
    return { ok: code === 0 && error === undefined, text, structured: undefined, cost: 0, usage: null };
  },
  // `-o json` prints one object when it ends, so a lead's line only shows its answer then (plain lines before it)
  readable(raw, maxLines) {
    const response = at(extractJson(raw), "response");
    return typeof response === "string" ? `✓ finished: ${response.slice(0, 300)}` : lastLines(raw, maxLines);
  },
};
