/**
 * Proof on every PR, assembled without a model: the check commands the agent ran and how each ended (read from its run's
 * transcript: Claude Code's stream-json, Codex's JSONL), the diff's size and areas, what the agent says it verified,
 * screenshots when the project can render, and the gaps. The shape and its Markdown live in the contract (proof.ts).
 */
import { type CheckKind, type Proof, type ProofCheck, proofGaps } from "@overhand/contract";
import { at, jsonLines } from "./runtimes/runtime";

/** One shell command from a transcript and how it ended: its output (the tail) and whether it exited cleanly. */
export interface Ran {
  command: string;
  ok: boolean;
  output: string;
}

const text = (x: unknown): string =>
  typeof x === "string"
    ? x
    : Array.isArray(x)
      ? x.map((p) => (typeof at(p, "text") === "string" ? String(at(p, "text")) : "")).join("\n")
      : "";

/**
 * Every shell command in a run's raw output, in order. Claude Code: a Bash `tool_use` and its `tool_result` (an error
 * result is a non-zero exit). Codex: a completed `command_execution` with its exit code. Other CLIs print only their
 * answer, so nothing comes back and the proof says the log couldn't be read.
 */
export function commandsRun(raw: string): Ran[] {
  const pending = new Map<string, string>();
  const ran: Ran[] = [];
  for (const e of jsonLines(raw)) {
    if (e.type === "item.completed" && at(e, "item", "type") === "command_execution") {
      const code = at(e, "item", "exit_code");
      // Codex runs each command through a login shell: `/bin/zsh -lc 'pnpm test'`
      const cmd = String(at(e, "item", "command") ?? "");
      ran.push({
        command: cmd.match(/^\S*\b(?:ba|z)?sh -l?c (['"])([\s\S]*)\1$/)?.[2] ?? cmd,
        ok: code === 0 || (code === undefined && at(e, "item", "status") === "completed"),
        output: String(at(e, "item", "aggregated_output") ?? ""),
      });
      continue;
    }
    const content = at(e, "message", "content");
    if ((e.type !== "assistant" && e.type !== "user") || !Array.isArray(content)) continue;
    for (const c of content) {
      if (at(c, "type") === "tool_use" && at(c, "name") === "Bash")
        pending.set(String(at(c, "id")), String(at(c, "input", "command") ?? ""));
      if (at(c, "type") !== "tool_result") continue;
      const id = String(at(c, "tool_use_id"));
      const command = pending.get(id);
      if (command === undefined) continue;
      pending.delete(id);
      ran.push({ command, ok: at(c, "is_error") !== true, output: text(at(c, "content")) });
    }
  }
  return ran;
}

const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/\d+/g;

/**
 * The words of one plain command, or null when it is more than one: anything chained, piped, substituted or escaped
 * outside quotes (`;`, `&`, `|`, a backtick, any `$` (so `$(`, `$'…'` and `$VAR`), a newline, a backslash) could print what the
 * command itself didn't. Quotes are kept
 * as one word each.
 */
export function plainCommand(command: string): string[] | null {
  const words: string[] = [];
  let word = "";
  let quote = "";
  let started = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command.charAt(i);
    if (quote) {
      if (ch === quote) quote = "";
      else if (quote === '"' && ch === "\\") word += command.charAt(++i);
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
    } else if (/[;&|`$\n\\]/.test(ch)) return null;
    else if (/\s/.test(ch)) {
      if (started || word) words.push(word);
      word = "";
      started = false;
    } else word += ch;
  }
  if (quote) return null;
  if (started || word) words.push(word);
  return words;
}

/** Each successful command in a run that is exactly one plain command starting with `head`, with its words. */
const ranPlain = (raw: string, ...head: string[]): { words: string[]; r: Ran }[] =>
  commandsRun(raw).flatMap((r) => {
    const words = r.ok ? plainCommand(r.command) : null;
    return words && head.every((h, i) => words[i] === h) ? [{ words, r }] : [];
  });

/** The value of a `--repo x` / `-R x` / `--repo=x` flag among a command's words; "" when it has none. */
const repoFlag = (words: readonly string[]): string => {
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? "";
    if (w === "--repo" || w === "-R") return words[i + 1] ?? "";
    if (w.startsWith("--repo=")) return w.slice(7);
  }
  return "";
};

/**
 * The GitHub pull requests a run opened itself: the URL each successful command that is exactly one `gh pr create`
 * printed last, and only for the repo its `--repo` names when it names one. A URL printed by anything else (another
 * command, a chained one, a file's contents) is never taken. Callers still check the PR on GitHub (lead-prs.ts).
 */
export function prsOpened(raw: string): string[] {
  const urls = ranPlain(raw, "gh", "pr", "create").flatMap(({ words, r }) => {
    const last = [...r.output.matchAll(PR_URL)].at(-1);
    const named = repoFlag(words).toLowerCase();
    if (!last?.[1] || (named && last[1].toLowerCase() !== named)) return [];
    return [last[0]];
  });
  return [...new Set(urls)];
}

/**
 * The branches a run pushed by name: the refspecs of each successful command that is exactly one `git push` (`b`,
 * `HEAD:b`, `refs/heads/b`). A bare `git push` names none, so it never vouches for a branch.
 */
export function branchesPushed(raw: string): string[] {
  const out = ranPlain(raw, "git", "push").flatMap(({ words }) => {
    // after the remote: every positional word is a refspec
    const positional = words.slice(2).filter((w) => !w.startsWith("-"));
    return positional.slice(1).map((s) => (s.split(":").pop() ?? "").replace(/^\+/, "").replace(/^refs\/heads\//, ""));
  });
  return [...new Set(out.filter(Boolean))];
}

/** Whether the raw output is a transcript we can read commands from (any event either parser knows). */
const readable = (raw: string): boolean =>
  jsonLines(raw).some((e) => e.type === "assistant" || e.type === "user" || (typeof e.type === "string" && e.type.startsWith("item.")));

const RUNNER =
  /^(bun|bunx|npm|npx|pnpm|pnpx|yarn|deno|node|tsc|vue-tsc|vitest|jest|mocha|pytest|python3?|uv|poetry|go|cargo|make|eslint|biome|ruff|mypy|pyright|rspec|bundle|phpunit|gradle|\.\/gradlew|mvn|turbo|nx|playwright|tox)\b/;
const KINDS: [CheckKind, RegExp][] = [
  [
    "test",
    /\b(?:(?:bun|npm|pnpm|yarn|deno)\s+(?:run\s+)?test(?::\S+)?|vitest|jest|mocha|pytest|go test|cargo test|make test|rspec|phpunit|playwright test|tox|gradlew? test|mvn test|turbo (?:run )?test|nx test)\b/,
  ],
  ["typecheck", /\b(?:tsc|vue-tsc|mypy|pyright|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:typecheck|type-check|check-types|types))\b/],
  [
    "lint",
    /\b(?:eslint|biome (?:check|lint|ci)|ruff(?: check)?|golangci-lint|cargo clippy|stylelint|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?lint(?::\S+)?)\b/,
  ],
  [
    "build",
    /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build(?::\S+)?|cargo build|go build|next build|vite build|make build|turbo (?:run )?build)\b/,
  ],
];

/**
 * The check kind of one simple command (`bun test`, `npx tsc --noEmit`), or null. Leading `VAR=x`, `nice`, `timeout N`
 * are skipped; a command that doesn't start with a known runner (`grep test`, `cat jest.config.js`) is never a check.
 */
export function checkKind(segment: string): CheckKind | null {
  const s = segment
    .trim()
    .replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, "")
    .replace(/^(?:nice(?:\s+-n\s*-?\d+)?|timeout\s+\S+|time)\s+/g, "");
  if (!RUNNER.test(s)) return null;
  return KINDS.find(([, re]) => re.test(s))?.[0] ?? null;
}

const SUMMARY: RegExp[] = [
  /^\s*Ran \d+ tests? across \d+ files?.*$/m,
  /^\s*Tests?:?\s+\d+.*$/m, // jest "Tests: 1 failed, 4 passed", vitest "Tests  4 passed (4)"
  /^=+ (.*(?:passed|failed|error).*) =+$/m, // pytest
  /^\s*Found \d+ errors?.*$/m, // tsc
  /^\s*(?:ok|FAIL)\s+\S+\s+[\d.]+s$/m, // go test
  /^\s*test result: .*$/m, // cargo test
  /^\s*✖ \d+ problems?.*$/m, // eslint
  /^\s*Checked \d+ files? in .*$/m, // biome
  /^\s*Found \d+ (?:error|warning|diagnostic)s?.*$/m,
];

/** The tool's own summary from a check's output: bun's pass/fail counts, jest's `Tests:` line, tsc's `Found N errors`. */
export function summaryOf(output: string): { summary: string; skipped: number } {
  const n = (re: RegExp) => Number(output.match(re)?.[1] ?? 0);
  const skipped = n(/(?:^|\s)(\d+) skip(?:ped)?\b/m) || n(/\b(\d+) skipped\b/);
  const pass = output.match(/^\s*(\d+) pass\s*$/m);
  const fail = output.match(/^\s*(\d+) fail\s*$/m);
  if (pass || fail) {
    const parts = [`${pass?.[1] ?? 0} pass`, `${fail?.[1] ?? 0} fail`, ...(skipped ? [`${skipped} skip`] : [])];
    return { summary: parts.join(", "), skipped };
  }
  for (const re of SUMMARY) {
    const all = [...output.matchAll(new RegExp(re.source, "gm"))];
    const last = all.at(-1);
    if (last) return { summary: (last[1] ?? last[0]).trim().slice(0, 140), skipped };
  }
  const tsErrors = output.match(/error TS\d+/g)?.length ?? 0;
  return { summary: tsErrors ? `${tsErrors} type error${tsErrors === 1 ? "" : "s"}` : "", skipped };
}

/**
 * The checks among the commands a run made: one per distinct check command, as its LAST run ended (an agent that fixed
 * a failing test and reran it passed). ponytail: a compound line (`bun test && tsc`) gives each of its checks the line's
 * one exit status; run them separately to tell them apart.
 */
export function checksOf(ran: Ran[]): ProofCheck[] {
  const last = new Map<string, ProofCheck>();
  for (const r of ran) {
    for (const seg of r.command.split(/&&|\|\||;|\n/)) {
      const head = seg.split("|")[0] ?? ""; // `bun test 2>&1 | tail` is `bun test`
      const kind = checkKind(head);
      if (!kind) continue;
      const command = head
        .trim()
        .replace(/\s*2>&1$/, "")
        .slice(0, 120);
      last.delete(command); // rerun: move to the end, the order it was last run in
      last.set(command, { kind, command, ok: r.ok, ...summaryOf(r.output) });
    }
  }
  return [...last.values()];
}

/** One line of `git diff --numstat`. */
export interface NumStat {
  path: string;
  added: number;
  removed: number;
}

/** `git diff --numstat` parsed; binary files count as 0 lines. Renames keep the new path. */
export function parseNumstat(out: string): NumStat[] {
  return out.split("\n").flatMap((l) => {
    const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m?.[3]) return [];
    const path = m[3].replace(/\{[^}]* => ([^}]*)\}/, "$1").replace(/^.* => /, "");
    return [{ path, added: Number(m[1]) || 0, removed: Number(m[2]) || 0 }];
  });
}

const LOCK =
  /(?:^|\/)(?:bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|uv\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/;
const UI = /\.(?:tsx|jsx|vue|svelte|astro|css|scss|sass|less|html)$/;
const NOT_UI = /(?:\.(?:test|spec|stories)\.|(?:^|\/)(?:__tests__|tests?|e2e)\/)/;
const DOC = /(?:\.(?:md|mdx|txt|rst)$|(?:^|\/)docs\/)/;

/** Where a file sits: the first two folders in a monorepo (`packages/core`), else the first, `(root)` at the top. */
export function areaOf(path: string): string {
  const parts = path.split("/");
  if (parts.length === 1) return "(root)";
  return /^(?:packages|apps|libs|services|modules|crates)$/.test(parts[0] ?? "") && parts.length > 2
    ? parts.slice(0, 2).join("/")
    : (parts[0] ?? "(root)");
}

/** The diff's facts for the proof: files, lines (lock files left out), areas biggest first, UI or docs only. */
export function diffFacts(files: NumStat[]): Pick<Proof, "files" | "added" | "removed" | "areas" | "ui" | "docsOnly"> {
  const counted = files.filter((f) => !LOCK.test(f.path));
  const size = new Map<string, number>();
  for (const f of files) size.set(areaOf(f.path), (size.get(areaOf(f.path)) ?? 0) + f.added + f.removed + 1);
  return {
    files: files.length,
    added: counted.reduce((n, f) => n + f.added, 0),
    removed: counted.reduce((n, f) => n + f.removed, 0),
    areas: [...size.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([a]) => a),
    ui: files.some((f) => UI.test(f.path) && !NOT_UI.test(f.path)),
    docsOnly: files.length > 0 && files.every((f) => DOC.test(f.path)),
  };
}

/** The whole proof from a run's raw output(s), the diff's numstat, the agent's own words and the screenshots taken. */
export function assembleProof(input: {
  transcript: string;
  numstat: string;
  verified: string;
  shots?: Proof["shots"];
  now?: number;
}): Proof {
  const facts = {
    at: input.now ?? Date.now(),
    transcript: readable(input.transcript),
    checks: checksOf(commandsRun(input.transcript)),
    ...diffFacts(parseNumstat(input.numstat)),
    verified: input.verified.trim().slice(0, 1000),
    shots: input.shots ?? { before: false, after: false, note: "" },
  };
  return { ...facts, gaps: proofGaps(facts) };
}
