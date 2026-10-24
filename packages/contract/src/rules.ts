/**
 * Rules learned from review: the same guidance given on two PRs of a project within 30 days, not yet in its agent
 * instructions, offered as a rule for the file its agent reads. Deterministic: review remarks are cut into short
 * imperative candidates and clustered by word overlap; no model reads them. Pure, shared by the daemon and the demo.
 */
import { z } from "zod";
import { isImperative, type ProjectInstructions, SUGGEST } from "./instructions";

export const RuleSuggestionSchema = z.object({
  /** Stable while the guidance is: the project and the rule's words. */
  id: z.string(),
  project: z.string(),
  /** The repo it was last given in, by name. */
  repo: z.string(),
  /** The rule as it would be written: imperative, at most 120 characters. */
  rule: z.string(),
  /** How many PRs it came up on. */
  times: z.number(),
  /** You set it in a lead answer ("always…", "from now on…"): offered at once, not after two PRs. */
  standing: z.boolean().default(false),
  /** Those PRs' ticket keys, oldest first. */
  keys: z.array(z.string()),
  /** The instruction file Add writes it into, relative to the repo. */
  file: z.string(),
});
export type RuleSuggestion = z.infer<typeof RuleSuggestionSchema>;

/** One candidate rule as it came up on one PR. */
export interface RuleSeen {
  project: string;
  repo: string;
  key: string;
  rule: string;
  at: number;
  /** Given as a standing instruction in a lead answer, not as review feedback. */
  standing?: boolean;
}

/** A rule you said not now (until a date) or never (`until` is MAX_SAFE_INTEGER) to, or added. */
export interface RuleDismissal {
  project: string;
  rule: string;
  until: number;
}

/** How far back guidance counts, and how many PRs it must come up on. */
export const RULE_WINDOW_MS = 30 * 864e5;
export const RULE_TIMES = 2;
/** The longest rule worth offering: a rule people read at a glance. */
export const RULE_MAX = 120;

/**
 * The invisible marker on everything Overhand (or an agent that follows its instructions) posts as you: PR and issue
 * comments, PR bodies. Learning never reads marked text as your feedback.
 */
export const OVERHAND_MARK = "<!-- overhand -->";

/**
 * True when a comment came from Overhand or one of its agents rather than a person: it carries the marker (or another
 * `<!-- overhand…` tag, like the corner comment's), or, for comments posted before the marker, names Overhand.
 */
export const fromOverhand = (body: string): boolean => /<!-- overhand|\bOverhand\b/.test(body);

/** `text` with the marker on its own last line (once). */
export const withMark = (text: string): string => (text.includes(OVERHAND_MARK) ? text : `${text.trimEnd()}\n\n${OVERHAND_MARK}`);

// ---------- candidates ----------

/** Lead-ins that soften an instruction; stripped (repeatedly) so "Nit: could you please use X?" reads "Use X". */
const LEADINS = [
  /^(?:nit(?:pick)?|minor|suggestion|optional|style|small thing|also|and)\s*[:,-]?\s+/i,
  /^(?:please|pls|kindly)\s+/i,
  /^(?:can|could|would)\s+(?:you|we)\s+(?:please\s+)?/i,
  /^(?:you|we)\s+(?:should|need to|must|have to)\s+(?:also\s+|always\s+)?/i,
  /^(?:let's|lets)\s+/i,
  /^(?:from now on|going forward|in (?:the )?future)\s*[:,-]?\s+/i,
  /^make sure (?:to|you)\s+/i,
  /^(?:i'd|i would) (?:prefer|rather) (?:we|you)?\s*/i,
];

/** An answer that sets a standing instruction rather than deciding one case. */
const STANDING = /\b(?:always|never|from now on|going forward|in (?:the )?future|every time|whenever|by default)\b/i;

/** The rules in a lead answer that reads as a standing instruction ("From now on, use bun"); none for a one-off answer. */
export const standingRules = (answer: string): string[] => (STANDING.test(answer) ? candidateRules(answer) : []);

/** A question asked as a request ("Can you…?") is an instruction; any other question isn't. */
const REQUEST = /^(?:nit\s*[:,-]?\s+)?(?:please\s+)?(?:can|could|would)\s+(?:you|we)\b/i;

/**
 * Short imperative rules in a review remark: quotes, code blocks and HTML dropped, each sentence stripped of its
 * softeners ("nit:", "please", "can you") and kept when it gives an instruction with something specific in it (not
 * "Remove this"), in at most 120 characters.
 */
export function candidateRules(remark: string): string[] {
  const text = remark
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\s*>/.test(line)) continue; // quoting someone else
    const bare = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "").trim();
    for (const sentence of bare.split(/(?<=[.!?])\s+/)) {
      let s = sentence.trim();
      const asked = REQUEST.test(s);
      if (s.endsWith("?") && !asked) continue;
      for (let n = 0; n < 4; n++) {
        const before = s;
        for (const re of LEADINS) s = s.replace(re, "");
        if (s === before) break;
      }
      s = s.replace(/[\s,;:]*(?:please|thanks|thank you|thx|🙏)?[\s.!?]*$/i, "").trim();
      if (!s || s.length > RULE_MAX || s.split(/\s+/).length < 2 || !isImperative(s)) continue;
      if (![...ruleWords(s).words].some((w) => !VERBS.has(w))) continue; // "Remove this", "Fix it": nothing to keep
      const rule = s.charAt(0).toUpperCase() + s.slice(1);
      if (!out.some((r) => similarRules(r, rule))) out.push(rule);
    }
  }
  return out;
}

