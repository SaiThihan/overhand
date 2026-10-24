import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyConfig, CFG, CLIENTS, OPS } from "../src/env";
import { adoptLeadPrs, type LeadPrDeps, type LeadPrView, leadPrKey, leadShipStep } from "../src/lead-prs";
import {
  armedLeadPrs,
  blankLead,
  type Godmode,
  type LeadState,
  leadCovers,
  leadShipHolds,
  loadLeads,
  recordLeadExit,
  releaseLeadPrs,
  saveLeads,
} from "../src/leads";
import { branchesPushed, plainCommand, prsOpened } from "../src/proof";
import { loadShips, type Run } from "../src/ship";
import { loadState, type State, saveState, type TrackedPr } from "../src/state";

const URL = "https://github.com/o/shop/pull/12";
const lead: Godmode = {
  key: "honey-ci",
  label: "Keep CI green · Honeycrust",
  name: "",
  dir: "honeycrust",
  project: "Honeycrust",
  goal: "",
  prompt: "",
  supervised: false,
  onDemand: true,
  account: "",
  fallbackToAll: true,
  lockFile: "",
  lockStaleMin: 45,
  inboxFile: "",
  restartAfterMin: 5,
  maxCrashesPerHour: 3,
  answerWaitHours: 4,
  pushBranches: [],
};
const SHIP = { name: "Honeycrust", autonomy: "ship" as const };

/** A Claude Code stream-json transcript of Bash commands: [command, output, failed]. */
const transcript = (cmds: [string, string, boolean?][]): string =>
  cmds
    .flatMap(([command, out, err], i) => [
      { type: "assistant", message: { content: [{ type: "tool_use", id: `t${i}`, name: "Bash", input: { command } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: `t${i}`, content: out, is_error: err === true }] } },
    ])
    .map((e) => JSON.stringify(e))
    .join("\n");
const RUN = transcript([
  ["bun test", "12 pass\n0 fail"],
  ["gh pr create --title 'Fix the flaky cart test' --body x", `${URL}\n`],
]);

const NOW = Date.now();
/** A finished run's log holding RUN: the checks a lead ran, then the PR it opened. */
const LOG = join(OPS, "logs", "lead-prs-test", "run.log");
mkdirSync(join(OPS, "logs", "lead-prs-test"), { recursive: true });
writeFileSync(LOG, RUN);
const iso = (ms: number) => new Date(ms).toISOString();
/** A fake GitHub holding PRs by URL; arming and disarming change them as GitHub's own auto-merge would. */
function github(o: { pr?: Partial<LeadPrView>; me?: string; disarmFails?: boolean } = {}) {
  const calls: string[] = [];
  const pr: Partial<LeadPrView> = {
    state: "OPEN",
    isDraft: false,
    headRefName: "fix/flaky-cart",
    headRefOid: "abc",
    baseRefName: "main",
    body: "Fixes the flaky cart test.",
    files: [{ path: "src/cart.test.ts", additions: 4, deletions: 1 }],
    author: { login: "sam" },
    isCrossRepository: false,
    createdAt: iso(NOW - 30_000),
    commits: [{ committedDate: iso(NOW - 40_000) }],
    ...o.pr,
  };
  const live = {
    id: "PR_node",
    state: "OPEN",
    baseRefName: "main",
    headRefOid: pr.headRefOid,
    reviewDecision: "",
    autoMergeRequest: null as unknown,
  };
  const run: Run = async (cmd) => {
    const line = cmd.join(" ");
    calls.push(line);
    const ok = (out = "") => ({ ok: true, out, err: "" });
    if (line.startsWith("gh api user")) return ok(o.me ?? "sam");
    if (line.includes("--json state,isDraft")) return ok(JSON.stringify(pr));
    if (line.startsWith("gh pr view")) return ok(JSON.stringify(live));
    if (line.includes("/rules/")) return ok("[]");
    if (line.includes("/branches/"))
      return ok(JSON.stringify({ protection: { required_status_checks: { enforcement_level: "everyone", contexts: ["ci"] } } }));
    if (line.includes("/files")) return ok("src/cart.test.ts\n");
    if (line.includes("enablePullRequestAutoMerge")) {
      live.autoMergeRequest = { enabledAt: "now" };
      return ok();
    }
    if (line.includes("disablePullRequestAutoMerge")) {
      if (o.disarmFails) return { ok: false, out: "", err: "HTTP 502" };
      live.autoMergeRequest = null;
      return ok();
    }
    return ok();
  };
  return { run, calls, live };
}
const deps = (run: Run, slugs = ["o/shop"]): LeadPrDeps => ({ run, repos: () => slugs.map((slug) => ({ dir: `/code/${slug}`, slug })) });
const blankState = (): State => ({ attempts: {}, prs: {}, nextAccount: 0, slackCursor: 0, seen: [], pending: {} });
const opened = (url = URL, over: Partial<NonNullable<LeadState["opened"]>[number]> = {}) => ({
  url,
  log: LOG,
  from: NOW - 60_000,
  to: NOW,
  ...over,
});
const withOpened = (os: NonNullable<LeadState["opened"]>, pushed: LeadState["pushed"] = []) =>
  saveLeads({ [lead.key]: { ...blankLead(), opened: os, pushed } });
