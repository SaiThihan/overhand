/**
 * Connect over MCP: the daemon is a small MCP client of the services' official remote MCP servers, signed in through
 * OAuth 2.1 with dynamic client registration and PKCE, so there is no app of ours to register and no secret to ship.
 * Connect opens the service's consent page; its redirect lands on this daemon at 127.0.0.1 under a per-flow nonce; the
 * tokens go to the secret store (never to a log or the dashboard) and refresh by themselves. The daemon calls the tools
 * directly, model-free. Discovery follows the MCP auth spec: the resource's protected-resource metadata (RFC 9728),
 * then its authorization server's metadata (RFC 8414).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { CFG } from "./env";
import { deleteSecret, readSecret, SECRET_STORE, writeSecret } from "./platform";

/**
 * The services Overhand signs in to over MCP. `dcr`: the server's authorization metadata has a registration endpoint
 * (checked 2026-10-19 at each `/.well-known/oauth-authorization-server`); Slack's has none and wants a registered app, so
 * Slack keeps reaching Overhand through the agents' own Slack MCP server.
 */
export const SERVICES = {
  linear: { label: "Linear", mcp: "https://mcp.linear.app/mcp", scope: "read write", dcr: true },
  jira: {
    label: "Jira",
    mcp: "https://mcp.atlassian.com/v2/mcp",
    scope: "read:jira:agent-interface write:jira:agent-interface search:jira:agent-interface offline_access",
    dcr: true,
  },
  sentry: { label: "Sentry", mcp: "https://mcp.sentry.dev/mcp", scope: "", dcr: true },
  slack: { label: "Slack", mcp: "https://mcp.slack.com/mcp", scope: "", dcr: false },
} satisfies Record<string, { label: string; mcp: string; scope: string; dcr: boolean }>;
export type McpService = keyof typeof SERVICES;
export const isMcpService = (s: string): s is McpService => s in SERVICES;

/** A URL Overhand may send a credential or a person to: https, or plain http only on this machine (the tests' fake server). */
export function safeUrl(raw: string): string {
  const u = new URL(raw);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if (u.protocol === "https:" || (u.protocol === "http:" && loopback)) return u.toString();
  throw new Error(`refusing a non-https OAuth or MCP URL: ${u.origin}`);
}

const b64url = (b: Buffer) => b.toString("base64url");

/** A PKCE pair (RFC 7636, S256): the verifier stays here, the challenge goes to the consent page. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** Constant-time string comparison, for the OAuth state. */
function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------- tokens in the secret store ----------

const GrantSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string().default(""),
  tokenEndpoint: z.string(),
  resource: z.string(),
  access: z.string(),
  refresh: z.string().default(""),
  /** Epoch ms; 0 when the server didn't say. */
  expiresAt: z.number().default(0),
});
export type Grant = z.infer<typeof GrantSchema>;

/** Where grants live: the platform's secret store; tests swap in a map. */
export interface TokenStore {
  read(item: string): string | null;
  write(item: string, value: string): boolean;
  remove(item: string): boolean;
}
const keychain: TokenStore = {
  read: (item) => readSecret(item, CFG.owner.keychainAccount),
  write: (item, value) => writeSecret(item, CFG.owner.keychainAccount, value).ok,
  remove: (item) => deleteSecret(item, CFG.owner.keychainAccount),
};
let store: TokenStore = keychain;
/** Swaps the token store (tests); clears what was cached from the old one. */
export function useTokenStore(s: TokenStore): void {
  store = s;
  grants.clear();
  sessions.clear();
}

/** The secret store item holding a service's grant. */
export const grantItem = (s: McpService): string => `overhand-mcp-${s}`;
const grants = new Map<McpService, Grant | null>();

/** A service's stored grant, read once from the secret store; null when it isn't connected. */
function grantOf(s: McpService): Grant | null {
  if (!grants.has(s)) {
    const raw = store.read(grantItem(s));
    let parsed: Grant | null = null;
    try {
      parsed = raw === null ? null : GrantSchema.parse(JSON.parse(raw));
    } catch {
      // an unreadable item counts as not connected; Connect writes a fresh one
    }
    grants.set(s, parsed);
  }
  return grants.get(s) ?? null;
}

