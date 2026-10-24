import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LeadScopeResultSchema, OrganiseSchema, SuggestionsSchema } from "@overhand/contract";
import { saveConfig } from "../src/config";
import { applyConfig, CFG, CLIENTS, OPS, UI_PORT } from "../src/env";
import { handle } from "../src/server";
import { localRequest } from "./local";

const origin = `http://127.0.0.1:${UI_PORT}`;
const get = async (path: string) => (await handle(localRequest(`${origin}${path}`))).json();
const post = (path: string, body: object, headers: Record<string, string> = { origin }) =>
  handle(
    localRequest(`${origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

let before = structuredClone(CFG);
beforeAll(() => {
  before = structuredClone(CFG);
  // a lead made here must never start a real agent, and the scans read a scratch code folder, never yours
  writeFileSync(join(OPS, "PAUSE"), "");
  const code = mkdtempSync(join(tmpdir(), "overhand-organise-api-"));
  applyConfig(saveConfig(OPS, { ...CFG, codeRoot: code, projectsDir: code }));
});
afterAll(() => {
  rmSync(join(OPS, "PAUSE"), { force: true });
  applyConfig(saveConfig(OPS, before));
  rmSync(join(OPS, "organise.json"), { force: true });
});

test("the organise routes: read the grouping, keep one, set rules and lead scope; only from the dashboard", async () => {
  const view = OrganiseSchema.parse(await get("/api/organise"));
  expect(view.groups).toEqual([]);
  expect(view.loose.map((m) => m.name)).toEqual(["Honeycrust", "Fernway"]);
  expect(view.proposal.flatMap((g) => g.members).sort()).toEqual(["Fernway", "Honeycrust"]);

  expect((await post("/api/organise/accept", { groups: [{ name: "Clients", members: ["Honeycrust", "Fernway"] }] }, {})).status).toBe(403);
  expect((await post("/api/organise/accept", { groups: [{ name: "Clients", members: ["Honeycrust", "Fernway"] }] })).status).toBe(200);
  expect(CFG.groups.map((g) => g.name)).toEqual(["Clients"]);

  // a group rule reaches the live projects at once; reset makes a member that set its own follow too
  expect((await post("/api/organise/rules", { group: "Clients", rules: { autonomy: "propose" }, reset: true })).status).toBe(200);
  expect(CLIENTS.map((c) => c.autonomy)).toEqual(["propose", "propose"]);
  expect((await post("/api/organise/rules", { group: "Nope", rules: {} })).status).toBe(404);

  const dry = LeadScopeResultSchema.parse(
    await (await post("/api/organise/lead", { group: "Clients", scope: "group", dryRun: true })).json(),
  );
  expect(dry).toMatchObject({ added: ["clients-lead"], applied: false });
  expect(CFG.godmode).toEqual([]);
  const done = LeadScopeResultSchema.parse(await (await post("/api/organise/lead", { group: "Clients", scope: "group" })).json());
  expect(done.applied).toBe(true);
  expect(CFG.godmode.map((l) => [l.key, l.project])).toEqual([["clients-lead", "Clients"]]);
  expect(CFG.groups[0]?.lead).toBe("group");

  expect((await post("/api/organise/move", { project: "Fernway", to: "" })).status).toBe(200);
  expect(CFG.groups[0]?.members).toEqual(["Honeycrust"]);
});

test("suggestions come as decision cards, through /api/brief too", async () => {
  const { suggestions } = SuggestionsSchema.parse(await get("/api/organise/suggestions"));
  for (const b of suggestions) {
    expect(b.kind).toBe("organise");
    expect(await get(`/api/brief?id=${encodeURIComponent(b.id)}`)).toMatchObject({ id: b.id, kind: "organise" });
  }
  expect((await handle(localRequest(`${origin}/api/brief?id=organise:nothing`))).status).toBe(404);
  expect((await post("/api/organise/suggestion", { id: "nothing", action: "apply" })).status).toBe(404);
});
