/**
 * A lead's pull requests on a Ship project go through the same one Ship step as a ticket's (ship.ts): the work pass
 * takes in each PR a lead's run opened (`LeadState.opened`), once GitHub confirms it's the lead's own (in one of the
 * project's repos, by the signed-in account, from a branch of that repo, opened during that run), puts that run's proof
 * on it and tracks it like an agent PR. `leadShipStep` then hands it to GitHub's auto-merge once every guardrail allows,
 * only for the head commit its proof was read for, and only while none of its project's leads runs (`leadBusy`).
 * Anything it can't confirm waits for your merge. Overhand runs no fix rounds on it: its lead answers its reviews itself.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Proof, proofMarkdown } from "@overhand/contract";
import { gitRepos } from "./cleanup";
import type { Client } from "./config";
import { CFG, CLIENTS, CODE, clientOf, sh, shAsync } from "./env";
import { type Godmode, type LeadState, leadBusy, leadCovers, leadName, loadLeads, saveLeads } from "./leads";
import { report } from "./notify";
import { scanOutward } from "./outward";
import { assembleProof } from "./proof";
import { disarmForPush, githubSlug, type Run, shipStep } from "./ship";
import type { State, TrackedPr } from "./state";

const PR = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/;
/** Clock slack between this machine and GitHub when a PR's times are checked against a run's. */
const SLACK_MS = 2 * 60_000;

/**
 * The key a lead's PR is tracked under: its project's prefix (so `clientOf` finds the project), its repo's name, a short
 * hash of its whole `owner/repo` (so `a-b/c` and `a/b-c` never share a key) and its number.
 */
export const leadPrKey = (prefix: string, repo: string, number: number): string =>
  `${prefix}-LEAD-${repo.split("/").pop()}-${Bun.hash(repo.toLowerCase()).toString(36).slice(0, 7)}-${number}`;

/** A project's own GitHub repos: each git repo in its folder and its origin's slug. */
export type ProjectRepos = (c: Pick<Client, "dir">) => { dir: string; slug: string }[];
export const projectRepos: ProjectRepos = (c) =>
  gitRepos(join(CODE, c.dir))
    .map((dir) => ({ dir, slug: githubSlug(sh(["git", "remote", "get-url", "origin"], dir).out) }))
    .filter((r) => r.slug);

/** What the work pass checks a lead's PR against: gh, the project's own repos, and the account gh is signed in as. */
export interface LeadPrDeps {
  run: Run;
  repos: ProjectRepos;
}

/** The PR as GitHub has it, for telling whether it's the lead's own. */
export interface LeadPrView {
  state: string;
  isDraft: boolean;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  body: string;
  files: { path: string; additions: number; deletions: number }[];
  author: { login: string };
  isCrossRepository: boolean;
  createdAt: string;
  commits: { committedDate: string }[];
}

const within = (iso: string, w: { from: number; to: number }): boolean => {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= w.from - SLACK_MS && t <= w.to + SLACK_MS;
};

/**
 * Why GitHub's own answer rules a PR out as this lead's ("" when it's the lead's): it must be open, by the account gh
 * is signed in as (the one leads work as), from a branch of the same repo (never a fork's), and, when `opened` gives the
 * run, opened during that run.
 */
export function notTheLeads(v: Partial<LeadPrView>, me: string, opened?: { from: number; to: number }): string {
  if (v.state !== "OPEN") return "it isn't open";
  if (!me || v.author?.login?.toLowerCase() !== me.toLowerCase()) return `it's by ${v.author?.login ?? "someone else"}, not ${me || "you"}`;
  if (v.isCrossRepository !== false) return "its branch is in another repository";
  if (opened && !within(v.createdAt ?? "", opened)) return "it wasn't opened during that run";
  return "";
}

const firstLine = (t: string): string => t.trim().split("\n")[0] ?? "";
const numstatOf = (v: Partial<LeadPrView>): string => (v.files ?? []).map((f) => `${f.additions}\t${f.deletions}\t${f.path}`).join("\n");
const proofFrom = (log: string, v: Partial<LeadPrView>): Proof =>
  assembleProof({ transcript: existsSync(log) ? readFileSync(log, "utf8") : "", numstat: numstatOf(v), verified: "" });

