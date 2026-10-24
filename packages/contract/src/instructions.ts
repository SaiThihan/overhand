/**
 * Agent instructions: the files in a project's repos that tell agent CLIs how to work there (CLAUDE.md, AGENTS.md,
 * GEMINI.md, Cursor rules…), parsed into sections and rules shown verbatim, plus a few deterministic checks. Pure
 * functions, shared by the daemon (which reads the files) and the dashboard's demo. No model ever rewrites a rule.
 */
import { z } from "zod";

export const InstructionRuleSchema = z.object({
  /** The line as written, list marker removed and wrapped lines joined. */
  text: z.string(),
  /** Nesting: 0 for a top-level list item or sentence. */
  depth: z.number(),
  /** An instruction (a list item or an imperative sentence); false for prose and table rows, kept as notes. */
  rule: z.boolean(),
});
export type InstructionRule = z.infer<typeof InstructionRuleSchema>;

export const InstructionSectionSchema = z.object({
  /** The heading as written; empty for text before the first heading. */
  heading: z.string(),
  /** Heading level, 1–6; 0 before the first heading. */
  level: z.number(),
  /** Rules and notes in file order. */
  items: z.array(InstructionRuleSchema),
});
export type InstructionSection = z.infer<typeof InstructionSectionSchema>;

export const InstructionFileSchema = z.object({
  repo: z.string(),
  /** Relative to the repo. */
  path: z.string(),
  /** Where to open it: the file on the repo's host, empty when there's no such page (not committed, unknown host). */
  url: z.string(),
  /** Agent CLIs (runtime ids) that read this file in this repo. */
  readers: z.array(z.string()),
  /** Other tools that read it, as people know them ("GitHub Copilot"); empty for none. */
  also: z.string(),
  /** Last changed: its last commit, else its modification time. */
  changedAt: z.number(),
  /** Committed: a ticket agent's fresh worktree only has committed files. */
  tracked: z.boolean(),
  sections: z.array(InstructionSectionSchema),
});
export type InstructionFile = z.infer<typeof InstructionFileSchema>;

export const CONFLICT_TOPICS = ["package-manager", "test-command", "never"] as const;

const Side = z.object({ path: z.string(), rule: z.string() });
export const InstructionCheckSchema = z.discriminatedUnion("kind", [
  /** No instruction file at all in a repo the project's agent works in. */
  z.object({ kind: z.literal("missing"), repo: z.string(), runtime: z.string() }),
  /** Files exist, but none that the project's agent reads; `suggest` names a file to create from one it has. */
  z.object({
    kind: z.literal("unread"),
    repo: z.string(),
    runtime: z.string(),
    files: z.array(z.string()),
    suggest: z.object({ from: z.string(), to: z.string() }).nullable(),
  }),
  /** Two files say opposite things on one topic; `action` is the phrase for a "never X" against "X". */
  z.object({ kind: z.literal("conflict"), repo: z.string(), topic: z.enum(CONFLICT_TOPICS), action: z.string(), a: Side, b: Side }),
  /** Not changed in `months` while the repo kept moving. */
  z.object({ kind: z.literal("stale"), repo: z.string(), path: z.string(), months: z.number() }),
  /** Not committed, so ticket agents (fresh worktrees) never see it. */
  z.object({ kind: z.literal("untracked"), repo: z.string(), path: z.string() }),
]);
export type InstructionCheck = z.infer<typeof InstructionCheckSchema>;

export const ProjectInstructionsSchema = z.object({
  project: z.string(),
  /** The agent CLIs the project runs on (its accounts' runtimes). */
  runtimes: z.array(z.string()),
  repos: z.array(z.string()),
  files: z.array(InstructionFileSchema),
  checks: z.array(InstructionCheckSchema),
});
export type ProjectInstructions = z.infer<typeof ProjectInstructionsSchema>;

/** The file names discovery looks for, as git pathspecs (nested ones too: a `*` crosses folders). */
export const INSTRUCTION_PATHSPECS = [
  "*CLAUDE.md",
  "*AGENTS.md",
  "AGENTS.override.md",
  "*GEMINI.md",
  ".claude/rules/*.md",
  ".cursor/rules/*",
  ".cursorrules",
  ".github/copilot-instructions.md",
  "CONVENTIONS.md",
];

