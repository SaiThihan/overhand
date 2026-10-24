/**
 * Overhand learns your rules: review remarks on agent PRs become candidate rules (rules.ts in the contract), and guidance
 * given twice is offered as a rule for the project's instruction file. Add opens a small draft PR with it; on watch it
 * only hands you the text. Candidates and dismissals live in rules.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  addRuleToText,
  candidateRules,
  RULE_WINDOW_MS,
  type RuleDismissal,
  type RuleSeen,
  type RuleSuggestion,
  ruleSuggestions,
  standingRules,
  withMark,
} from "@overhand/contract";
import { prepareWorktree } from "./agent";
import { policyOf } from "./autonomy";
import { gitRepos } from "./cleanup";
import { CLIENTS, CODE, OPS, shAsync } from "./env";
import { instructions } from "./instructions";
import { report } from "./notify";
import { scanOutward } from "./outward";
import { readJson, writeJsonAtomic } from "./state";

const FILE = join(OPS, "rules.json");
/** Never: dismissed for good. */
const NEVER = Number.MAX_SAFE_INTEGER;
/** Not now, and added: not offered again for this long (an added rule is in the file by then, or its PR was closed). */
const LATER_MS = 30 * 864e5;

interface Learned {
  seen: RuleSeen[];
  dismissed: RuleDismissal[];
  /** 2 once bots are told apart by their account type: candidates noted before then may be a bot's boilerplate. */
  v?: number;
}

const load = (): Learned => {
  const l: Learned = { seen: [], dismissed: [], ...readJson<Partial<Learned>>(FILE, {}) };
  // GraphQL hid bots' "[bot]" suffix, so CodeRabbit and CI boilerplate was learned as guidance: start the count again
  return l.v === 2 ? l : { ...l, seen: [], v: 2 };
};
const save = (l: Learned): void => writeJsonAtomic(FILE, l);

/** A Request-changes note or a Slack summary as the fix round gets it ("Name (review): text"): the text alone. */
const NOTE_PREFIX = /^[^:\n]{1,60} \((?:review|Slack)\): /;

/**
 * Notes the candidate rules in one PR's review remarks (people's reviews, inline comments and notes, never bots or
 * CI). Each rule counts once per PR; older than 30 days is dropped. Never throws: learning is a side line.
 */
export function learnFrom(project: string, repo: string, key: string, remarks: readonly string[], now = Date.now()): void {
  note(
    project,
    repo,
    key,
    remarks.flatMap((r) => candidateRules(r.replace(NOTE_PREFIX, ""))),
    false,
    now,
  );
}

/**
 * Notes a free-text lead answer that reads as a standing instruction ("From now on, use bun"): offered at once as a rule
 * for the project's instruction file, so the same call isn't asked again. Never throws.
 */
export function learnFromAnswer(project: string, dir: string, key: string, answer: string, now = Date.now()): void {
  const rules = standingRules(answer);
  if (!rules.length) return;
  const repo = gitRepos(join(CODE, dir))[0];
  if (repo) note(project, basename(repo), key, rules, true, now);
}

