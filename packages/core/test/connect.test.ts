/**
 * Connect over MCP against a fake local OAuth 2.1 + MCP server: discovery, dynamic registration, PKCE, the state and
 * nonce checks, token storage, refresh, disconnect, and which tracker adapter a client gets. Nothing leaves 127.0.0.1.
 */
import { afterAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentMcpServers, claudeMcpServers } from "../src/agent-home";
import { type Client, saveConfig } from "../src/config";
import { CLIENTS, UI_PORT } from "../src/env";
import {
  callTool,
  connected,
  disconnect,
  finishConnect,
  grantItem,
  pkce,
  SERVICES,
  safeUrl,
  sseData,
  startConnect,
  type TokenStore,
  useTokenStore,
} from "../src/mcp";
import { agentServerFor } from "../src/onboard";
import { RUNTIMES } from "../src/runtimes";
import { handle } from "../src/server";
import { parseSentryIssues } from "../src/status/sentry";
import { adapterOf } from "../src/trackers/index";
import { localRequest } from "./local";

// ---------- the fake server ----------

const fake = {
  challenge: "",
  redirect: "",
  /** Access tokens the MCP endpoint accepts right now. */
  valid: new Set<string>(),
  issued: 0,
  refreshed: 0,
  registered: [] as unknown[],
};

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    const base = `http://127.0.0.1:${u.port}`;
    if (u.pathname === "/.well-known/oauth-protected-resource/mcp")
      return Response.json({ resource: `${base}/mcp`, authorization_servers: [base] });
    if (u.pathname === "/.well-known/oauth-authorization-server")
      return Response.json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        code_challenge_methods_supported: ["S256"],
      });
    if (u.pathname === "/register") {
      const body: unknown = await req.json();
      fake.registered.push(body);
      return Response.json({ client_id: `client-${fake.registered.length}` });
    }
    if (u.pathname === "/authorize") {
      // the person approves at once: back to the redirect with a code, the state, and the issuer
      fake.challenge = u.searchParams.get("code_challenge") ?? "";
      fake.redirect = u.searchParams.get("redirect_uri") ?? "";
      const back = new URL(fake.redirect);
      back.searchParams.set("code", "the-code");
      back.searchParams.set("state", u.searchParams.get("state") ?? "");
      back.searchParams.set("iss", base);
      return Response.redirect(back.toString(), 302);
    }
    if (u.pathname === "/token") {
      const f = new URLSearchParams(await req.text());
      if (f.get("resource") !== `${base}/mcp`) return Response.json({ error: "invalid_target" }, { status: 400 });
      if (f.get("grant_type") === "authorization_code") {
        const verifier = f.get("code_verifier") ?? "";
        const ok =
          f.get("code") === "the-code" &&
          f.get("redirect_uri") === fake.redirect &&
          createHash("sha256").update(verifier).digest("base64url") === fake.challenge;
        if (!ok) return Response.json({ error: "invalid_grant" }, { status: 400 });
      } else if (f.get("grant_type") !== "refresh_token" || f.get("refresh_token") !== "refresh-1")
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      else fake.refreshed++;
      const access = `access-${++fake.issued}`;
      fake.valid.add(access);
      return Response.json({ access_token: access, refresh_token: "refresh-1", expires_in: 3600, token_type: "Bearer" });
    }
    if (u.pathname === "/mcp") {
      if (!fake.valid.has((req.headers.get("authorization") ?? "").replace("Bearer ", "")))
        return new Response("", { status: 401, headers: { "www-authenticate": "Bearer" } });
      const m = (await req.json()) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      if (m.id === undefined) return new Response(null, { status: 202 });
      const reply = (result: unknown) =>
        new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result })}\n\n`, {
          headers: { "content-type": "text/event-stream", "mcp-session-id": "s1" },
        });
      if (m.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake" } });
      const text = (t: string) => reply({ content: [{ type: "text", text: t }] });
      switch (m.params?.name) {
        case "list_issues":
          return text(
            JSON.stringify({
              issues: [
                {
                  id: "HONEY-7",
                  title: "Fix login",
                  url: "https://linear.app/honeycrust/issue/HONEY-7",
                  status: "Todo",
                  statusType: "unstarted",
                  priority: { value: 2, name: "High" },
                  labels: ["agent"],
                  description: "It breaks",
                },
                { id: "HONEY-8", title: "Done one", status: "Done", statusType: "completed", labels: [] },
              ],
              hasNextPage: false,
            }),
          );
        case "list_comments":
          return text(JSON.stringify({ comments: [{ body: "please", author: { name: "Sam" }, createdAt: "2026-10-01" }] }));
        case "fail":
          return reply({ content: [{ type: "text", text: "nope" }], isError: true });
        default:
          return reply({ content: [], structuredContent: { echo: m.params?.arguments ?? {} } });
      }
    }
    return new Response("not found", { status: 404 });
  },
});
const BASE = `http://127.0.0.1:${server.port}`;
afterAll(() => server.stop(true));

