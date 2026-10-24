import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CFG } from "../src/env";
import { inboxPathOf, leadInbox } from "../src/leads";
import { push } from "../src/notify";
import { type NtfyAction, quickReplies, REPLY_TTL_MS, replyActions } from "../src/replies";
import { handle } from "../src/server";

const TAILNET = "https://mac.example.ts.net";
const lead = {
  key: "phone-test",
  label: "Phone test lead",
  name: "",
  dir: "phone-test",
  project: "",
  goal: "",
  prompt: "",
  supervised: false,
  onDemand: false,
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
const QUESTION = "## Which database for the cache?\n\nI recommend Redis.\n\nOptions: Redis | Postgres\n";
const saved = { ntfy: CFG.ntfySecret, origins: CFG.dashboardOrigins, godmode: CFG.godmode };

beforeAll(() => {
  Object.assign(CFG, { ntfySecret: "overhand-ntfy-test", dashboardOrigins: [TAILNET], godmode: [...CFG.godmode, lead] });
});
afterAll(() => {
  Object.assign(CFG, { ntfySecret: saved.ntfy, dashboardOrigins: saved.origins, godmode: saved.godmode });
  rmSync(dirname(inboxPathOf(lead)), { recursive: true, force: true });
});

/** Asks the question afresh and returns the push's buttons. */
function ask(now = Date.now()): NtfyAction[] {
  mkdirSync(dirname(inboxPathOf(lead)), { recursive: true });
  writeFileSync(inboxPathOf(lead), QUESTION);
  const box = leadInbox(lead);
  if (!box) throw new Error("no inbox");
  return replyActions(lead.key, box.at, box.text, now);
}
/** What the phone does when a button is tapped: a bare POST, no Origin. */
const tap = (a: NtfyAction | undefined) => handle(new Request(a?.url ?? `${TAILNET}/api/lead/reply`, { method: "POST" }));

test("a question's Options line becomes quick replies; a free question offers the recommendation; a report offers none", () => {
  expect(quickReplies(QUESTION)).toEqual(["Redis", "Postgres"]);
  expect(quickReplies("## Ship on Friday?\n\n**Options:** yes / no")).toEqual(["yes", "no"]);
  expect(quickReplies("## Old\n\nOptions: a | b\n\n## Rename the API?\n\nMy recommendation: keep it.")).toEqual([
    "Go with your recommendation.",
  ]);
  expect(quickReplies("## What should the pricing be?")).toEqual([]);
  expect(quickReplies("## Report (2026-10-19 07:00)\n\nI recommend nothing. Options: a | b")).toEqual([]);
});

test("the push carries two replies and Open, all on the phone-reachable address", () => {
  const actions = ask();
  expect(actions.map((a) => [a.action, a.label])).toEqual([
    ["http", "Redis"],
    ["http", "Postgres"],
    ["view", "Open"],
  ]);
  for (const a of actions) expect(a.url.startsWith(TAILNET)).toBe(true);
});

test("a valid reply answers the lead once; the same button again is refused", async () => {
  const [redis, postgres] = ask();
  const r = await tap(postgres);
  expect(r.status).toBe(200);
  expect(readFileSync(inboxPathOf(lead), "utf8")).toMatch(/## Answer from .+\n\nPostgres\n$/);
  expect((await tap(postgres)).status).toBe(410);
  expect((await tap(redis)).status).toBe(410); // one token per push: the other button is spent too
  expect(readFileSync(inboxPathOf(lead), "utf8").split("## Answer from").length).toBe(2);
});

test("an expired reply is refused and writes nothing", async () => {
  const [redis] = ask(Date.now() - REPLY_TTL_MS - 1);
  expect((await tap(redis)).status).toBe(410);
  expect(readFileSync(inboxPathOf(lead), "utf8")).toBe(QUESTION);
});

test("a reply to a question that changed since is refused", async () => {
  const [redis] = ask();
  writeFileSync(inboxPathOf(lead), `${QUESTION}\n## Another question\n`);
  // Linux stamps mtimes on a coarse clock tick, so two writes this close can share one; a real change comes later
  const later = new Date(Date.now() + 2000);
  utimesSync(inboxPathOf(lead), later, later);
  expect((await tap(redis)).status).toBe(409);
});

test("no token, a made-up token or a tampered choice writes nothing", async () => {
  expect((await tap(undefined)).status).toBe(410);
  expect((await handle(new Request(`${TAILNET}/api/lead/reply?t=guess&c=0`, { method: "POST" }))).status).toBe(410);
  const [redis] = ask();
  expect((await tap({ action: "view", label: "", url: (redis?.url ?? "").replace("c=0", "c=7") })).status).toBe(400);
  expect(readFileSync(inboxPathOf(lead), "utf8")).toBe(QUESTION);
});

test("a reply can't be read with GET, so a link preview can't answer", async () => {
  const [redis] = ask();
  // from the phone's address an unpaired GET stops at sign-in; only the POST is open to the token
  expect((await handle(new Request(redis?.url ?? "", { method: "GET" }))).status).toBe(401);
  expect((await tap(redis)).status).toBe(200);
});

test("without ntfy, or without an address the phone can reach, the push has no buttons", () => {
  CFG.dashboardOrigins = [];
  expect(ask()).toEqual([]);
  CFG.dashboardOrigins = [TAILNET];
  CFG.ntfySecret = "";
  expect(ask()).toEqual([]);
  CFG.ntfySecret = "overhand-ntfy-test";
});

test("the buttons reach ntfy as its actions parameter", async () => {
  let got = "";
  const fake = Bun.serve({
    port: 0,
    fetch: (req) => {
      got = new URL(req.url).searchParams.get("actions") ?? "";
      return new Response("{}");
    },
  });
  try {
    const actions = ask();
    await push("Phone test lead needs you", "## Which database for the cache?", actions, `http://127.0.0.1:${fake.port}/topic`);
    expect(JSON.parse(got)).toEqual(actions);
  } finally {
    fake.stop(true);
  }
});