const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** True for a path discovery keeps (pathspec globs also match `fooCLAUDE.md` and dependency folders). */
export function isInstructionPath(p: string): boolean {
  if (/(^|\/)(node_modules|\.claude\/worktrees|vendor)\//.test(p)) return false;
  if (p.startsWith(".claude/rules/")) return p.endsWith(".md");
  if (p.startsWith(".cursor/rules/")) return /\.mdc?$/.test(p);
  return ["CLAUDE.md", "AGENTS.md", "GEMINI.md"].includes(base(p)) || INSTRUCTION_PATHSPECS.includes(p);
}

/**
 * Which agent CLIs read `path`, given every instruction path in the repo and its `.aider.conf.yml` (empty for none).
 * Sources, all fetched October 2026:
 * - Claude Code (code.claude.com/docs/en/memory): `CLAUDE.md` or `.claude/CLAUDE.md` at launch, subfolders' `CLAUDE.md`
 *   on demand, `.claude/rules/*.md`; `AGENTS.md` only when there's no `CLAUDE.md`, never `AGENTS.override.md`.
 * - Codex (learn.chatgpt.com/docs/agent-configuration/agents-md): per folder from the root down to where it runs,
 *   `AGENTS.override.md` else `AGENTS.md`. Overhand runs it at the repo root, so only the root's.
 * - Gemini CLI (geminicli.com/docs/cli/gemini-md): `GEMINI.md`, nested ones as it works there.
 * - Cursor Agent (cursor.com/docs/cli/using): `.cursor/rules`, and `AGENTS.md` and `CLAUDE.md` at the root. The page
 *   doesn't mention `.cursorrules`, so it isn't counted.
 * - OpenCode (opencode.ai/docs/rules): `AGENTS.md`, else `CLAUDE.md`.
 * - Aider (aider.chat/docs/usage/conventions.html): `CONVENTIONS.md` only when passed with `--read`, so only when
 *   `.aider.conf.yml` names it.
 */
export function readersOf(path: string, all: readonly string[], aiderConf = ""): { readers: string[]; also: string } {
  const has = (p: string) => all.includes(p);
  const claudeMd = has("CLAUDE.md") || has(".claude/CLAUDE.md");
  const nested = path.includes("/") && !path.startsWith(".");
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  const name = base(path);
  if (nested) {
    if (name === "CLAUDE.md") return { readers: ["claude-code"], also: "" };
    if (name === "GEMINI.md") return { readers: ["gemini"], also: "" };
    if (name === "AGENTS.md") return { readers: claudeMd || has(`${dir}CLAUDE.md`) ? [] : ["claude-code"], also: "" };
    return { readers: [], also: "" };
  }
  if (path === "CLAUDE.md") return { readers: ["claude-code", "cursor", ...(has("AGENTS.md") ? [] : ["opencode"])], also: "" };
  if (path === ".claude/CLAUDE.md" || path.startsWith(".claude/rules/")) return { readers: ["claude-code"], also: "" };
  if (path === "AGENTS.md")
    return {
      readers: [...(claudeMd ? [] : ["claude-code"]), ...(has("AGENTS.override.md") ? [] : ["codex"]), "cursor", "opencode"],
      also: "",
    };
  if (path === "AGENTS.override.md") return { readers: ["codex"], also: "" };
  if (path === "GEMINI.md") return { readers: ["gemini"], also: "" };
  if (path.startsWith(".cursor/rules/")) return { readers: ["cursor"], also: "" };
  if (path === ".cursorrules") return { readers: [], also: "Cursor editor (legacy)" };
  if (path === ".github/copilot-instructions.md") return { readers: [], also: "GitHub Copilot" };
  if (path === "CONVENTIONS.md") return { readers: aiderConf.includes("CONVENTIONS.md") ? ["aider"] : [], also: "" };
  return { readers: [], also: "" };
}

// ---------- parsing ----------

/** Words that start an instruction when a sentence opens with them (lower case). */
const IMPERATIVE = new Set(
  (
    "always never don't dont do avoid use prefer run keep write make ensure add follow put call read check test commit push " +
    "create update remove delete name return import export handle store place wrap include exclude limit stop start ask " +
    "document comment format lint build install open close match mirror treat leave let skip mark reference refer note " +
    "must only no remember be favor favour split group sort log validate type"
  ).split(" "),
);

/** True when a sentence opens with a word that starts an instruction ("Use…", "Never…", "Don't…"). */
export const isImperative = (s: string): boolean => {
  const first = s
    .replace(/^[*_`"']+/, "")
    .split(/[\s,:]/)[0]
    ?.toLowerCase()
    .replace(/[*_`]+$/, "");
  return first !== undefined && IMPERATIVE.has(first);
};

/** Sentences of a paragraph; a period inside `code` or after an abbreviation can split it, which only costs a line break. */
const sentences = (p: string): string[] =>
  p
    .split(/(?<=[.!?])\s+(?=[A-Z`"*])/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * A markdown (or plain text) instruction file as sections of rules: list items and imperative sentences, verbatim
 * (trimmed, list markers removed, wrapped lines joined). Front matter, code blocks and HTML comments are skipped; other
 * prose and table rows are kept as notes. A small hand parser: headings and list items are all this view needs.
 */
export function parseInstructions(text: string): InstructionSection[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, n) => n > 0 && l.trim() === "---");
    if (end > 0) i = end + 1;
  }
  const out: InstructionSection[] = [];
  let sec: InstructionSection = { heading: "", level: 0, items: [] };
  let item: InstructionRule | null = null;
  let itemIndent = 0;
  let para: string[] = [];
  let fence = "";
  const flushPara = () => {
    if (!para.length) return;
    for (const s of sentences(para.join(" "))) {
      sec.items.push({ text: s, depth: 0, rule: isImperative(s) });
    }
    para = [];
  };
  const flush = () => {
    item = null;
    flushPara();
  };
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    const fenceMark = /^\s*(```|~~~)/.exec(line)?.[1];
    if (fence) {
      if (fenceMark === fence) fence = "";
      continue;
    }
    if (fenceMark) {
      flush();
      fence = fenceMark;
      continue;
    }
    if (/^<!--.*-->$/.test(trimmed)) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      if (sec.heading || sec.items.length) out.push(sec);
      sec = { heading: heading[2] ?? "", level: heading[1]?.length ?? 1, items: [] };
      continue;
    }
    const li = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li && !/^[-*_]{3,}$/.test(trimmed)) {
      flushPara();
      itemIndent = li[1]?.replace(/\t/g, "  ").length ?? 0;
      item = { text: (li[2] ?? "").trim(), depth: Math.min(3, Math.floor(itemIndent / 2)), rule: true };
      sec.items.push(item);
      continue;
    }
    if (!trimmed || /^[-*_]{3,}$/.test(trimmed)) {
      flush();
      continue;
    }
    if (trimmed.startsWith("|")) {
      flush();
      if (!/^\|[\s|:-]+\|$/.test(trimmed)) sec.items.push({ text: trimmed, depth: 0, rule: false });
      continue;
    }
    // a wrapped list item: an indented line, or a lazy continuation right under it
    if (item) {
      item.text = [item.text, trimmed].join(" ");
      continue;
    }
    para.push(trimmed);
  }
  flush();
  if (sec.heading || sec.items.length) out.push(sec);
  return out;
}