// ---------- similarity ----------

/** Words that carry no guidance of their own, including generic verbs and pointers ("this", "here"). */
const STOP = new Set(
  (
    "a an the this that these those it its to of for in on at by with and or but be is are was were as from into here there " +
    "please we you your our i me my just also so then than when if can could would should will use using instead always make " +
    "sure ensure must need needs prefer like rather above below other one some any thing things way new"
  ).split(" "),
);
/** Verbs that open a rule; a candidate needs a word besides these to say something. */
const VERBS = new Set("add remove delete fix rename move run keep write update change put call check test do don't avoid never".split(" "));
/** A rule that opens with one of these forbids what follows. */
const LEADING_NO = /^\W*(?:don'?t|do not|never|avoid|no|stop)\b/i;
const NEGATIONS = /\b(?:don'?t|do not|never|avoid|not|no|without|stop)\b/gi;

const stem = (w: string): string =>
  w.length > 5 && w.endsWith("ing")
    ? w.slice(0, -3)
    : w.length > 4 && w.endsWith("ed")
      ? w.slice(0, -2)
      : w.length > 3 && w.endsWith("s") && !w.endsWith("ss")
        ? w.slice(0, -1)
        : w;

/** A rule's polarity (does it forbid?) and its content words, stemmed: what two rules are compared on. */
export function ruleWords(rule: string): { no: boolean; words: Set<string> } {
  const words = rule
    .toLowerCase()
    .replace(/[`*_"“”‘’]/g, "")
    .replace(NEGATIONS, " ")
    .split(/[^a-z0-9.@/'-]+/)
    .map((w) => w.replace(/^[.'/-]+|[.'/-]+$/g, ""))
    .filter((w) => w && !STOP.has(w))
    .map(stem);
  return { no: LEADING_NO.test(rule), words: new Set(words) };
}

/**
 * Whether two rules say the same thing: same polarity, and half their words shared, or nearly all of the shorter
 * one's ("Use bun instead of npm" is in "Package manager: bun (not npm or yarn)").
 */
export function similarRules(a: string, b: string): boolean {
  const A = ruleWords(a);
  const B = ruleWords(b);
  if (A.no !== B.no) return false;
  const small = Math.min(A.words.size, B.words.size);
  if (!small) return false;
  const shared = [...A.words].filter((w) => B.words.has(w)).length;
  return shared / (A.words.size + B.words.size - shared) >= 0.5 || (small >= 2 && shared / small >= 0.8);
}

/** The instruction already in `rules` that says what `rule` says, or null. */
export function coveredBy(rule: string, rules: readonly string[]): string | null {
  return rules.find((r) => similarRules(rule, r)) ?? null;
}

/** A cluster of candidates that say the same thing, within one project. */
export interface RuleCluster {
  project: string;
  repo: string;
  /** The shortest wording: the one offered. */
  rule: string;
  /** Distinct PRs, oldest first. */
  keys: string[];
  last: number;
  /** Any of it was given as a standing instruction. */
  standing: boolean;
}

/**
 * Candidates from the last 30 days grouped per project into clusters of near-duplicates (each joins the first cluster
 * holding a similar one). Greedy and order-dependent, which is fine at the few hundred candidates a month brings.
 */
export function clusterRules(seen: readonly RuleSeen[], now: number): RuleCluster[] {
  const out: (RuleCluster & { members: string[] })[] = [];
  for (const s of [...seen].filter((x) => now - x.at <= RULE_WINDOW_MS).sort((a, b) => a.at - b.at)) {
    const c = out.find((x) => x.project === s.project && x.members.some((m) => similarRules(m, s.rule)));
    if (!c) {
      out.push({ project: s.project, repo: s.repo, rule: s.rule, keys: [s.key], last: s.at, standing: !!s.standing, members: [s.rule] });
      continue;
    }
    c.standing ||= !!s.standing;
    c.members.push(s.rule);
    if (!c.keys.includes(s.key)) c.keys.push(s.key);
    if (s.rule.length < c.rule.length) c.rule = s.rule;
    c.repo = s.repo;
    c.last = s.at;
  }
  return out.map(({ members: _, ...c }) => c);
}

// ---------- where it goes ----------

/** Root files a rule can be written into, AGENTS.md first: the one most agent CLIs read. */
const WRITABLE = ["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md", "GEMINI.md", "CONVENTIONS.md"];

/**
 * The file a new rule goes in, from who reads what: of the repo's root instruction files, the one read by most of the
 * project's agent CLIs (AGENTS.md on a tie); with none read, the file its agent would read (AGENTS.md for several).
 */
export function ruleFile(files: readonly { path: string; readers: readonly string[] }[], runtimes: readonly string[]): string {
  const score = (f: { readers: readonly string[] }) => runtimes.filter((r) => f.readers.includes(r)).length;
  const best = files
    .filter((f) => WRITABLE.includes(f.path) && score(f) > 0)
    .sort((a, b) => score(b) - score(a) || WRITABLE.indexOf(a.path) - WRITABLE.indexOf(b.path))[0];
  if (best) return best.path;
  const [only] = runtimes;
  return runtimes.length === 1 && only ? (SUGGEST[only] ?? "AGENTS.md") : "AGENTS.md";
}

/** The heading learned rules are kept under, so they're easy to find and review. */
export const LEARNED_HEADING = "## Learned from review";

/** An instruction file's text with `rule` added as a list item under the learned heading (made at the end if missing). */
export function addRuleToText(text: string, rule: string): string {
  const item = `- ${rule}`;
  if (!text.trim()) return `# Agent instructions\n\n${LEARNED_HEADING}\n\n${item}\n`;
  const lines = text.replace(/\r\n?/g, "\n").trimEnd().split("\n");
  const at = lines.findIndex((l) => l.trim() === LEARNED_HEADING);
  if (at < 0) return `${[...lines, "", LEARNED_HEADING, "", item].join("\n")}\n`;
  let end = lines.findIndex((l, i) => i > at && /^#{1,6}\s/.test(l));
  if (end < 0) end = lines.length;
  while (end > at + 1 && !lines[end - 1]?.trim()) end--;
  lines.splice(end, 0, item);
  return `${lines.join("\n")}\n`;
}

// ---------- suggestions ----------

/** A rule's id: its project and sorted words, so rewording that keeps the words keeps the id. */
export const ruleId = (project: string, rule: string): string => `${project}:${[...ruleWords(rule).words].sort().join("-").slice(0, 80)}`;

/**
 * What to offer: clusters that came up on two PRs or more in 30 days (or that you set as a standing rule), that no instruction file of the project already
 * says and that you haven't dismissed (or added) for now, each with the file it would go in. Most-repeated first.
 */
export function ruleSuggestions(
  seen: readonly RuleSeen[],
  projects: readonly ProjectInstructions[],
  dismissed: readonly RuleDismissal[],
  now: number,
): RuleSuggestion[] {
  return clusterRules(seen, now)
    .filter((c) => c.keys.length >= RULE_TIMES || c.standing)
    .filter((c) => !dismissed.some((d) => d.project === c.project && d.until > now && similarRules(d.rule, c.rule)))
    .flatMap((c) => {
      const p = projects.find((x) => x.project === c.project);
      const rules = (p?.files ?? []).flatMap((f) => f.sections.flatMap((s) => s.items.filter((i) => i.rule).map((i) => i.text)));
      if (coveredBy(c.rule, rules)) return [];
      const files = (p?.files ?? []).filter((f) => f.repo === c.repo);
      return [
        {
          id: ruleId(c.project, c.rule),
          project: c.project,
          repo: c.repo,
          rule: c.rule,
          times: c.keys.length,
          standing: c.standing,
          keys: c.keys,
          file: ruleFile(files, p?.runtimes ?? []),
        },
      ];
    })
    .sort((a, b) => b.times - a.times);
}
