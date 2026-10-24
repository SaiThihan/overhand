import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { newKeyPair } from "@overhand/contract";
import { plainWords as w } from "@overhand/themes/words";
import { LIMIT_DAY_MS, LIMIT_WINDOW_MS, LIMITS, network } from "../src/signin";
import { type Env, route } from "../src/worker";
import { fakeD1 } from "./fakes";

const keys = await newKeyPair();
const APP = "https://app.example";
const EMAIL = "Someone@Example.com";
const email = EMAIL.toLowerCase();
const T0 = 1_800_000_000_000;
/** The start of T0's day, so day-long tests stay inside one daily window. */
const D0 = Math.floor(T0 / LIMIT_DAY_MS) * LIMIT_DAY_MS;
const UA = "TestBrowser/1";

let env: Env;
let calls: { url: string; headers: Headers; body: Record<string, unknown> }[];
/** What the fake WorkOS answers to authenticate; magic_auth always answers 201. */
let authAnswer: () => Response;
let realFetch: typeof fetch;

beforeEach(() => {
  env = {
    WORKSPACE: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response(null) }) },
    TEAM: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response(null) }) },
    DB: fakeD1(),
    SIGNING_KEY: keys.priv,
    WORKOS_CLIENT_ID: "client_test",
    WORKOS_API_KEY: "sk_test",
    TURN_KEY_ID: "turn",
    TURN_KEY_API_TOKEN: "token",
    PADDLE_ENV: "sandbox",
    PADDLE_CLIENT_TOKEN: "test_token",
    PADDLE_API_KEY: "pdl_sdbx",
    PADDLE_WEBHOOK_SECRET: "secret",
    SITE_ORIGIN: "https://www.example",
  };
  calls = [];
  authAnswer = () => Response.json({ user: { id: "user_01", email } });
  realFetch = globalThis.fetch;
  const fake = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (url === "https://api.workos.com/user_management/magic_auth") return Response.json({ id: "magic_auth_01" }, { status: 201 });
    if (url === "https://api.workos.com/user_management/authenticate") return authAnswer();
    return new Response(null, { status: 404 });
  };
  globalThis.fetch = Object.assign(fake, { preconnect: realFetch.preconnect });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const setCookies = (r: Response) => r.headers.getSetCookie();
/** The cookie a response sets, as a request's Cookie header ("" if it sets none). */
const cookieFrom = (r: Response, name: string) =>
  setCookies(r)
    .find((c) => c.startsWith(`${name}=`))
    ?.split(";")[0] ?? "";

const post = (path: string, fields: Record<string, string>, o: { origin?: string | null; cookie?: string; ip?: string } = {}) => {
  const headers = new Headers({ "cf-connecting-ip": o.ip ?? "203.0.113.7", "user-agent": UA });
  if (o.origin !== null) headers.set("origin", o.origin ?? APP);
  if (o.cookie) headers.set("cookie", o.cookie);
  return new Request(`${APP}${path}`, { method: "POST", headers, body: new URLSearchParams(fields) });
};

/** Sends a code to `to` and returns the flow cookie. */
async function sendCode(to = EMAIL, next = "/relay/billing", o: { ip?: string; now?: number } = {}) {
  const r = await route(post("/relay/login/email", { email: to, next }, { ip: o.ip }), env, o.now ?? T0);
  return { r, flow: cookieFrom(r, "hl_email") };
}
const enterCode = (flow: string, code: string, o: { now?: number; origin?: string | null; ip?: string } = {}) =>
  route(post("/relay/login/code", { code }, { cookie: flow, origin: o.origin, ip: o.ip }), env, o.now ?? T0 + 60_000);