/** How many rules a file holds. */
export const ruleCount = (sections: readonly InstructionSection[]): number =>
  sections.reduce((n, s) => n + s.items.filter((r) => r.rule).length, 0);

// ---------- conflicts ----------

const NEGATION = /\b(?:not|never|don't|dont|do not|instead of|avoid|no|without)\b/i;
const PMS = ["npm", "yarn", "pnpm", "bun"] as const;
const PM_RE = /\b(npm|yarn|pnpm|bunx?)\b/gi;

/** A rule's clauses: split at sentence ends, semicolons, dashes, and a comma before "but" or "use". */
const clauses = (rule: string): string[] => rule.split(/[;.!?]\s|\s[—–-]\s|,\s*(?=(?:but|use)\b)/i);

/** The package managers a rule tells you to use and to avoid: mentions after a negation in the same clause are avoided. */
export function packageManagers(rule: string): { use: Set<string>; avoid: Set<string> } {
  const use = new Set<string>();
  const avoid = new Set<string>();
  for (const c of clauses(rule)) {
    const neg = NEGATION.exec(c)?.index ?? Number.POSITIVE_INFINITY;
    for (const m of c.matchAll(PM_RE)) {
      const pm = (m[1] ?? "").toLowerCase().replace(/^bunx$/, "bun");
      if (!PMS.some((p) => p === pm)) continue;
      ((m.index ?? 0) > neg ? avoid : use).add(pm);
    }
  }
  return { use, avoid };
}

const TEST_RUNNERS = /^(npm|yarn|pnpm|bun|npx|bunx|vitest|jest|pytest|go|cargo|make|deno|rspec|phpunit|mix|uv|poetry)\b/;

/** The test command a rule names: the first `code` span that runs tests, in a rule about tests; "" for none. */
export function testCommand(rule: string): string {
  if (!/\btests?\b/i.test(rule)) return "";
  const neg = NEGATION.exec(rule)?.index ?? Number.POSITIVE_INFINITY;
  for (const m of rule.matchAll(/`([^`]+)`/g)) {
    const cmd = (m[1] ?? "").trim().replace(/\s+/g, " ");
    if ((m.index ?? 0) > neg) break;
    if (TEST_RUNNERS.test(cmd) && /test|vitest|jest|pytest|rspec|phpunit/.test(cmd)) return cmd.replace(/^(\w+) run test\b/, "$1 test");
  }
  return "";
}

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[`*_"'()[\]]/g, "")
    .replace(/[^a-z0-9\s/.-]/g, " ")
    .replace(/[.]+(\s|$)/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** "Never force push" → ["force", "push"]; null when the rule isn't a prohibition. */
function prohibition(rule: string): string[] | null {
  const m = /^\W*(?:never|don't|dont|do not)\s+(.+)$/i.exec(rule);
  return m?.[1] ? words(m[1].split(/[;:.,]\s|\s[—–-]\s/)[0] ?? "") : null;
}

/** "Always force push…" / "Force push…" → its words; null for a prohibition. */
function prescription(rule: string): string[] | null {
  if (prohibition(rule) || /^\W*(?:avoid|no)\b/i.test(rule)) return null;
  return words(rule.replace(/^\W*(?:always|please|you (?:should|must)|make sure to)\s+/i, ""));
}

/** A verb that says little alone: its prohibition must match three words, not two, before it counts. */
const GENERIC = new Set(["use", "run", "add", "make", "be", "do", "have", "write", "put"]);

/** The action two rules disagree on ("force push"), or "" when they don't: one forbids what the other starts by telling. */
export function opposite(no: string, yes: string): string {
  const neg = prohibition(no);
  const pos = prescription(yes);
  if (!neg || !pos || neg.length < 2) return "";
  const n = Math.min(4, neg.length);
  if (n < (GENERIC.has(neg[0] ?? "") ? 3 : 2)) return "";
  return neg.slice(0, n).every((w, k) => pos[k] === w) ? neg.slice(0, n).join(" ") : "";
}

type Conflict = Extract<InstructionCheck, { kind: "conflict" }>;

/**
 * Opposite instructions between two files of one repo: package managers (one uses what the other avoids, or each names
 * a different one and nothing else), test commands (each names exactly one, and they differ), and a "never X" in one
 * against "X" in the other. Nested files are left out: a sub-package may rightly differ. Few, sure findings over many
 * guesses.
 */
export function conflicts(repo: string, files: readonly { path: string; rules: readonly string[] }[]): Conflict[] {
  const top = files.filter((f) => !f.path.includes("/") || f.path.startsWith("."));
  const out: Conflict[] = [];
  for (let x = 0; x < top.length; x++) {
    for (let y = x + 1; y < top.length; y++) {
      const A = top[x];
      const B = top[y];
      if (!A || !B) continue;
      const pair = conflictPair(repo, A, B);
      if (pair) out.push(pair);
    }
  }
  return out;
}

type FileRules = { path: string; rules: readonly string[] };

/** The first conflict between two files, by topic order: package manager, test command, never-vs-do. */
function conflictPair(repo: string, A: FileRules, B: FileRules): Conflict | null {
  const at = (f: FileRules, rule: string) => ({ path: f.path, rule });
  const pms = (f: FileRules) => f.rules.map((r) => ({ r, ...packageManagers(r) }));
  const pa = pms(A);
  const pb = pms(B);
  for (const [P, Q, F, G] of [
    [pa, pb, A, B],
    [pb, pa, B, A],
  ] as const) {
    for (const p of P)
      for (const pm of p.use) {
        const q = Q.find((x) => x.avoid.has(pm));
        if (q) return { kind: "conflict", repo, topic: "package-manager", action: "", a: at(F, p.r), b: at(G, q.r) };
      }
  }
  const only = (P: typeof pa) => [...new Set(P.flatMap((p) => [...p.use]))];
  const ua = only(pa);
  const ub = only(pb);
  if (ua.length === 1 && ub.length === 1 && ua[0] !== ub[0]) {
    const ra = pa.find((p) => p.use.size)?.r ?? "";
    const rb = pb.find((p) => p.use.size)?.r ?? "";
    return { kind: "conflict", repo, topic: "package-manager", action: "", a: at(A, ra), b: at(B, rb) };
  }
  const tests = (f: FileRules) => f.rules.map((r) => ({ r, cmd: testCommand(r) })).filter((t) => t.cmd);
  const ta = tests(A);
  const tb = tests(B);
  const distinct = (t: typeof ta) => new Set(t.map((x) => x.cmd)).size;
  if (ta[0] && tb[0] && distinct(ta) === 1 && distinct(tb) === 1 && ta[0].cmd !== tb[0].cmd)
    return { kind: "conflict", repo, topic: "test-command", action: "", a: at(A, ta[0].r), b: at(B, tb[0].r) };
  for (const [F, G] of [
    [A, B],
    [B, A],
  ] as const) {
    for (const no of F.rules)
      for (const yes of G.rules) {
        const action = opposite(no, yes);
        if (action) return { kind: "conflict", repo, topic: "never", action, a: at(F, no), b: at(G, yes) };
      }
  }
  return null;
}

// ---------- a project ----------

/** One repo as read from disk (or the demo): its instruction files' text, and how lively it is. */
export interface RepoInput {
  name: string;
  /** Last commit, ms; 0 for none. */
  lastCommit: number;
  aiderConf: string;
  files: { path: string; text: string; url: string; changedAt: number; tracked: boolean }[];
}

/** A file is stale after this many months without a change while its repo had a commit in the last 30 days. */
export const STALE_MONTHS = 6;
const MONTH = 30 * 864e5;

/** Which file to suggest creating for an agent that reads none of the repo's files, from one it has. */
export const SUGGEST: Record<string, string> = {
  codex: "AGENTS.md",
  opencode: "AGENTS.md",
  cursor: "AGENTS.md",
  "claude-code": "CLAUDE.md",
  gemini: "GEMINI.md",
  aider: "CONVENTIONS.md",
};

/** A project's instruction files, parsed, with its checks. `runtimes` are the agent CLIs it runs on. */
export function projectInstructions(
  project: string,
  runtimes: readonly string[],
  repos: readonly RepoInput[],
  now: number,
): ProjectInstructions {
  const files: InstructionFile[] = [];
  const checks: InstructionCheck[] = [];
  for (const repo of repos) {
    const paths = repo.files.map((f) => f.path);
    const parsed = repo.files.map((f): InstructionFile => {
      const { readers, also } = readersOf(f.path, paths, repo.aiderConf);
      return {
        repo: repo.name,
        path: f.path,
        url: f.url,
        readers,
        also,
        changedAt: f.changedAt,
        tracked: f.tracked,
        sections: parseInstructions(f.text),
      };
    });
    files.push(...parsed);
    for (const rt of runtimes) {
      if (!parsed.length) checks.push({ kind: "missing", repo: repo.name, runtime: rt });
      else if (!parsed.some((f) => f.readers.includes(rt))) {
        const to = SUGGEST[rt] ?? "";
        const from = parsed.find((f) => f.sections.length && !f.path.includes("/"))?.path ?? "";
        checks.push({
          kind: "unread",
          repo: repo.name,
          runtime: rt,
          files: paths,
          suggest: to && from && !paths.includes(to) ? { from, to } : null,
        });
      }
    }
    checks.push(
      ...conflicts(
        repo.name,
        parsed.map((f) => ({ path: f.path, rules: f.sections.flatMap((s) => s.items.filter((r) => r.rule).map((r) => r.text)) })),
      ),
    );
    const active = now - repo.lastCommit < MONTH;
    for (const f of parsed) {
      const months = Math.floor((now - f.changedAt) / MONTH);
      if (active && f.changedAt && months >= STALE_MONTHS) checks.push({ kind: "stale", repo: repo.name, path: f.path, months });
      if (!f.tracked) checks.push({ kind: "untracked", repo: repo.name, path: f.path });
    }
  }
  return { project, runtimes: [...runtimes], repos: repos.map((r) => r.name), files, checks };
}