const enabled = (calls: string[]) => calls.filter((c) => c.includes("enablePullRequestAutoMerge"));
/** Adopts `os` with the fake GitHub; the PR it tracked under any key (the first), or undefined when none was taken in. */
async function adoptOne(gh: ReturnType<typeof github>, os = [opened()], slugs?: string[]): Promise<TrackedPr | undefined> {
  withOpened(os);
  const state = blankState();
  await adoptLeadPrs(state, deps(gh.run, slugs));
  return Object.values(state.prs)[0];
}

const before = CFG;
const onShip = () =>
  applyConfig({
    ...before,
    godmode: [lead],
    clients: before.clients.map((c) => (c.name === "Honeycrust" ? { ...c, autonomy: "ship" as const } : c)),
  });
beforeAll(onShip);
beforeEach(() => {
  onShip();
  rmSync(join(OPS, "ship.json"), { force: true });
  saveState(blankState());
});
afterAll(() => {
  applyConfig(before);
  rmSync(join(OPS, "ship.json"), { force: true });
});

test("only a plain gh pr create's own output counts as a PR a lead opened, and only for the repo it names", () => {
  expect(prsOpened(RUN)).toEqual([URL]);
  // a body written through a quoted heredoc is still one plain command
  expect(prsOpened(transcript([[`gh pr create --title x --body "$(cat <<'EOF'\nsee #3; a | b\nEOF\n)"`, URL]]))).toEqual([URL]);
  expect(prsOpened(transcript([["gh pr create -R o/shop --fill", URL]]))).toEqual([URL]);
  const injected: [string, string, boolean?][] = [
    ["cat notes.md", URL], // a URL some other command printed
    [`gh pr create --fill && echo ${URL}`, URL], // chained: the echo could print anything
    [`echo "gh pr create" ; echo ${URL}`, URL],
    ["gh pr create --fill | tee out", URL],
    ["gh pr create -R someone/else --fill", URL], // the repo it names isn't the URL's
    ["gh pr create --fill", URL, true], // it failed
  ];
  for (const c of injected) expect(prsOpened(transcript([c]))).toEqual([]);
  expect(prsOpened("not a transcript")).toEqual([]);
});

test("only a plain git push that names its branch vouches for that branch", () => {
  expect(branchesPushed(transcript([["git push -u origin fix/flaky-cart", ""]]))).toEqual(["fix/flaky-cart"]);
  expect(branchesPushed(transcript([["git push origin HEAD:refs/heads/fix/y", ""]]))).toEqual(["fix/y"]);
  expect(branchesPushed(transcript([["git push", ""]]))).toEqual([]);
  expect(branchesPushed(transcript([["git push origin fix/z && git push origin main", ""]]))).toEqual([]);
});