describe("sign-in page", () => {
  test("GitHub and Google show only when SIGN_IN_PROVIDERS lists them; the passkey link and email always", async () => {
    const plain = await (await route(new Request(`${APP}/relay/login`), env)).text();
    expect(plain).not.toContain(w.signInGithub);
    expect(plain).not.toContain(w.signInGoogle);
    expect(plain).toContain(w.signInEmail);
    expect(plain).toContain(w.signInNew);
    expect(plain).toContain("provider=authkit");
    env.SIGN_IN_PROVIDERS = "GitHubOAuth";
    const one = await (await route(new Request(`${APP}/relay/login`), env)).text();
    expect(one).toContain(w.signInGithub);
    expect(one).not.toContain(w.signInGoogle);
    env.SIGN_IN_PROVIDERS = "GitHubOAuth, GoogleOAuth, EvilOAuth";
    const both = await (await route(new Request(`${APP}/relay/login`), env)).text();
    expect(both).toContain(w.signInGoogle);
    expect(both).not.toContain("EvilOAuth");
  });

  test("the page keeps the CSP: nothing third-party, forms post to self", async () => {
    const r = await route(new Request(`${APP}/relay/login`), env);
    expect(r.headers.get("content-security-policy")).toStartWith("default-src 'none';");
    const text = await r.text();
    expect(text).not.toContain("<script");
    expect([...text.matchAll(/action="([^"]+)"/g)].map((m) => m[1])).toEqual(["/relay/login/email"]);
  });

  test("a provider starts only when configured, with state and next in the cookie, back to /relay/callback", async () => {
    const off = await route(new Request(`${APP}/relay/login/start?provider=GoogleOAuth&next=/relay/billing`), env);
    expect(off.headers.get("location")).toBe(`/relay/login?next=${encodeURIComponent("/relay/billing")}`);
    env.SIGN_IN_PROVIDERS = "GoogleOAuth";
    const on = await route(new Request(`${APP}/relay/login/start?provider=GoogleOAuth&next=/relay/billing`), env);
    const to = new URL(on.headers.get("location") ?? "");
    expect(`${to.origin}${to.pathname}`).toBe("https://api.workos.com/user_management/authorize");
    expect(Object.fromEntries(to.searchParams)).toMatchObject({
      provider: "GoogleOAuth",
      client_id: "client_test",
      redirect_uri: `${APP}/relay/callback`,
      response_type: "code",
    });
    const state = to.searchParams.get("state") ?? "";
    const auth = cookieFrom(on, "hl_auth");
    expect(decodeURIComponent(auth)).toBe(`hl_auth=${state} /relay/billing`);
    // the passkey link is the hosted AuthKit page; unknown providers go back to the page
    const kit = await route(new Request(`${APP}/relay/login/start?provider=authkit`), env);
    expect(new URL(kit.headers.get("location") ?? "").searchParams.get("provider")).toBe("authkit");
    const bad = await route(new Request(`${APP}/relay/login/start?provider=EvilOAuth`), env);
    expect(bad.headers.get("location")).toBe("/relay/login?next=%2F");

    // the callback exchanges the code and sets the session, the same way the email flow does
    const back = await route(
      new Request(`${APP}/relay/callback?code=c_1&state=${state}`, {
        headers: { cookie: auth, "cf-connecting-ip": "2001:db8::1", "user-agent": UA },
      }),
      env,
      T0,
    );
    expect(calls.at(-1)?.body).toEqual({
      client_id: "client_test",
      client_secret: "sk_test",
      grant_type: "authorization_code",
      code: "c_1",
      ip_address: "2001:db8::1",
      user_agent: UA,
    });
    expect(back.headers.get("location")).toBe("/relay/billing");
    expect(cookieFrom(back, "hl_session")).not.toBe("hl_session=");
    const wrong = await route(new Request(`${APP}/relay/callback?code=c_1&state=other`, { headers: { cookie: auth } }), env);
    expect(wrong.status).toBe(400);
  });

  test("next stays on this site", async () => {
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil"]) {
      const page = await (await route(new Request(`${APP}/relay/login?next=${encodeURIComponent(bad)}`), env)).text();
      expect(page).toContain('name="next" value="/"');
      const { flow } = await sendCode(`n${bad.length}@example.com`, bad);
      expect((await enterCode(flow, "123456")).headers.get("location")).toBe("/");
    }
  });
});