/** A secret store in memory, so no test touches the Keychain. */
const memory = new Map<string, string>();
const store: TokenStore = {
  read: (k) => memory.get(k) ?? null,
  write: (k, v) => memory.set(k, v).has(k),
  remove: (k) => memory.delete(k) || true,
};

beforeEach(() => {
  memory.clear();
  useTokenStore(store);
  SERVICES.linear.mcp = `${BASE}/mcp`;
  fake.valid.clear();
});

/** Plays the browser: opens the consent page and returns where it redirects (the daemon's callback). */
async function consent(url: string): Promise<URL> {
  const r = await fetch(url, { redirect: "manual" });
  return new URL(r.headers.get("location") ?? "");
}
const nonceOf = (cb: URL) => cb.pathname.split("/").pop() ?? "";

test("PKCE: the challenge is the verifier's SHA-256, base64url, and every pair is new", () => {
  const a = pkce();
  const b = pkce();
  expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(a.challenge).toBe(createHash("sha256").update(a.verifier).digest("base64url"));
  expect(a.verifier).not.toBe(b.verifier);
});

test("only https, or http on this machine, may carry a credential", () => {
  expect(safeUrl("https://mcp.linear.app/mcp")).toBe("https://mcp.linear.app/mcp");
  expect(safeUrl("http://127.0.0.1:9/x")).toBe("http://127.0.0.1:9/x");
  expect(() => safeUrl("http://mcp.linear.app/mcp")).toThrow();
});

test("Connect registers a client for a 127.0.0.1 redirect with a nonce, and the callback stores tokens", async () => {
  const url = new URL(await startConnect("linear", 4999));
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("resource")).toBe(`${BASE}/mcp`);
  expect(url.searchParams.get("scope")).toBe("read write");
  const redirect = url.searchParams.get("redirect_uri") ?? "";
  expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:4999\/oauth\/callback\/[A-Za-z0-9_-]{22}$/);
  expect(fake.registered.at(-1)).toMatchObject({ redirect_uris: [redirect], token_endpoint_auth_method: "none" });

  const cb = await consent(url.toString());
  expect(await finishConnect(nonceOf(cb), cb.searchParams)).toBe("linear");
  expect(connected("linear")).toBe(true);
  const stored = JSON.parse(memory.get(grantItem("linear")) ?? "{}");
  expect(stored).toMatchObject({ access: "access-1", refresh: "refresh-1", resource: `${BASE}/mcp` });
  // used once: the same redirect again is refused
  await expect(finishConnect(nonceOf(cb), cb.searchParams)).rejects.toThrow(/expired/);
});