test("a lead's PR on a Ship project carries its run's proof and goes through the same Ship step as a ticket's", async () => {
  const log = LOG;
  // the lead's run ends: the PR it opened is kept with that run's log and window
  const st = Object.assign(blankLead(), { log, startedAt: NOW - 60_000 });
  recordLeadExit(lead, st, null, 0, "0");
  expect(st.opened?.map((o) => [o.url, o.log])).toEqual([[URL, log]]);
  const gh = github();
  const pr = await adoptOne(gh, st.opened);
  expect(pr?.lead).toBe(lead.key);
  expect(pr?.proof?.checks.map((c) => c.command)).toEqual(["bun test"]);
  expect(pr?.mainRepo).toBe("/code/o/shop");
  const edit = gh.calls.find((c) => c.startsWith("gh pr edit"));
  expect(edit).toContain("Fixes the flaky cart test.");
  expect(edit).toContain("bun test");
  expect(loadLeads()[lead.key]?.opened).toEqual([]);
  if (!pr) throw new Error("not adopted");
  await leadShipStep(leadPrKey("HONEY", "o/shop", 12), pr, SHIP, "abc", gh.run, () => false);
  expect(enabled(gh.calls)).toHaveLength(1);
  expect(pr.ship?.on).toBe(true);
});

test("a PR that isn't the lead's own is never taken in: another repo, another author, a fork's branch, another time", async () => {
  // a URL in a repo that isn't one of the project's
  expect(await adoptOne(github(), [opened("https://github.com/evil/shop/pull/12")])).toBeUndefined();
  expect(await adoptOne(github({ pr: { author: { login: "mallory" } } }))).toBeUndefined();
  expect(await adoptOne(github({ pr: { isCrossRepository: true } }))).toBeUndefined();
  expect(await adoptOne(github({ pr: { createdAt: iso(NOW - 3600_000) } }))).toBeUndefined();
  // gh signed in as nobody it can tell: nothing is the lead's
  expect(await adoptOne(github({ me: "" }))).toBeUndefined();
  expect(await adoptOne(github())).toBeDefined();
});

test("two repos with the same name under different owners keep two keys", async () => {
  withOpened([opened("https://github.com/a/shop/pull/12"), opened("https://github.com/b/shop/pull/12")]);
  const state = blankState();
  await adoptLeadPrs(state, deps(github().run, ["a/shop", "b/shop"]));
  expect(Object.keys(state.prs).sort()).toEqual([leadPrKey("HONEY", "a/shop", 12), leadPrKey("HONEY", "b/shop", 12)]);
  expect(leadPrKey("HONEY", "a/shop", 12)).not.toBe(leadPrKey("HONEY", "b/shop", 12));
});

test("no auto-merge while a lead of the project runs, even when one starts during the request", async () => {
  const gh = github();
  const pr = await adoptOne(gh);
  if (!pr) throw new Error("not adopted");
  const key = leadPrKey("HONEY", "o/shop", 12);
  await leadShipStep(key, pr, SHIP, "abc", gh.run, () => true);
  expect(enabled(gh.calls)).toEqual([]);
  // free when checked, busy by the time the request returns: turned straight off again
  let asked = 0;
  await leadShipStep(key, pr, SHIP, "abc", gh.run, () => asked++ >= 2);
  expect(enabled(gh.calls)).toHaveLength(1);
  expect(pr.ship?.on).toBe(false);
  expect(gh.live.autoMergeRequest).toBeNull();
});

test("Ship turned off between adoption and arming: nothing is armed", async () => {
  const gh = github();
  const pr = await adoptOne(gh);
  if (!pr) throw new Error("not adopted");
  applyConfig({ ...CFG, clients: CFG.clients.map((c) => (c.name === "Honeycrust" ? { ...c, autonomy: "act" as const } : c)) });
  await leadShipStep(leadPrKey("HONEY", "o/shop", 12), pr, SHIP, "abc", gh.run, () => false);
  expect(enabled(gh.calls)).toEqual([]);
});

