/**
 * The outward firewall's words: what may not leave the machine toward a destination. Every project owns its name, its
 * aliases, its ticket keys (`PREFIX-123`) and its private words; none of them may reach ANOTHER project's repo, tracker or
 * channel. The global deny-list (private emails, hosts, people) may reach none. Secrets are checked in core (outward.ts).
 */
import { z } from "zod";

/** Why a span may not leave: a secret, a word on your deny-list, or another project's word. */
export const LeakWhySchema = z.enum(["secret", "private", "project"]);
export type LeakWhy = z.infer<typeof LeakWhySchema>;

/** One span that stopped a message: offsets into the held text, the word matched, and whose word it is ("" = yours). */
export const LeakHitSchema = z.object({
  start: z.number(),
  end: z.number(),
  term: z.string(),
  why: LeakWhySchema,
  project: z.string(),
});
export type LeakHit = z.infer<typeof LeakHitSchema>;

/** Where a held message was going, so Release can send it there. */
export const LeakKindSchema = z.enum(["comment", "ticket", "pr", "pr-comment", "update", "team", "agent"]);
export type LeakKind = z.infer<typeof LeakKindSchema>;

/** What a finding held by the firewall carries: where it was going, what matched, and what sending it needs. */
export const LeakSchema = z.object({
  kind: LeakKindSchema,
  /** The destination in words ("Fernway tracker, FERN-12", "status channel Weekly"). */
  dest: z.string(),
  hits: z.array(LeakHitSchema),
  payload: z.record(z.string(), z.string()).default({}),
});
export type Leak = z.infer<typeof LeakSchema>;

/**
 * Words too common to block when a project is named after them (a project called "Web" or "Core"). Seeded words only:
 * a word you list yourself is always blocked.
 */
const COMMON = new Set(
  (
    "a an the and or of to in on at by for with from as is it be we us our you your me my app apps web api core main home " +
    "site mobile admin dashboard test tests demo ops platform server client clients data cloud docs portal backend " +
    "frontend service services infra tools tool shared common lib libs utils ui ux design marketing sales support help " +
    "account accounts billing payments pay shop store cart auth login user users team teams project projects work new " +
    "old next live prod dev staging beta alpha pro plus one two hub labs lab studio agency group company inc ltd llc " +
    "github linear jira slack bitbucket vercel overhand agent agents bot bots"
  ).split(" "),
);

/** One word a destination must not receive, with whose it is. */
export interface Term {
  term: string;
  re: RegExp;
  why: Exclude<LeakWhy, "secret">;
  /** The project it belongs to; "" for the global deny-list. */
  project: string;
}

/** What the firewall reads from a project: the config's fields, or the dashboard's. */
export interface TermSource {
  name: string;
  prefix: string;
  aliases?: readonly string[];
  private?: readonly string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A whole word or phrase, any case: never inside a longer word ("Fernway" isn't in "Fernwayside"). */
const wordRe = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(w)}(?![\\p{L}\\p{N}_])`, "giu");

/**
 * The words a project seeds on its own, before any you add: its name and aliases (skipping ones too short or too common
 * to mean it), and its ticket keys. Shown read-only in Settings.
 */
export function seededTerms(c: TermSource): string[] {
  const words = [c.name, ...(c.aliases ?? [])].map((w) => w.trim()).filter((w) => w.length >= 3 && !COMMON.has(w.toLowerCase()));
  return [...new Set(words), ...(c.prefix ? [`${c.prefix}-123`] : [])];
}

/** Every word a project owns: seeded and listed. */
export function projectTerms(c: TermSource): Term[] {
  const own = (term: string, re: RegExp, why: Term["why"]): Term => ({ term, re, why, project: c.name });
  const words = seededTerms(c)
    .filter((w) => !c.prefix || w !== `${c.prefix}-123`)
    .map((w) => own(w, wordRe(w), "project"));
  const keys = c.prefix ? [own(`${c.prefix}-`, new RegExp(`(?<![\\w-])${escapeRe(c.prefix)}-\\d+\\b`, "g"), "project")] : [];
  const listed = (c.private ?? []).map((w) => w.trim()).filter(Boolean);
  return [...words, ...keys, ...listed.map((w) => own(w, wordRe(w), "private"))];
}

/** Every match of `t` in `text`. */
function spans(text: string, t: Term): { start: number; end: number }[] {
  return [...text.matchAll(new RegExp(t.re.source, t.re.flags))].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

/** A destination that is no project (a public issue, a diagnostic): every project's words count as another's there. */
export const NO_PROJECT = "\u0000";

/**
 * The spans of `text` that may not go to `dest` (the projects it's bound for): another project's words and the global
 * deny-list. A word the destination owns too is its own ("Acme" inside "Acme Labs" going to Acme Labs is fine). With no
 * destination known, only the deny-list applies: there's no "other" project to tell apart.
 */
export function termHits(text: string, dest: readonly string[], clients: readonly TermSource[], deny: readonly string[] = []): LeakHit[] {
  const mine = clients.filter((c) => dest.includes(c.name)).flatMap(projectTerms);
  const mineWords = new Set(mine.map((t) => t.term.toLowerCase()));
  const shadow = mine.flatMap((t) => spans(text, t));
  const others = dest.length ? clients.filter((c) => !dest.includes(c.name)).flatMap(projectTerms) : [];
  const global: Term[] = deny
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => ({ term: w, re: wordRe(w), why: "private", project: "" }));
  const hits: LeakHit[] = [];
  // longest words first, so an alias that contains the name ("honeycrust-inc") is marked whole
  const terms = [...global, ...others.filter((t) => !mineWords.has(t.term.toLowerCase()))].sort((a, b) => b.term.length - a.term.length);
  for (const t of terms)
    for (const s of spans(text, t))
      if (!(t.project && shadow.some((o) => o.start <= s.start && o.end >= s.end)) && !hits.some((h) => h.start < s.end && s.start < h.end))
        hits.push({ ...s, term: text.slice(s.start, s.end), why: t.why, project: t.project });
  return hits.sort((a, b) => a.start - b.start);
}