async function view(url: string, run: Run, fields: string): Promise<Partial<LeadPrView> | string> {
  const r = await run(["gh", "pr", "view", url, "--json", fields]);
  return r.ok ? (JSON.parse(r.out || "{}") as Partial<LeadPrView>) : `couldn't read it: ${firstLine(r.err)}`;
}
const ADOPT_FIELDS = "state,isDraft,headRefName,headRefOid,baseRefName,body,files,author,isCrossRepository,createdAt";

/**
 * Takes in one PR a lead opened on a Ship project, once it's confirmed as the lead's own: that run's proof goes on the
 * PR (through the outward firewall, like a ticket PR's body) and the PR is tracked under `leadPrKey`. Returns why it
 * wasn't, or "" (also off Ship, where it simply waits for you as it always did).
 */
async function adopt(g: Godmode, o: NonNullable<LeadState["opened"]>[number], state: State, me: string, d: LeadPrDeps): Promise<string> {
  const m = o.url.match(PR);
  const slug = m?.[1] ?? "";
  // the project among those the lead may push to (its own, its group's members, its folder's) whose repo this is
  const same = (r: { slug: string }) => r.slug.toLowerCase() === slug.toLowerCase();
  const c = CLIENTS.find((x) => leadCovers(g, x.name) && d.repos(x).some(same));
  if (!slug || !c)
    return CLIENTS.some((x) => leadCovers(g, x.name) && x.autonomy === "ship") ? `${slug || o.url} isn't one of its projects' repos` : "";
  if (c.autonomy !== "ship" || c.host !== "github") return "";
  const own = d.repos(c).find(same);
  if (!own) return `${slug} isn't one of ${c.name}'s repos`;
  const number = Number(m?.[2]);
  const key = leadPrKey(c.prefix, own.slug, number);
  if (state.prs[key] || Object.values(state.prs).some((p) => p.url === o.url)) return "";
  const v = await view(o.url, d.run, `${ADOPT_FIELDS},commits`);
  if (typeof v === "string") return v;
  const why = notTheLeads(v, me, o);
  if (why) return why;
  // its newest commit must be that run's too: one pushed later (by a person, another run) has no proof until a run
  // after this one pushes the branch, so it's tracked without one and waits for you till then
  const fromRun = within(v.commits?.at(-1)?.committedDate ?? "", o);
  const proof = fromRun ? proofFrom(o.log, v) : undefined;
  if (proof) {
    const section = proofMarkdown(proof, CFG.outward.aiAttribution);
    if (scanOutward(section, [c.name]).length) return "its proof names something private, so it stays off the PR";
    const edit = await d.run(["gh", "pr", "edit", o.url, "--body", [(v.body ?? "").trimEnd(), section].filter(Boolean).join("\n\n")]);
    if (!edit.ok) return `couldn't put its proof on it: ${firstLine(edit.err)}`;
  }
  state.prs[key] = {
    url: o.url,
    host: "github",
    repo: own.slug,
    number,
    branch: v.headRefName ?? "",
    base: v.baseRefName ?? "",
    mainRepo: own.dir, // the checkout Undo reverts in
    repoPath: own.dir,
    seen: "",
    fixes: 0,
    draft: Boolean(v.isDraft),
    openedAt: Date.now(),
    proof,
    proofHead: v.headRefOid ?? "",
    ...(proof ? {} : { proofOff: Date.now() }),
    lead: g.key,
  };
  report(`🔗 ${key}: ${leadName(g)} opened ${o.url}; on Ship it goes to GitHub's auto-merge once every check and rule allows`);
  return "";
}

/**
 * A fresh proof for a lead PR whose proof was cleared: only from a lead run of its project that started after it was
 * cleared, pushed its branch by name and made its head commit, with the PR still the lead's own. Returns why not, or
 * "" when it has its proof again; with no such run it keeps waiting for you.
 */