describe("sign-in by email", () => {
  test("sends a code, then authenticates with exactly WorkOS's Magic Auth requests and sets the session", async () => {
    const { r, flow } = await sendCode();
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/relay/login/code");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.workos.com/user_management/magic_auth");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer sk_test");
    expect(calls[0]?.body).toEqual({ email });
    // the cookie is signed, short-lived, and never holds the address in plain text
    expect(flow).not.toContain(email);
    expect(setCookies(r).find((c) => c.startsWith("hl_email="))).toContain("Max-Age=600");

    const page = await (await route(new Request(`${APP}/relay/login/code`, { headers: { cookie: flow } }), env, T0 + 1000)).text();
    expect(page).toContain(email);
    expect(page).toContain('autocomplete="one-time-code"');

    const done = await enterCode(flow, " 123456 ");
    expect(calls.at(-1)).toMatchObject({ url: "https://api.workos.com/user_management/authenticate" });
    expect(calls.at(-1)?.body).toEqual({
      client_id: "client_test",
      client_secret: "sk_test",
      grant_type: "urn:workos:oauth:grant-type:magic-auth:code",
      code: "123456",
      email,
      ip_address: "203.0.113.7",
      user_agent: UA,
    });
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe("/relay/billing");
    expect(cookieFrom(done, "hl_email")).toBe("hl_email=");
    const me = await route(new Request(`${APP}/relay/me`, { headers: { cookie: cookieFrom(done, "hl_session") } }), env, T0 + 120_000);
    expect(await me.json()).toMatchObject({ signedIn: true, email, workspace: "user_01" });
  });

  test("a wrong code, a malformed one and too many attempts get the same refusal", async () => {
    const { flow } = await sendCode();
    authAnswer = () => Response.json({ code: "invalid_one_time_code" }, { status: 400 });
    const wrong = await enterCode(flow, "000000");
    const wrongText = await wrong.text();
    expect(wrong.status).toBe(400);
    expect(wrongText).toContain(w.signInCodeFailed);
    expect((await enterCode(flow, "12ab")).status).toBe(400);
    for (let i = 2; i < LIMITS.codeEmailIp; i++) await enterCode(flow, "000000");
    authAnswer = () => Response.json({ user: { id: "user_01", email } });
    const sent = calls.length;
    const over = await enterCode(flow, "123456");
    expect(calls.length).toBe(sent); // past the limit, WorkOS isn't even asked
    expect(over.status).toBe(wrong.status);
    expect(await over.text()).toBe(wrongText);
  });

  test("code sends are limited per email and per IP", async () => {
    for (let i = 0; i < LIMITS.sendEmail; i++) expect((await sendCode(EMAIL, "/", { ip: `198.51.100.${i}` })).r.status).toBe(303);
    const capped = await sendCode(EMAIL.toUpperCase(), "/", { ip: "198.51.100.200" });
    expect(capped.r.status).toBe(429);
    expect(await capped.r.text()).toContain(w.signInTooMany);
    expect(calls.length).toBe(LIMITS.sendEmail);
    for (let i = 0; i < LIMITS.sendIp; i++) await sendCode(`p${i}@example.com`, "/", { ip: "192.0.2.1" });
    expect((await sendCode("fresh@example.com", "/", { ip: "192.0.2.1" })).r.status).toBe(429);
    expect((await sendCode("fresh@example.com", "/", { ip: "192.0.2.1", now: T0 + LIMIT_WINDOW_MS })).r.status).toBe(303);
  });

  test("IPv6 counts by its /64, every spelling as one; IPv4 as it is", async () => {
    expect(network("2001:db8:0:0:1::2")).toBe("2001:db8:0:0::/64");
    expect(network("2001:0DB8::ABCD")).toBe("2001:db8:0:0::/64");
    expect(network("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(network("fe80::1%en0")).toBe("fe80:0:0:0::/64");
    expect(network("198.51.100.7")).toBe("198.51.100.7");
    expect(network("::ffff:198.51.100.7")).toBe("198.51.100.7");
    // rotating through one /64 is still one network
    for (let i = 0; i < LIMITS.sendIp; i++)
      expect((await sendCode(`r${i}@example.com`, "/", { ip: `2001:db8::${i + 1}` })).r.status).toBe(303);
    expect((await sendCode("r-last@example.com", "/", { ip: "2001:db8::ffff:1" })).r.status).toBe(429);
    expect((await sendCode("r-last@example.com", "/", { ip: "2001:db8:0:1::1" })).r.status).toBe(303);
  });

  test("all sends together are capped per window, so rotating addresses can't mail many inboxes", async () => {
    for (let i = 0; i < LIMITS.sendAll; i++) await sendCode(`g${i}@example.com`, "/", { ip: `10.${i >> 8}.${i & 255}.1` });
    expect(calls).toHaveLength(LIMITS.sendAll);
    expect((await sendCode("one-more@example.com", "/", { ip: "192.0.2.99" })).r.status).toBe(429);
    expect(calls).toHaveLength(LIMITS.sendAll);
  });

  test("one email gets at most a day's sends, across windows", async () => {
    for (let i = 0; i < LIMITS.sendEmailDay; i++)
      expect((await sendCode(EMAIL, "/", { ip: `198.51.100.${i}`, now: D0 + i * LIMIT_WINDOW_MS })).r.status).toBe(303);
    expect((await sendCode(EMAIL, "/", { ip: "192.0.2.5", now: D0 + LIMITS.sendEmailDay * LIMIT_WINDOW_MS })).r.status).toBe(429);
  });

  test("failed codes are capped per email per day, with the same refusal", async () => {
    authAnswer = () => Response.json({ code: "invalid_one_time_code" }, { status: 400 });
    const perWindow = LIMITS.codeEmailIp - 1;
    let wrongText = "";
    for (let k = 0; k * perWindow < LIMITS.failEmailDay; k++) {
      const at = D0 + k * LIMIT_WINDOW_MS;
      const { flow } = await sendCode(EMAIL, "/", { now: at });
      for (let i = 0; i < perWindow; i++) wrongText = await (await enterCode(flow, "000000", { now: at + 1000 })).text();
    }
    authAnswer = () => Response.json({ user: { id: "user_01", email } });
    const at = D0 + 10 * LIMIT_WINDOW_MS;
    const { flow } = await sendCode(EMAIL, "/", { now: at });
    const sent = calls.length;
    const over = await enterCode(flow, "123456", { now: at + 1000 });
    expect(calls.length).toBe(sent);
    expect(over.status).toBe(400);
    expect(await over.text()).toBe(wrongText);
  });

  test("tries from another network don't use up the owner's", async () => {
    const { flow } = await sendCode();
    authAnswer = () => Response.json({ code: "invalid_one_time_code" }, { status: 400 });
    for (let i = 0; i < LIMITS.codeEmailIp + 2; i++) await enterCode(flow, "000000", { ip: "192.0.2.66" });
    authAnswer = () => Response.json({ user: { id: "user_01", email } });
    expect((await enterCode(flow, "123456", { ip: "192.0.2.66" })).status).toBe(400);
    expect((await enterCode(flow, "123456")).status).toBe(302);
  });

  test("a mangled hl_auth or hl_email cookie counts as none, never a 500", async () => {
    const cb = await route(new Request(`${APP}/relay/callback?code=c&state=s`, { headers: { cookie: "hl_auth=%E0%A4%A" } }), env);
    expect(cb.status).toBe(400);
    for (const bad of ["hl_email=%%%", "hl_email=@@.@@", "hl_email=e30.!!", "hl_email=..."]) {
      expect((await route(new Request(`${APP}/relay/login/code`, { headers: { cookie: bad } }), env)).status).toBe(400);
      expect((await enterCode(bad, "123456")).status).toBe(403);
    }
  });

  test("an unknown address gets the same answer as a known one, even when WorkOS refuses", async () => {
    const known = await sendCode("known@example.com");
    globalThis.fetch = Object.assign(async () => Response.json({ code: "user_not_found" }, { status: 404 }), {
      preconnect: realFetch.preconnect,
    });
    const err = spyOn(console, "error").mockImplementation(() => {});
    const unknown = await sendCode("unknown@example.com");
    expect(unknown.r.status).toBe(known.r.status);
    expect(unknown.r.headers.get("location")).toBe(known.r.headers.get("location"));
    // the log says what failed, never who
    expect(JSON.stringify(err.mock.calls)).not.toContain("unknown@example.com");
    err.mockRestore();
  });

  test("cross-site posts are refused before anything is sent or tried", async () => {
    for (const origin of [null, "https://evil.example"]) {
      expect((await route(post("/relay/login/email", { email: EMAIL }, { origin }), env, T0)).status).toBe(403);
    }
    expect(calls).toHaveLength(0);
    const { flow } = await sendCode();
    expect((await enterCode(flow, "123456", { origin: "https://evil.example" })).status).toBe(403);
    expect(calls).toHaveLength(1);
  });

  test("a forged or expired flow cookie, or a bad address, goes back to the sign-in page", async () => {
    expect((await route(post("/relay/login/email", { email: "not-an-email" }), env, T0)).status).toBe(400);
    const { flow } = await sendCode();
    const [name, value = ""] = flow.split("=");
    const [body = "", sig = ""] = value.split(".");
    const forged = `${name}=${btoa(JSON.stringify({ email: "victim@example.com", next: "/", exp: T0 * 2 })).replace(/=+$/, "")}.${sig}`;
    expect((await enterCode(forged, "123456")).status).toBe(403);
    expect((await enterCode(`${name}=${body}`, "123456")).status).toBe(403);
    const late = await enterCode(flow, "123456", { now: T0 + 601_000 });
    expect(late.status).toBe(403);
    expect(await late.text()).toContain(w.signInExpired);
    expect(calls.filter((c) => c.url.endsWith("/authenticate"))).toHaveLength(0);
  });

  test("no email or code is ever in a URL", async () => {
    const { r, flow } = await sendCode();
    const done = await enterCode(flow, "123456");
    const urls = [...calls.map((c) => c.url), r.headers.get("location"), done.headers.get("location")].join(" ");
    expect(urls).not.toContain(email);
    expect(urls).not.toContain("123456");
  });
});

describe("rate limit rows", () => {
  test("are indexed by window, and windows older than a day are pruned now and then", async () => {
    expect(
      await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'sign_in_limits_win'").first(),
    ).not.toBeNull();
    await env.DB.prepare("INSERT INTO sign_in_limits (key, win, n) VALUES ('old', ?, 1)")
      .bind(T0 - 2 * LIMIT_DAY_MS)
      .run();
    const always = spyOn(Math, "random").mockReturnValue(0);
    await sendCode();
    always.mockRestore();
    expect(await env.DB.prepare("SELECT 1 FROM sign_in_limits WHERE key = 'old'").first()).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM sign_in_limits").first()).not.toBeNull();
  });
});