/** Whether Overhand itself is signed in to this service over MCP. */
export const connected = (s: McpService): boolean => grantOf(s) !== null;

function saveGrant(s: McpService, g: Grant): void {
  if (!store.write(grantItem(s), JSON.stringify(g))) throw new Error(`couldn't save the ${SERVICES[s].label} sign-in to ${SECRET_STORE}`);
  grants.set(s, g);
}

/** Signs Overhand out of a service: removes its stored tokens and forgets its MCP session. */
export function disconnect(s: McpService): boolean {
  const ok = store.remove(grantItem(s));
  grants.set(s, null);
  sessions.delete(s);
  return ok;
}

// ---------- OAuth: discovery, registration, consent, tokens ----------

const AuthServerSchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  registration_endpoint: z.string().optional(),
  code_challenge_methods_supported: z.array(z.string()).optional(),
});
type AuthServer = z.infer<typeof AuthServerSchema>;

async function getJson(url: string): Promise<unknown> {
  try {
    const r = await fetch(safeUrl(url), { signal: AbortSignal.timeout(15_000), redirect: "error" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

const pathOf = (u: URL) => (u.pathname === "/" ? "" : u.pathname.replace(/\/$/, ""));

/** The authorization server for an MCP server and the resource to ask tokens for (RFC 9728, then RFC 8414). */
async function discover(mcpUrl: string): Promise<{ as: AuthServer; resource: string }> {
  const u = new URL(mcpUrl);
  const prm = z
    .object({ resource: z.string().optional(), authorization_servers: z.array(z.string()).optional() })
    .safeParse(
      (await getJson(`${u.origin}/.well-known/oauth-protected-resource${pathOf(u)}`)) ??
        (await getJson(`${u.origin}/.well-known/oauth-protected-resource`)),
    );
  const issuer = (prm.success && prm.data.authorization_servers?.[0]) || u.origin;
  const resource = (prm.success && prm.data.resource) || mcpUrl;
  // a resource naming another origin would get tokens minted for somewhere else
  if (new URL(resource).origin !== u.origin) throw new Error(`${u.origin} names a resource on another origin`);
  const i = new URL(issuer);
  const meta = AuthServerSchema.safeParse(
    (await getJson(`${i.origin}/.well-known/oauth-authorization-server${pathOf(i)}`)) ??
      (pathOf(i) ? await getJson(`${issuer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`) : null),
  );
  if (!meta.success) throw new Error(`${u.origin} publishes no OAuth metadata`);
  return { as: meta.data, resource };
}

const TokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().optional(), expires_in: z.number().optional() });

/** A token endpoint request; errors carry the OAuth error code only, never a token. */
async function tokenRequest(endpoint: string, params: Record<string, string>, clientSecret: string): Promise<z.infer<typeof TokenSchema>> {
  const body = new URLSearchParams({ ...params, ...(clientSecret ? { client_secret: clientSecret } : {}) });
  const r = await fetch(safeUrl(endpoint), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  const j: unknown = await r.json().catch(() => ({}));
  const parsed = TokenSchema.safeParse(j);
  if (r.ok && parsed.success) return parsed.data;
  const code = typeof j === "object" && j !== null && "error" in j && typeof j.error === "string" ? j.error : "no token";
  throw new Error(`token endpoint answered ${r.status} (${code})`);
}

const FLOW_MS = 10 * 60_000;
interface Flow {
  service: McpService;
  state: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  as: AuthServer;
  resource: string;
  at: number;
}
/** Sign-ins waiting for their redirect, by the nonce in their redirect path. */
const flows = new Map<string, Flow>();

/** The path the consent page redirects to; the nonce picks the flow. */
export const CALLBACK = "/oauth/callback/";

/**
 * Starts a sign-in: discovers the server, registers a client for this one flow (its redirect carries a fresh nonce),
 * and returns the consent page URL to open in the browser.
 */
export async function startConnect(service: McpService, port: number): Promise<string> {
  const svc = SERVICES[service];
  if (!svc.dcr) throw new Error(`${svc.label} doesn't let apps sign in without registering first; use a token instead`);
  const { as, resource } = await discover(svc.mcp);
  if (!as.registration_endpoint) throw new Error(`${svc.label} doesn't offer dynamic client registration; use a token instead`);
  if (as.code_challenge_methods_supported && !as.code_challenge_methods_supported.includes("S256"))
    throw new Error(`${svc.label} doesn't support PKCE with S256`);
  const nonce = b64url(randomBytes(16));
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK}${nonce}`;
  const reg = await fetch(safeUrl(as.registration_endpoint), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "Overhand",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(svc.scope ? { scope: svc.scope } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  const client = z
    .object({ client_id: z.string().min(1), client_secret: z.string().optional() })
    .safeParse(await reg.json().catch(() => ({})));
  if (!reg.ok || !client.success) throw new Error(`${svc.label} refused to register Overhand (${reg.status})`);
  const { verifier, challenge } = pkce();
  const state = b64url(randomBytes(32));
  for (const [n, f] of flows) if (Date.now() - f.at > FLOW_MS) flows.delete(n);
  flows.set(nonce, {
    service,
    state,
    verifier,
    redirectUri,
    clientId: client.data.client_id,
    clientSecret: client.data.client_secret ?? "",
    as,
    resource,
    at: Date.now(),
  });
  const url = new URL(safeUrl(as.authorization_endpoint));
  const q = {
    response_type: "code",
    client_id: client.data.client_id,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
    ...(svc.scope ? { scope: svc.scope } : {}),
  };
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * Finishes a sign-in from its redirect: the nonce must name a waiting flow (used once, whatever happens), the state must
 * match it, an `iss` must be its issuer (RFC 9207); then the code and PKCE verifier are exchanged for tokens, stored.
 */
export async function finishConnect(nonce: string, q: URLSearchParams): Promise<McpService> {
  const f = flows.get(nonce);
  flows.delete(nonce);
  if (!f || Date.now() - f.at > FLOW_MS) throw new Error("This sign-in has expired. Press Connect again.");
  if (!sameSecret(q.get("state") ?? "", f.state)) throw new Error("This sign-in doesn't match the one Overhand started.");
  const label = SERVICES[f.service].label;
  const error = q.get("error");
  if (error) throw new Error(`${label} didn't connect: ${q.get("error_description") ?? error}`);
  const iss = q.get("iss");
  if (iss !== null && iss !== f.as.issuer) throw new Error(`The answer came from ${iss}, not ${label}.`);
  const code = q.get("code");
  if (!code) throw new Error(`${label} sent no code.`);
  const t = await tokenRequest(
    f.as.token_endpoint,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: f.redirectUri,
      client_id: f.clientId,
      code_verifier: f.verifier,
      resource: f.resource,
    },
    f.clientSecret,
  );
  saveGrant(f.service, {
    clientId: f.clientId,
    clientSecret: f.clientSecret,
    tokenEndpoint: f.as.token_endpoint,
    resource: f.resource,
    access: t.access_token,
    refresh: t.refresh_token ?? "",
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : 0,
  });
  sessions.delete(f.service);
  return f.service;
}

/** Trades the refresh token for a new access token and stores it; the old refresh token stays unless a new one came. */
async function refreshGrant(s: McpService): Promise<Grant> {
  const g = grantOf(s);
  const label = SERVICES[s].label;
  if (!g) throw new Error(`${label} isn't connected`);
  if (!g.refresh) throw new Error(`${label} sign-in expired: connect it again in Settings`);
  const t = await tokenRequest(
    g.tokenEndpoint,
    { grant_type: "refresh_token", refresh_token: g.refresh, client_id: g.clientId, resource: g.resource },
    g.clientSecret,
  ).catch((e: unknown) => {
    throw new Error(`${label} sign-in expired: connect it again in Settings (${e instanceof Error ? e.message : String(e)})`);
  });
  const next = {
    ...g,
    access: t.access_token,
    refresh: t.refresh_token ?? g.refresh,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : 0,
  };
  saveGrant(s, next);
  return next;
}

/** The grant, refreshed first when it expires within a minute. */
async function freshGrant(s: McpService): Promise<Grant> {
  const g = grantOf(s);
  if (!g) throw new Error(`${SERVICES[s].label} isn't connected`);
  return g.expiresAt && g.expiresAt - 60_000 < Date.now() && g.refresh ? refreshGrant(s) : g;
}

// ---------- MCP over Streamable HTTP ----------

const PROTOCOL = "2025-06-18";
/** The server's session id per service ("" when it keeps none); dropped on any failure so the next call starts afresh. */
const sessions = new Map<McpService, string>();
let nextId = 1;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The `data:` payloads of a text/event-stream body, one per event. */
export function sseData(text: string): string[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((ev) =>
      ev
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n"),
    )
    .filter(Boolean);
}

const ReplySchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});

