/**
 * Suggest or report: feedback becomes a public GitHub issue on REPO, sent by you. Overhand drafts it, you read and edit
 * the exact title and body, the outward firewall reads both, and only your Send posts it: through your own `gh` login
 * when you have one, else as a filled-in issue page in your browser. No Overhand token, no server.
 */
import { z } from "zod";
import { REPO, REPO_URL } from "./links";
import { LeakHitSchema } from "./outward";

/** An idea, or something that's wrong. */
export const FeedbackKindSchema = z.enum(["idea", "bug"]);
export type FeedbackKind = z.infer<typeof FeedbackKindSchema>;

/** What you wrote, before the draft: your words and whether a diagnostics summary goes with them. */
export const FeedbackRequestSchema = z.object({
  kind: FeedbackKindSchema,
  title: z.string().trim().min(1).max(200),
  details: z.string().max(5000).default(""),
  diagnostics: z.boolean().default(false),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

/** The exact issue that would go out: what Preview shows and Send posts. */
export const FeedbackDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000),
});
export type FeedbackDraft = z.infer<typeof FeedbackDraftSchema>;

/** How Send posts: `gh` as `login`, or the browser (no gh login on the machine Overhand runs on). */
export const FeedbackViaSchema = z.object({ via: z.enum(["gh", "browser"]), login: z.string().default("") });

/** The spans the outward firewall marks in the title and in the body. */
export const FeedbackHitsSchema = z.object({ title: z.array(LeakHitSchema), body: z.array(LeakHitSchema) });
export type FeedbackHits = z.infer<typeof FeedbackHitsSchema>;

/** Preview: the draft, the spans the firewall marks in each part (Send stays blocked while any are left), and how it goes. */
export const FeedbackPreviewSchema = FeedbackDraftSchema.extend({ hits: FeedbackHitsSchema, ...FeedbackViaSchema.shape });
export type FeedbackPreview = z.infer<typeof FeedbackPreviewSchema>;

/** Send: posted (the issue's address), the browser to open (a filled-in issue page), or held (what still matches). */
export const FeedbackSentSchema = z.union([
  z.object({ via: z.enum(["gh", "browser"]), url: z.string() }),
  z.object({ hits: FeedbackHitsSchema }),
]);
export type FeedbackSent = z.infer<typeof FeedbackSentSchema>;

/** What a diagnostics summary carries: the self-check's result (its error already redacted) and the page's health. */
export interface FeedbackDiagnostics {
  selfCheck: { ok: boolean; mode: string; error: string };
  browser: string;
  /** "ok", or the contract's first issues (field paths and messages, never values). */
  contract: "ok" | readonly string[];
  built: boolean;
  bun: string;
}

/** The diagnostics summary as the issue shows it: a few plain lines. */
export function diagnosticLines(d: FeedbackDiagnostics): string[] {
  const check =
    d.selfCheck.mode === "none"
      ? "not run yet"
      : d.selfCheck.ok
        ? `ok (${d.selfCheck.mode})`
        : `failed (${d.selfCheck.mode}): ${d.selfCheck.error}`;
  return [
    `Self-check: ${check}`,
    `Contract: ${d.contract === "ok" ? "ok" : d.contract.join("; ")}`,
    `Page built: ${d.built ? "yes" : "no"}`,
    `Headless browser: ${d.browser}`,
    `Bun ${d.bun}`,
  ];
}

/**
 * The issue's body: your details, then one line with the kind, Overhand's version and the OS, then the diagnostics
 * summary when you ticked it. Nothing else goes in. `words` names the kind (the interface's words, @overhand/themes).
 */
export function feedbackBody(o: {
  kind: FeedbackKind;
  words: { feedbackIdea: string; feedbackBug: string };
  details: string;
  version: string;
  os: string;
  diagnostics?: readonly string[];
}): string {
  const about = `${o.kind === "idea" ? o.words.feedbackIdea : o.words.feedbackBug} · Overhand ${o.version} · ${o.os}`;
  const diag = o.diagnostics?.length ? ["", "<details><summary>Diagnostics</summary>", "", ...o.diagnostics, "", "</details>"] : [];
  return [o.details.trim(), "", "---", about, ...diag].join("\n").trimStart();
}

/** `gh issue create` for the draft, as an argv: each part one argument, never a shell string. */
export const ghIssueArgv = (d: FeedbackDraft): string[] => ["gh", "issue", "create", "--repo", REPO, "--title", d.title, "--body", d.body];

/** The longest new-issue link GitHub reliably opens; past about 8 KB it answers 414. */
export const ISSUE_URL_MAX = 8000;
/** Ends a body cut to fit the link. */
export const ISSUE_URL_CUT = "\n\n(cut to fit a link)";

/**
 * GitHub's new-issue page, filled in with the draft and encoded, at most `max` characters long: a body too long for a
 * link is cut (on a character, never inside one) and ends with ISSUE_URL_CUT.
 */
export function issueUrl(d: FeedbackDraft, max = ISSUE_URL_MAX): string {
  const link = (body: string) => `${REPO_URL}/issues/new?title=${encodeURIComponent(d.title)}&body=${encodeURIComponent(body)}`;
  if (link(d.body).length <= max) return link(d.body);
  const chars = [...d.body];
  // the most characters that still fit with the cut marker
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (link([...chars.slice(0, mid), ISSUE_URL_CUT].join("")).length <= max) lo = mid;
    else hi = mid - 1;
  }
  return link([...chars.slice(0, lo), ISSUE_URL_CUT].join(""));
}