async function reprove(pr: TrackedPr, pushes: NonNullable<LeadState["pushed"]>, me: string, d: LeadPrDeps): Promise<string> {
  const p = pushes.filter((x) => x.branch === pr.branch && x.from >= (pr.proofOff ?? 0)).at(-1);
  if (!p) return "";
  const v = await view(pr.url, d.run, `${ADOPT_FIELDS},commits`);
  if (typeof v === "string") return v;
  const why = notTheLeads(v, me);
  if (why) return why;
  if (!within(v.commits?.at(-1)?.committedDate ?? "", p)) return "its newest commit isn't from that run";
  Object.assign(pr, { proof: proofFrom(p.log, v), proofHead: v.headRefOid ?? "", proofOff: undefined });
  return "";
}

/**
 * The work pass's first step on leads' PRs: every PR a lead's run opened is taken in for Ship once confirmed (off Ship
 * it's left to you, as before), and a lead PR whose proof was cleared gets a fresh one from a later run that pushed it.
 * What was read is then cleared from the leads' state, re-read first: the supervisor writes it every minute.
 */
export async function adoptLeadPrs(state: State, d: LeadPrDeps = { run: shAsync, repos: projectRepos }): Promise<void> {
  const leads = loadLeads();
  const opened = CFG.godmode.flatMap((g) => (leads[g.key]?.opened ?? []).map((o) => ({ g, o })));
  const pushed = CFG.godmode.flatMap((g) => (leads[g.key]?.pushed ?? []).map((p) => ({ g, p })));
  if (!opened.length && !pushed.length) return;
  const who = await d.run(["gh", "api", "user", "--jq", ".login"]);
  const me = who.ok ? who.out.trim() : "";
  for (const { g, o } of opened) {
    const why = await adopt(g, o, state, me, d).catch((e: unknown) => String(e));
    if (why) report(`✋ ${leadName(g)}'s ${o.url} waits for your merge: ${why}`);
  }
  for (const [key, pr] of Object.entries(state.prs)) {
    const project = clientOf(key)?.name;
    if (!pr.lead || pr.proof || !project) continue;
    const mine = pushed.filter((x) => leadCovers(x.g, project)).map((x) => x.p);
    const why = await reprove(pr, mine, me, d).catch((e: unknown) => String(e));
    if (why) report(`✋ ${key}: ${pr.url} waits for your merge: ${why}`);
  }
  const done = new Set<unknown>([...opened.map((x) => x.o), ...pushed.map((x) => x.p)].map((x) => JSON.stringify(x)));
  const fresh = loadLeads();
  for (const g of CFG.godmode) {
    const st = fresh[g.key];
    if (!st) continue;
    st.opened = (st.opened ?? []).filter((o) => !done.has(JSON.stringify(o)));
    st.pushed = (st.pushed ?? []).filter((p) => !done.has(JSON.stringify(p)));
  }
  saveLeads(fresh);
}

/**
 * Ship's step for a lead's PR: the head commit must be the one its proof was read for (a newer one clears the proof,
 * so it waits until a later run vouches for it), and no lead of its project may run, checked again right before and
 * right after the request (`shipStep`'s `canArm`).
 */
export async function leadShipStep(
  key: string,
  pr: TrackedPr,
  c: Pick<Client, "name" | "autonomy" | "ship">,
  head: string,
  run: Run = shAsync,
  busy: () => boolean = () => leadBusy(c.name),
): Promise<void> {
  if (pr.proof && pr.proofHead !== head) {
    Object.assign(pr, { proof: undefined, proofOff: Date.now() });
    report(`✋ ${key}: ${pr.url} has commits its proof doesn't cover; it waits until a lead run vouches for them`);
  }
  if (busy()) {
    // a lead may push now: one still armed (a turn-off that failed before) is tried again every pass
    if (pr.ship?.on) await disarmForPush(key, pr, run);
    return;
  }
  await shipStep(key, pr, c, head, run, Date.now(), () => !busy());
}
