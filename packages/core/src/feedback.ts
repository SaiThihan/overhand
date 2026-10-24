/**
 * Suggest or report, on this machine: drafts the issue (contract/feedback.ts), reads it with the outward firewall, and
 * posts it only when you press Send, through your own `gh` login, else hands back a filled-in GitHub link to open.
 */
import {
  diagnosticLines,
  type FeedbackDraft,
  type FeedbackHits,
  type FeedbackPreview,
  type FeedbackRequest,
  type FeedbackSent,
  feedbackBody,
  ghIssueArgv,
  issueUrl,
  type LeakHit,
  NO_PROJECT,
} from "@overhand/contract";
import { plainWords } from "@overhand/themes";
import { CFG, shAsync } from "./env";
import { type FirewallConfig, scanOutward } from "./outward";
import { diagnosticBundle, PLATFORM } from "./selfcheck";
import { VERSION } from "./selfupdate";

/** Runs one command as an argv; tests swap it. */
export type Run = (argv: string[]) => Promise<{ ok: boolean; out: string }>;

const run: Run = (argv) => shAsync(argv, undefined, 30_000);

/** The issue a request drafts: your title, your details, the version and OS, and the diagnostics summary when asked. */
export function feedbackDraft(req: FeedbackRequest, state: unknown): FeedbackDraft {
  const d = req.diagnostics ? diagnosticBundle(state) : null;
  const body = feedbackBody({
    kind: req.kind,
    words: plainWords,
    details: req.details,
    version: VERSION,
    os: PLATFORM,
    diagnostics: d ? diagnosticLines(d) : undefined,
  });
  return { title: req.title.trim(), body };
}

/**
 * What the firewall marks: a public issue goes to no project of yours, so every project's words count, with your
 * deny-list and secrets.
 */
export function feedbackHits(d: FeedbackDraft, cfg: FirewallConfig = CFG): FeedbackHits {
  return { title: publicHits(d.title, cfg), body: publicHits(d.body, cfg) };
}

/** An email address, or a home folder that names its owner (/Users/x, /home/x, C:\Users\x); example.com stands in. */
const PERSONAL = /[\w.+-]+@(?!example\.com\b)[\w-]+(?:\.[\w-]+)+|(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^/\\\s]+/g;

/** The firewall's hits, plus anything that names you in a public issue: an email address or your home folder. */
function publicHits(text: string, cfg: FirewallConfig): LeakHit[] {
  const hits = scanOutward(text, [NO_PROJECT], cfg);
  for (const m of text.matchAll(PERSONAL)) {
    const start = m.index;
    const end = start + m[0].length;
    if (!hits.some((h) => h.start < end && start < h.end)) hits.push({ start, end, term: m[0], why: "private", project: "" });
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** Whose gh login Send would post as; "" when there's none. Reads only. */
async function ghLogin(exec: Run): Promise<string> {
  const r = await exec(["gh", "api", "user", "-q", ".login"]);
  return r.ok ? r.out.trim() : "";
}

/** Preview: the draft, what the firewall marks in it, and how Send would post. Sends nothing. */
export async function previewFeedback(
  req: FeedbackRequest,
  state: unknown,
  cfg: FirewallConfig = CFG,
  exec = run,
): Promise<FeedbackPreview> {
  const d = feedbackDraft(req, state);
  const login = await ghLogin(exec);
  return { ...d, hits: feedbackHits(d, cfg), via: login ? "gh" : "browser", login };
}

/**
 * Send, the one path that posts: the exact title and body you saw (and maybe edited), read again by the firewall. Held
 * while anything matches; else posted with your gh login, or, without one (or when gh fails), the link for your browser.
 */
export async function sendFeedback(d: FeedbackDraft, cfg: FirewallConfig = CFG, exec = run): Promise<FeedbackSent> {
  const hits = feedbackHits(d, cfg);
  if (hits.title.length || hits.body.length) return { hits };
  if (await ghLogin(exec)) {
    const r = await exec(ghIssueArgv(d));
    // gh prints the new issue's address last
    if (r.ok) return { via: "gh", url: r.out.trim().split("\n").pop() ?? "" };
  }
  return { via: "browser", url: issueUrl(d) };
}
