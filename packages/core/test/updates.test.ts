import { afterAll, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { payloadFor, type Summary, type UpdateChannel, UpdateChannelSchema } from "@overhand/contract";
import { plainWords } from "@overhand/themes";
import { CFG, OPS } from "../src/env";
import { sendUpdate, tickUpdates, updateStatuses, webhookOk } from "../src/updates";

/** A fake webhook on this machine: it records what it's sent and answers with `status`. Nothing here leaves localhost. */
const got: { path: string; body: unknown }[] = [];
let status = 200;
const hook = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    got.push({ path: new URL(req.url).pathname, body: await req.json() });
    // a failing service that echoes its own URL back, as some do
    return status === 200 ? new Response("ok") : new Response(`bad hook ${req.url}`, { status });
  },
});
afterAll(() => {
  hook.stop(true);
  rmSync(join(OPS, "updates.json"), { force: true });
});
const URL_OF = (id: string) => `http://127.0.0.1:${hook.port}/hooks/${id}/s3cr3t`;
/** The secret store, swapped for a map; the real one is never touched. */
const store = (item: string) => (item.startsWith("status-update-") ? URL_OF(item.slice(14)) : null);
const deps = { secret: store, fetch: (url: string, init: RequestInit) => fetch(url, init) };

const ch = (kind: UpdateChannel["kind"], over: Partial<UpdateChannel> = {}): UpdateChannel =>
  UpdateChannelSchema.parse({ id: `team-${kind}`, name: `Team ${kind}`, kind, projects: ["Web"], ...over });

const S: Summary = {
  span: "day",
  from: 0,
  to: 1,
  shipped: [{ project: "Web", key: "WEB-1", title: "Fix the cart", url: "https://github.com/acme/web/pull/4" }],
  opened: [],
  review: [],
  blocked: [],
  next: [],
  spend: {},
  guides: [],
};

test("each platform's payload reaches its webhook as built, from the secret store's URL", async () => {
  for (const kind of ["slack", "teams", "discord"] as const) {
    got.length = 0;
    const c = ch(kind);
    expect(await sendUpdate(c, S, 1000, deps)).toBe("");
    expect(got).toEqual([
      { path: `/hooks/${c.id}/s3cr3t`, body: payloadFor(kind, S, plainWords, ["Web"], { attribution: CFG.outward.aiAttribution }) },
    ]);
  }
});

test("a failure is kept for Health without the URL, even when the service echoes it", async () => {
  status = 404;
  const c = ch("slack", { id: "broken" });
  const error = await sendUpdate(c, S, 2000, deps);
  status = 200;
  expect(error).toStartWith("HTTP 404");
  expect(error).not.toContain("s3cr3t");
  expect(error).not.toContain("127.0.0.1");
  const saved = readFileSync(join(OPS, "updates.json"), "utf8");
  expect(saved).not.toContain("s3cr3t");
  expect(JSON.parse(saved).broken).toEqual({ lastAt: 2000, sentAt: 2000, error });
});

test("no URL stored, or not https: nothing is sent", async () => {
  got.length = 0;
  expect(await sendUpdate(ch("slack"), S, 3000, { ...deps, secret: () => null })).toContain("No webhook URL stored");
  expect(await sendUpdate(ch("slack"), S, 3000, { ...deps, secret: () => "http://hooks.example.com/x" })).toContain("isn't an https URL");
  expect(got).toEqual([]);
  expect(webhookOk("https://hooks.slack.com/services/x")).toBe(true);
  expect(webhookOk("http://10.0.0.2/hook")).toBe(false);
  expect(webhookOk("not a url")).toBe(false);
});

test("the schedule: a new channel starts its clock, a due one sends, a quiet one is skipped", async () => {
  const before = CFG.updates;
  rmSync(join(OPS, "updates.json"), { force: true });
  const daily = ch("teams", { id: "standup" });
  const manual = ch("discord", { id: "by-hand", schedule: { when: "manual", hour: 9, weekday: 5 } });
  CFG.updates = [daily, manual];
  try {
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 5).getTime();
    let quiet = false;
    const tick = (now: number) => tickUpdates(now, { ...deps, summary: async () => (quiet ? { ...S, shipped: [] } : S) });
    got.length = 0;
    await tick(at(19, 10)); // first sight: no 9:00 post at 10:00
    expect(got).toEqual([]);
    expect(updateStatuses().map((u) => u.sentAt)).toEqual([0, 0]); // the clock started; nothing was sent
    await tick(at(20, 8)); // before the slot
    expect(got).toEqual([]);
    await tick(at(20, 9)); // the slot
    expect(got.map((g) => g.path)).toEqual(["/hooks/standup/s3cr3t"]);
    await tick(at(20, 9) + 60_000); // once per slot
    expect(got).toHaveLength(1);
    quiet = true;
    await tick(at(21, 9)); // nothing to say: nothing posted, slot spent
    expect(got).toHaveLength(1);
    expect(updateStatuses()[0]).toMatchObject({ id: "standup", sentAt: at(20, 9), error: "" });
  } finally {
    CFG.updates = before;
  }
  expect(existsSync(join(OPS, "updates.json"))).toBe(true);
});
