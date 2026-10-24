/**
 * Aider (`aider --message`). Flags from `aider --help` (0.86.2) and aider.chat/docs/config/options.html: `--message` sends
 * one message and exits, `--yes-always` says yes to every confirmation, `--model` picks the model, `--no-pretty` drops
 * colour, `--no-check-update` skips the version check, `--no-gitignore` stops it adding `.aider*` to the repo's .gitignore,
 * and the history files go to /dev/null so nothing of Aider's lands in the client's repo. A gateway account at Ollama runs
 * `ollama_chat/<model>` (set as the runtime model) with OLLAMA_API_BASE (aider.chat/docs/llms/ollama.html); otherwise a gateway runs `openai/<model>`
 * against `--openai-api-base` (aider.chat/docs/llms/openai-compat.html). It prints plain text (no JSON mode) and
 * auto-commits its edits. No schema enforcement: its one reply holds both the edits and the JSON answer. Overhand's agent
 * instructions go in with `--read <file>`, the read-only conventions file (aider.chat/docs/usage/conventions.html).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GUARD_CONFIG } from "../agent-home";
import { SECRET_STORE } from "../platform";
import { type AgentRuntime, baseEnv, gitCommonDir, guardEnv, lastLines, type RunInput, readOnly } from "./runtime";
import { tuneArgs } from "./tune";

/** Aider's edits are blocks in its one reply, so the JSON answer has to come after them rather than be the whole reply. */
const aiderAsk = (schema: string): string =>
  [
    "",
    "",
    "Make your file changes first. Then end your reply with one JSON object (no code fence) that matches this JSON Schema:",
    schema,
  ].join("\n");

/** Keeps Aider's own files (its tags cache) out of the repo's commits, locally: .git/info/exclude, not the repo's .gitignore. */
function ignoreAiderFiles(cwd: string): void {
  const git = gitCommonDir(cwd);
  if (!git) return;
  const f = join(git, "info", "exclude");
  if (existsSync(f) && readFileSync(f, "utf8").includes(".aider*")) return;
  mkdirSync(dirname(f), { recursive: true });
  appendFileSync(f, "\n.aider*\n");
}

/**
 * Aider reports an edit it couldn't apply ("The LLM did not conform to the edit format") and still exits 0: the run failed
 * when that comes after its last applied edit.
 */
const editFailed = (out: string): boolean => out.lastIndexOf("did not conform to the edit format") > out.lastIndexOf("Applied edit to");

function spawn(r: RunInput) {
  const prompt = r.schema ? [r.prompt, aiderAsk(r.schema)].join("") : r.prompt;
  const argv = ["aider", "--message", prompt, "--yes-always", "--no-pretty", "--no-check-update", "--no-gitignore"];
  argv.push("--input-history-file", "/dev/null", "--chat-history-file", "/dev/null");
  if (r.instructions) argv.push("--read", r.instructions);
  // Aider has no hook to put Overhand's guard in, so it gets nothing the guard would have to stop: no shell commands
  // (with --yes-always it would run every one it suggests), no test or lint command run after an edit, and the secret
  // files ignored (it can't reach outside its repo). An empty config and no .env, so nothing in the repo (.aider.conf.yml,
  // AIDER_* in .env) or your home turns any of that back on; flags given here win over AIDER_* variables too.
  argv.push("--no-suggest-shell-commands", "--no-auto-test", "--no-auto-lint", "--aiderignore", GUARD_CONFIG.aider);
  argv.push("--config", GUARD_CONFIG.aiderConfig, "--env-file", "/dev/null");
  // on watch, ask mode: it answers without editing and commits nothing
  if (readOnly(r)) argv.push("--chat-mode", "ask", "--no-auto-commits");
  ignoreAiderFiles(r.cwd);
  const env = guardEnv(r, baseEnv());
  const p = r.provider;
  let model = r.model;
  if (p.kind === "gateway") {
    const base = p.baseUrl.replace(/\/$/, "");
    if (model.startsWith("ollama")) env.OLLAMA_API_BASE = base;
    else {
      const token = p.secret ? r.read(p.secret) : "overhand";
      if (token === null) throw new Error(`gateway token ${p.secret} for ${r.account} missing from ${SECRET_STORE}`);
      if (!model.startsWith("openai/")) model = `openai/${model || p.model}`;
      argv.push("--openai-api-base", `${base}/v1`);
      env.OPENAI_API_KEY = token;
    }
  }
  if (model) argv.push("--model", model);
  argv.push(...tuneArgs("aider", r.tune, true));
  return { argv, env, files: {} };
}

export const aider: AgentRuntime = {
  id: "aider",
  label: "Aider",
  bin: "aider",
  status: "verified",
  caps: { jsonSchema: false, autoMode: true, subagents: false, usage: false, transcripts: false },
  models:
    "`--model <model>` from the account's runtime model; with a gateway account, ollama_chat/<model> reaches it through OLLAMA_API_BASE, anything else (or nothing: the gateway's model) is openai/<model> through --openai-api-base.",
  task: spawn,
  lead: spawn,
  parse(stdout, stderr, code) {
    const ok = code === 0 && !editFailed(stdout);
    return { ok, text: ok ? stdout : [stdout, stderr].join("\n").slice(-500), structured: undefined, cost: 0, usage: null };
  },
  readable: lastLines,
};
