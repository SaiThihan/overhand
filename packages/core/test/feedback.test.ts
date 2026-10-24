import { expect, test } from "bun:test";
import { type FeedbackDraft, ghIssueArgv, ISSUE_URL_CUT, ISSUE_URL_MAX, issueUrl, REPO, REPO_URL } from "@overhand/contract";
import type { Client } from "../src/config";
import { CFG } from "../src/env";
import { feedbackHits, previewFeedback, type Run, sendFeedback } from "../src/feedback";
import type { FirewallConfig } from "../src/outward";
import { VERSION } from "../src/selfupdate";

const client = (name: string, prefix: string): Client => ({
  name,
  dir: name.toLowerCase(),
  prefix,
  host: "github",
  tracker: { kind: "github", repo: `org/${name.toLowerCase()}` },
  aliases: [],
  accounts: [],
  fallbackToAll: true,
  autonomy: "act",
  assignedAutonomy: "act",
  status: { vercelSecrets: [], sentrySecrets: [] },
});
const CFG_TEST: FirewallConfig = { clients: [client("Honeycrust", "HONEY")], outward: { ...CFG.outward, deny: ["Bluefin"] } };

/** A fake shell: records every argv; `gh api user` answers with `login` ("" = no gh login), `gh issue create` with an issue. */
function shell(login: string, create = true): { run: Run; calls: string[][] } {
  const calls: string[][] = [];
  const run: Run = async (argv) => {
    calls.push(argv);
    if (argv[1] === "api") return { ok: !!login, out: login };
    return { ok: create, out: create ? `Creating issue in ${REPO}\n\n${REPO_URL}/issues/7\n` : "" };
  };
  return { run, calls };
}
const created = (calls: string[][]) => calls.filter((a) => a[1] === "issue");

test("Preview drafts the issue from your words, version and OS only, and sends nothing", async () => {
  const sh = shell("octo");
  const p = await previewFeedback(
    { kind: "bug", title: "The map flickers", details: "On resize.", diagnostics: false },
    null,
    CFG_TEST,
    sh.run,
  );
  expect(p.title).toBe("The map flickers");
  expect(p.body).toBe(`On resize.\n\n---\nSomething's wrong · Overhand ${VERSION} · ${process.platform} ${process.arch}`);
  expect(p).toMatchObject({ via: "gh", login: "octo", hits: { title: [], body: [] } });
  expect(created(sh.calls)).toEqual([]);
  // the diagnostics summary only when ticked
  const d = await previewFeedback({ kind: "idea", title: "x", details: "", diagnostics: true }, {}, CFG_TEST, sh.run);
  expect(d.body).toContain("<details><summary>Diagnostics</summary>");
  expect(d.body).toContain("Self-check:");
  expect(created(sh.calls)).toEqual([]);
});

test("the firewall marks a project's word, the deny-list and a secret, and Send holds it", async () => {
  const token = ["ghp", "_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join("");
  const sh = shell("octo");
  const p = await previewFeedback(
    { kind: "bug", title: "Honeycrust board breaks", details: `Bluefin asked; key ${token}`, diagnostics: false },
    null,
    CFG_TEST,
    sh.run,
  );
  expect(p.hits.title.map((h) => h.term)).toEqual(["Honeycrust"]);
  expect(p.hits.body.map((h) => h.why)).toEqual(["private", "secret"]);
  const held = await sendFeedback({ title: p.title, body: p.body }, CFG_TEST, sh.run);
  expect("hits" in held && held.hits.title.length).toBe(1);
  expect(sh.calls).toEqual([["gh", "api", "user", "-q", ".login"]]);
});

test("Send posts the exact text as one argv through your gh login, never a shell string", async () => {
  const sh = shell("octo");
  const d: FeedbackDraft = { title: `Quotes "and" $(whoami); rm -rf ~`, body: "Line one\n`backticks` && more" };
  expect(await sendFeedback(d, CFG_TEST, sh.run)).toEqual({ via: "gh", url: `${REPO_URL}/issues/7` });
  expect(created(sh.calls)).toEqual([["gh", "issue", "create", "--repo", REPO, "--title", d.title, "--body", d.body]]);
  expect(ghIssueArgv(d)).toEqual(["gh", "issue", "create", "--repo", REPO, "--title", d.title, "--body", d.body]);
});

test("without a gh login (or when gh fails) Send hands back the filled-in GitHub link instead", async () => {
  const d: FeedbackDraft = { title: "Idea", body: "Text" };
  const none = shell("");
  expect(await sendFeedback(d, CFG_TEST, none.run)).toEqual({ via: "browser", url: issueUrl(d) });
  expect(created(none.calls)).toEqual([]);
  expect(await sendFeedback(d, CFG_TEST, shell("octo", false).run)).toEqual({ via: "browser", url: issueUrl(d) });
});

test("the fallback link is encoded and fits GitHub's limit, cut on a character with a marker", () => {
  const d: FeedbackDraft = { title: "A & B = 100% #1?", body: "Ünïcode 🙂 and\nnew lines & ampersands" };
  const u = new URL(issueUrl(d));
  expect(`${u.origin}${u.pathname}`).toBe(`${REPO_URL}/issues/new`);
  expect(u.searchParams.get("title")).toBe(d.title);
  expect(u.searchParams.get("body")).toBe(d.body);

  const long: FeedbackDraft = { title: "Long", body: "🙂 é ".repeat(5000) };
  const cut = issueUrl(long);
  expect(cut.length).toBeLessThanOrEqual(ISSUE_URL_MAX);
  // as long as it may be: one more character wouldn't fit
  expect(cut.length).toBeGreaterThan(ISSUE_URL_MAX - 20);
  const body = new URL(cut).searchParams.get("body") ?? "";
  expect(body.endsWith(ISSUE_URL_CUT)).toBe(true);
  expect(long.body.startsWith(body.slice(0, -ISSUE_URL_CUT.length))).toBe(true);
  expect(body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  expect(issueUrl(long, 500).length).toBeLessThanOrEqual(500);
});

test("a public issue marks your email address and home folder; example.com and plain paths pass", () => {
  const body = "Mail me at sam.lee@gmail.com, logs in /Users/sam/Library and C:\\Users\\sam\\x; see you@example.com and src/app.ts";
  const hits = feedbackHits({ title: "Crash", body }, { clients: [], outward: { ...CFG.outward, deny: [] } }).body;
  expect(hits.map((h) => h.term)).toEqual(["sam.lee@gmail.com", "/Users/sam", "C:\\Users\\sam"]);
  expect(hits.every((h) => h.why === "private")).toBe(true);
});