/** One JSON-RPC message to the server; a request's answer may come back as JSON or as an event stream. */
async function send(
  s: McpService,
  token: string,
  session: string,
  msg: { id?: number; method: string; params?: unknown },
): Promise<{ result: unknown; session: string }> {
  const label = SERVICES[s].label;
  const r = await fetch(safeUrl(SERVICES[s].mcp), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL,
      ...(session ? { "mcp-session-id": session } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...msg }),
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
  });
  if (!r.ok) throw new HttpError(r.status, `${label} MCP answered ${r.status}`);
  const sid = r.headers.get("mcp-session-id") ?? session;
  if (msg.id === undefined) return { result: undefined, session: sid };
  const text = await r.text();
  const bodies = (r.headers.get("content-type") ?? "").includes("text/event-stream") ? sseData(text) : [text];
  for (const raw of bodies) {
    const m = ReplySchema.safeParse(JSON.parse(raw));
    if (!m.success || m.data.id !== msg.id) continue;
    if (m.data.error) throw new Error(`${label} MCP: ${m.data.error.message}`);
    return { result: m.data.result, session: sid };
  }
  throw new Error(`${label} MCP gave no answer to ${msg.method}`);
}

/** What a tool returned: its structured content or the JSON in its text, if any, and the text itself. */
export interface ToolResult {
  data: unknown;
  text: string;
}

const ToolSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).default([]),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
});

function toolResult(s: McpService, name: string, raw: unknown): ToolResult {
  const r = ToolSchema.parse(raw);
  const text = r.content.map((c) => c.text ?? "").join("\n");
  if (r.isError) throw new Error(`${SERVICES[s].label} ${name}: ${text.slice(0, 300)}`);
  let data = r.structuredContent;
  if (data === undefined) {
    try {
      data = JSON.parse(text);
    } catch {
      // plain text or markdown: the caller reads `text`
    }
  }
  return { data, text };
}

/**
 * Calls one tool on a connected service's MCP server, model-free. Starts a session when there's none; a 401 refreshes
 * the token and a lost session (400/404) starts a new one, once.
 */
export async function callTool(s: McpService, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  for (let attempt = 0; ; attempt++) {
    const g = await freshGrant(s);
    try {
      let session = sessions.get(s);
      if (session === undefined) {
        const init = await send(s, g.access, "", {
          id: nextId++,
          method: "initialize",
          params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "overhand", version: "1" } },
        });
        session = init.session;
        await send(s, g.access, session, { method: "notifications/initialized" });
        sessions.set(s, session);
      }
      const { result } = await send(s, g.access, session, { id: nextId++, method: "tools/call", params: { name, arguments: args } });
      return toolResult(s, name, result);
    } catch (e) {
      sessions.delete(s);
      if (attempt > 0 || !(e instanceof HttpError) || ![400, 401, 404].includes(e.status)) throw e;
      if (e.status === 401) await refreshGrant(s);
    }
  }
}

/** The first list in a tool's data: the data itself, or its first array-valued field (`{ issues: [...] }`). */
export function rows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (typeof data !== "object" || data === null) return [];
  return Object.values(data).find(Array.isArray) ?? [];
}

/** A field of a tool's loosely-typed record as text: a string, a number, or an object's `name`. */
export function field(x: unknown, key: string): string {
  const v = typeof x === "object" && x !== null && key in x ? (x as Record<string, unknown>)[key] : undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && v !== null && "name" in v && typeof v.name === "string") return v.name;
  return "";
}