test("a head its proof doesn't cover waits, until a later run that pushed that branch vouches for it", async () => {
  const gh = github({ pr: { headRefOid: "def", commits: [{ committedDate: iso(NOW - 10_000) }] } });
  const pr = await adoptOne(github());
  if (!pr) throw new Error("not adopted");
  const key = leadPrKey("HONEY", "o/shop", 12);
  await leadShipStep(key, pr, SHIP, "def", gh.run, () => false);
  expect(pr.proof).toBeUndefined();
  expect(enabled(gh.calls)).toEqual([]);
  // a later run that didn't name the branch: still waiting for you
  const state = { ...blankState(), prs: { [key]: pr } };
  const at = pr.proofOff ?? NOW;
  withOpened([], [{ branch: "other", log: "", from: at, to: NOW }]);
  await adoptLeadPrs(state, deps(gh.run));
  expect(pr.proof).toBeUndefined();
  // one that pushed it by name and made its newest commit: a fresh proof, for that head
  withOpened([], [{ branch: "fix/flaky-cart", log: LOG, from: at, to: NOW + 1000 }]);
  await adoptLeadPrs(state, deps(gh.run));
  expect(pr.proof).toBeDefined();
  expect(pr.proofHead).toBe("def");
  await leadShipStep(key, pr, SHIP, "def", gh.run, () => false);
  expect(enabled(gh.calls)).toHaveLength(1);
});

test("before a lead starts, its project's armed lead PRs go off and lose their proof; a failed turn-off holds the start", async () => {
  const gh = github();
  const pr = await adoptOne(gh);
  if (!pr) throw new Error("not adopted");
  const key = leadPrKey("HONEY", "o/shop", 12);
  await leadShipStep(key, pr, SHIP, "abc", gh.run, () => false);
  // the work pass armed it in memory and hasn't saved: its Ship request on record still counts as armed
  expect(loadState().prs[key]).toBeUndefined();
  expect(armedLeadPrs("Honeycrust", loadState().prs).map(([k]) => k)).toEqual([key]);
  expect(armedLeadPrs("Other", loadState().prs)).toEqual([]);
  saveState({ ...blankState(), prs: { [key]: pr } });

  // turning it off fails: it stays armed, so the start keeps waiting
  const failing = github({ disarmFails: true });
  failing.live.autoMergeRequest = { enabledAt: "now" };
  await releaseLeadPrs(armedLeadPrs("Honeycrust", loadState().prs), failing.run);
  expect(armedLeadPrs("Honeycrust", loadState().prs).map(([k]) => k)).toEqual([key]);

  await releaseLeadPrs(armedLeadPrs("Honeycrust", loadState().prs), gh.run);
  expect(gh.live.autoMergeRequest).toBeNull();
  expect(armedLeadPrs("Honeycrust", loadState().prs)).toEqual([]);
  const saved = loadState().prs[key];
  expect(saved?.ship?.on ?? false).toBe(false);
  expect(saved?.proof).toBeUndefined();
  expect(loadShips().at(-1)?.off).toBeGreaterThan(0);
});

test("off Ship a lead's PR isn't taken in: it waits for your merge, as before", async () => {
  applyConfig({ ...CFG, clients: CFG.clients.map((c) => (c.name === "Honeycrust" ? { ...c, autonomy: "act" as const } : c)) });
  const gh = github();
  expect(await adoptOne(gh)).toBeUndefined();
  expect(gh.calls.filter((c) => !c.startsWith("gh api user"))).toEqual([]);
  expect(loadLeads()[lead.key]?.opened).toEqual([]);
});

test("a backslash outside quotes is never one plain command: the shell would run what it hides", () => {
  const cmd = "gh pr create --fill \\' ; echo https://github.com/o/shop/pull/99 ; echo \\'";
  expect(prsOpened(transcript([[cmd, "https://github.com/o/shop/pull/99"]]))).toEqual([]);
});