/** Adds fresh candidates (each once per key) and drops those older than 30 days. */
function note(project: string, repo: string, key: string, rules: readonly string[], standing: boolean, now: number): void {
  try {
    const l = load();
    const fresh = rules.filter((rule) => !l.seen.some((s) => s.key === key && s.rule === rule));
    const seen = l.seen.filter((s) => now - s.at <= RULE_WINDOW_MS);
    if (!fresh.length && seen.length === l.seen.length) return;
    const add = fresh.map((rule) => ({ project, repo, key, rule, at: now, ...(standing ? { standing } : {}) }));
    save({ ...l, seen: [...seen, ...add].slice(-1000) });
  } catch (e) {
    report(`⚠ couldn't note guidance on ${key}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Rules to offer now, checked against every project's instruction files as the instructions view reads them. */
export function ruleOffers(now = Date.now()): RuleSuggestion[] {
  const l = load();
  if (!l.seen.length) return [];
  return ruleSuggestions(l.seen, instructions(), l.dismissed, now);
}

/** Not now (30 days) or never: the offer goes, and anything that says the same isn't offered again meanwhile. */
export function dismissRule(id: string, how: "later" | "never", now = Date.now()): void {
  const s = ruleOffers(now).find((x) => x.id === id);
  if (!s) throw new Error("That suggestion is gone; reload.");
  const l = load();
  save({ ...l, dismissed: [...l.dismissed, { project: s.project, rule: s.rule, until: how === "never" ? NEVER : now + LATER_MS }] });
}

/** What Add did: a draft PR, or (watch, or a host Overhand can't open PRs on) the text to add yourself. */
export type AddedRule = { url: string } | { suggest: string; file: string };

/**
 * Adds an offered rule to the repo's instruction file on a branch of its own and opens a small draft PR, never touching
 * the base branch. On watch nothing is written: you get the line to add. Either way it isn't offered again for 30 days.
 */
export async function addRule(id: string, now = Date.now()): Promise<AddedRule> {
  const s = ruleOffers(now).find((x) => x.id === id);
  if (!s) throw new Error("That suggestion is gone; reload.");
  const c = CLIENTS.find((x) => x.name === s.project);
  if (!c) throw new Error(`No project ${s.project}`);
  const done = (r: AddedRule): AddedRule => {
    const l = load();
    save({ ...l, dismissed: [...l.dismissed, { project: s.project, rule: s.rule, until: now + LATER_MS }] });
    return r;
  };
  // a rule naming another project or a secret never goes in a commit: you get the line to add yourself
  const leaks = scanOutward(s.rule, [c.name]).length > 0;
  if (leaks || policyOf(c.autonomy).pr === "none" || c.host !== "github") return done({ suggest: `- ${s.rule}`, file: s.file });
  const repo = gitRepos(join(CODE, c.dir)).find((r) => basename(r) === s.repo);
  if (!repo) throw new Error(`Couldn't find ${s.repo} under ${c.dir}`);
  const key = `rules-${Bun.hash(s.id).toString(36).slice(0, 6)}`;
  const wt = await prepareWorktree(repo, key);
  const path = join(wt.path, s.file);
  writeFileSync(path, addRuleToText(existsSync(path) ? readFileSync(path, "utf8") : "", s.rule));
  const step = async (cmd: string[]) => {
    const r = await shAsync(cmd, wt.path, 60_000); // push and gh reach the network: never block the server
    if (!r.ok) throw new Error(`${cmd.slice(0, 2).join(" ")}: ${r.err.slice(0, 200)}`);
    return r.out;
  };
  await step(["git", "add", "--", s.file]);
  await step(["git", "commit", "-m", `docs(agents): ${s.rule.length > 60 ? `${s.rule.slice(0, 57)}…` : s.rule}`]);
  await step(["git", "push", "-u", "origin", wt.branch]);
  const body = [
    s.standing
      ? `You set this as a standing rule answering an agent, so it goes in \`${s.file}\` for every agent that reads it:`
      : `Review asked for this on ${s.times} PRs (${s.keys.join(", ")}), so it goes in \`${s.file}\` for every agent that reads it:`,
    "",
    `> ${s.rule}`,
    "",
    `Opened by Overhand from your ${s.standing ? "answer" : "review feedback"}.`,
  ].join("\n");
  const out = await step([
    "gh",
    "pr",
    "create",
    "--draft",
    "--head",
    wt.branch,
    "--base",
    wt.base,
    "--title",
    `docs(agents): add a rule from ${s.standing ? "your answer" : "review"}`,
    "--body",
    withMark(body),
  ]);
  const url = out.split("\n").pop() ?? out;
  report(`📏 ${s.project}: rule from review proposed in ${s.file}: ${url}`);
  return done({ url });
}