test("a redirect with the wrong state, an unknown nonce or another issuer is refused, and stores nothing", async () => {
  const wrongState = await consent(await startConnect("linear", 4999));
  wrongState.searchParams.set("state", "forged");
  await expect(finishConnect(nonceOf(wrongState), wrongState.searchParams)).rejects.toThrow(/doesn't match/);

  const cb = await consent(await startConnect("linear", 4999));
  await expect(finishConnect("not-a-nonce", cb.searchParams)).rejects.toThrow(/expired/);

  const otherIssuer = await consent(await startConnect("linear", 4999));
  otherIssuer.searchParams.set("iss", "https://evil.example");
  await expect(finishConnect(nonceOf(otherIssuer), otherIssuer.searchParams)).rejects.toThrow(/not Linear/);
  expect(memory.size).toBe(0);
});

test("Slack has no dynamic registration, so Connect says to use a token", async () => {
  await expect(startConnect("slack", 4999)).rejects.toThrow(/use a token/);
});

async function connectLinear(): Promise<void> {
  const cb = await consent(await startConnect("linear", 4999));
  await finishConnect(nonceOf(cb), cb.searchParams);
}

test("tools are called directly; a rejected token is refreshed once and the call goes through", async () => {
  await connectLinear();
  expect((await callTool("linear", "echo", { a: 1 })).data).toEqual({ echo: { a: 1 } });
  fake.valid.clear(); // the server revokes the access token
  const before = fake.refreshed;
  expect((await callTool("linear", "echo", { b: 2 })).data).toEqual({ echo: { b: 2 } });
  expect(fake.refreshed).toBe(before + 1);
  expect(JSON.parse(memory.get(grantItem("linear")) ?? "{}").access).toBe(`access-${fake.issued}`);
  await expect(callTool("linear", "fail", {})).rejects.toThrow(/Linear fail: nope/);
});

const linearClient = (): Client => {
  const base = CLIENTS[0];
  if (!base) throw new Error("the example config has a project");
  return { ...base, tracker: { kind: "linear", secret: "" } };
};

test("a Linear project reads through MCP when connected, through its token when not", async () => {
  const c = linearClient();
  expect(adapterOf(c).via).toBe("token");
  await connectLinear();
  const a = adapterOf(c);
  expect(a.via).toBe("mcp");
  const open = await a.tickets({ label: "agent" });
  expect(open.map((t) => t.key)).toEqual(["HONEY-7"]); // the completed one is left out
  expect(open[0]).toMatchObject({ title: "Fix login", priority: "High", labels: ["agent"], comments: ["Sam: please"] });
  expect(disconnect("linear")).toBe(true);
  expect(memory.has(grantItem("linear"))).toBe(false);
  expect(adapterOf(c).via).toBe("token");
  await expect(adapterOf(c).tickets({ mine: true })).rejects.toThrow(/isn't connected/);
});

test("a project with no tracker loads, has no tickets, and files none", async () => {
  const base = CLIENTS[0];
  if (!base) throw new Error("the example config has a project");
  const { tracker: _, ...rest } = base;
  const dir = mkdtempSync(join(tmpdir(), "no-tracker-"));
  const [loaded] = saveConfig(dir, { owner: { name: "Sam", keychainAccount: "sam" }, accounts: [], clients: [rest] }).clients;
  if (!loaded) throw new Error("the project was dropped");
  expect(loaded.tracker).toBeUndefined();
  const a = adapterOf({ ...rest, ...loaded });
  expect(a.via).toBe("none");
  expect(await a.tickets({ label: "agent" })).toEqual([]);
  await expect(a.create("t", "b", "agent")).rejects.toThrow(/no tracker/);
});

test("Sentry's markdown answer becomes issues", () => {
  const md = [
    "# Issues in **honeycrust**",
    "",
    "Found **2** issues:",
    "",
    "## 1. [WEB-1A](https://honeycrust.sentry.io/issues/WEB-1A)",
    "",
    "**TypeError: x is undefined**",
    "",
    "- **Status**: unresolved",
    "- **Users**: 12",
    "- **Events**: 340",
    "- **First seen**: 3 hours ago",
    "",
    "## 2. [API-9](https://honeycrust.sentry.io/issues/API-9)",
    "",
    "**Timeout**",
    "",
    "- **Users**: 0",
    "- **Events**: 5",
    "- **First seen**: 2026-01-02",
  ].join("\n");
  const issues = parseSentryIssues(md, "honeycrust");
  expect(issues.map((i) => [i.id, i.title, i.count, i.users, i.isNew])).toEqual([
    ["WEB-1A", "TypeError: x is undefined", 340, 12, true],
    ["API-9", "Timeout", 5, 0, false],
  ]);
});

test("an event stream's data lines are read per event", () => {
  expect(sseData('event: message\ndata: {"a":1}\n\ndata: {"b":\ndata: 2}\n\n')).toEqual(['{"a":1}', '{"b":\n2}']);
});

test("your agents' MCP servers are found in each CLI's config, and Claude Code's are carried into runs", () => {
  const home = mkdtempSync(join(tmpdir(), "overhand-home-"));
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer secret" } } },
      projects: { "/code/honeycrust": { mcpServers: { sentry: { type: "http", url: "https://mcp.sentry.dev/mcp" } } } },
    }),
  );
  mkdirSync(join(home, ".codex"));
  writeFileSync(
    join(home, ".codex", "config.toml"),
    '[mcp_servers.atlassian]\ncommand = "npx"\nargs = ["mcp-remote", "https://mcp.atlassian.com/v1/sse"]\n',
  );
  const found = agentMcpServers(home);
  expect(found.map((s) => `${s.cli}/${s.name}`)).toEqual(["Claude Code/linear", "Claude Code/sentry", "Codex/atlassian"]);
  expect(JSON.stringify(found)).not.toContain("secret"); // only names and endpoints
  expect(agentServerFor("jira", found)?.cli).toBe("Codex");
  expect(agentServerFor("slack", found)).toBeUndefined();

  const servers = claudeMcpServers("/code/honeycrust", home);
  expect(Object.keys(servers)).toEqual(["linear", "sentry"]);
  const base = {
    account: "a",
    cwd: "",
    prompt: "p",
    schema: "{}",
    schemaFile: "/tmp/s.json",
    alias: "",
    provider: { kind: "claude", auth: "login" } as const,
    model: "",
    attribution: false,
    args: [],
    configDir: "/ops/agent-home/claude-code",
    instructions: "",
    read: () => "oat",
    mcpServers: servers,
  };
  const run = RUNTIMES["claude-code"].task(base);
  const file = run.argv[run.argv.indexOf("--mcp-config") + 1] ?? "";
  expect(file).toContain("overhand-mcp-");
  expect(run.argv).toContain("--strict-mcp-config");
  expect(JSON.parse(run.files[file] ?? "{}")).toEqual({ mcpServers: servers });
  // the inbox names its own servers strictly: nothing is added to it
  const inbox = RUNTIMES["claude-code"].task({ ...base, args: ["--mcp-config", "slack.json", "--strict-mcp-config"] });
  expect(inbox.argv.filter((a) => a === "--mcp-config")).toHaveLength(1);
});

test("the dashboard starts a sign-in only from its own origin, and a stray callback stores nothing", async () => {
  const origin = `http://127.0.0.1:${UI_PORT}`;
  const post = (o: string) =>
    handle(
      localRequest(`${origin}/api/connect`, {
        method: "POST",
        headers: { origin: o, "content-type": "application/json" },
        body: JSON.stringify({ service: "linear" }),
      }),
    );
  expect((await post("https://evil.example")).status).toBe(403);
  const ok = await post(origin);
  expect(((await ok.json()) as { url: string }).url).toContain(`${BASE}/authorize`);
  const stray = await handle(localRequest(`${origin}/oauth/callback/nope?code=x&state=y`));
  expect(stray.status).toBe(400);
  expect(memory.size).toBe(0);
});