test("a $'…' quote or any $ outside quotes is never one plain command either", () => {
  const cmd = "gh pr create --fill $'\\'' ; echo https://github.com/o/shop/pull/99 ; echo \\'";
  expect(prsOpened(transcript([[cmd, "https://github.com/o/shop/pull/99"]]))).toEqual([]);
  expect(plainCommand("gh pr create --title $TITLE")).toBeNull();
  // a body from a heredoc stays one argument: $( inside double quotes is how agents write PR bodies
  expect(plainCommand('gh pr create --title "Fix" --body "$(cat <<\'EOF\'\nok\nEOF\n)"')).not.toBeNull();
});

test("a PR whose newest commit came after the run that opened it is tracked without proof, so it can't be armed", async () => {
  const gh = github({ pr: { commits: [{ committedDate: iso(NOW + 3600_000) }] } });
  // a push to its branch from a run before it was taken in vouches for nothing
  withOpened([opened()], [{ branch: "fix/flaky-cart", log: LOG, from: NOW - 60_000, to: NOW }]);
  const state = blankState();
  await adoptLeadPrs(state, deps(gh.run));
  const [key, pr] = Object.entries(state.prs)[0] ?? [];
  if (!key || !pr) throw new Error("not tracked");
  expect(pr.proof).toBeUndefined();
  expect(pr.proofOff).toBeGreaterThan(0);
  await leadShipStep(key, pr, SHIP, "abc", gh.run, () => false);
  expect(enabled(gh.calls)).toEqual([]);
});

test("a group's lead and a lead with no project but the project's folder count as the project's leads", async () => {
  const dir = CLIENTS.find((c) => c.name === "Honeycrust")?.dir ?? "";
  applyConfig({ ...CFG, groups: [{ name: "Bakeries", members: ["Honeycrust"], rules: {} }] });
  const group = { ...lead, key: "bakeries", project: "Bakeries", dir: "elsewhere" };
  const folder = { ...lead, key: "folder", project: "", dir: `${dir}/web` };
  expect(leadCovers(group, "Honeycrust")).toBe(true);
  expect(leadCovers(folder, "Honeycrust")).toBe(true);
  expect(leadCovers({ ...lead, project: "", dir: "unrelated" }, "Honeycrust")).toBe(false);
  applyConfig({ ...CFG, godmode: [group] });
  // the group's lead opened it: taken in under the member whose repo it is
  saveLeads({ bakeries: { ...blankLead(), opened: [opened()] } });
  const state = blankState();
  await adoptLeadPrs(state, deps(github().run));
  const pr = Object.values(state.prs)[0];
  expect(pr?.lead).toBe("bakeries");
  if (!pr) throw new Error("not adopted");
  const gh = github();
  await leadShipStep(leadPrKey("HONEY", "o/shop", 12), pr, SHIP, "abc", gh.run, () => false);
  // armed: the group lead's start holds for it, and so would a folder lead's
  expect(leadShipHolds(group, gh.run)).toBe(true);
  expect(leadShipHolds(folder, gh.run)).toBe(true);
});

test("a turn-off that failed is tried again on every pass while a lead runs", async () => {
  const gh = github();
  const pr = await adoptOne(gh);
  if (!pr) throw new Error("not adopted");
  const key = leadPrKey("HONEY", "o/shop", 12);
  await leadShipStep(key, pr, SHIP, "abc", gh.run, () => false);
  expect(pr.ship?.on).toBe(true);
  const failing = github({ disarmFails: true });
  failing.live.autoMergeRequest = { enabledAt: "now" };
  await leadShipStep(key, pr, SHIP, "abc", failing.run, () => true);
  expect(pr.ship?.on).toBe(true);
  await leadShipStep(key, pr, SHIP, "abc", gh.run, () => true);
  expect(pr.ship?.on ?? false).toBe(false);
  expect(gh.live.autoMergeRequest).toBeNull();
});

test("lead PR keys never collide across owners and repos whose names run together", () => {
  expect(leadPrKey("HONEY", "a-b/c", 1)).not.toBe(leadPrKey("HONEY", "a/b-c", 1));
  expect(leadPrKey("HONEY", "a/shop", 12)).not.toBe(leadPrKey("HONEY", "b/shop", 12));
});
