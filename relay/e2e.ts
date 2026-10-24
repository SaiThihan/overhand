/**
 * The hosted page end to end, locally, with two real WebRTC peers: headless Chrome running the built dashboard as the
 * hosted page (http://localhost:8790, one of APP_ORIGINS), a scratch daemon (its own OVERHAND_HOME, never the real one on
 * 4317) running the real relay client, and a stand-in relay on 8790 that serves the build, signs an entitlement and
 * routes signalling like the Durable Object. Checks: the page connects, the daemon's signed answer is accepted, the
 * unpaired page asks for a code, pairing over the channel works, and the dashboard then loads over WebRTC.
 *
 * Usage: (cd apps/web && bun run build) && bun relay/e2e.ts
 * For the real Worker instead of the stand-in, see relay/README.md ("Local end to end with wrangler dev").
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { newKeyPair, signingKey, signToken, unb64url } from "@overhand/contract";
import type { ServerWebSocket } from "bun";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "apps", "web", "dist");
if (!existsSync(join(DIST, "index.html"))) throw new Error("build the dashboard first: cd apps/web && bun run build");

// --wrangler: against the real Worker (`cd relay && bunx wrangler@4.151.1 dev --local`, with DEV_LOGIN=1 and a
// SIGNING_KEY in relay/.dev.vars and a local D1 entitlement for dev-workspace; see relay/README.md)
const WRANGLER = process.argv.includes("--wrangler");
const home = mkdtempSync(join(tmpdir(), "overhand-e2e-"));
// outside the scratch home, which goes when the run ends; one fixed name, overwritten by the next run
const SHOT = join(tmpdir(), "overhand-e2e-hosted.png");
cpSync(join(ROOT, "overhand.config.example.json"), join(home, "overhand.config.json"));
const devKey = WRANGLER ? (/SIGNING_KEY=(.+)/.exec(readFileSync(join(import.meta.dir, ".dev.vars"), "utf8"))?.[1] ?? "") : "";
const relayKeys = WRANGLER ? { priv: devKey, pub: await publicOf(devKey) } : await newKeyPair();
const device = await newKeyPair();
process.env.OVERHAND_HOME = home;
process.env.OVERHAND_PORT = "4399";
process.env.OVERHAND_RELAY_URL = "http://localhost:8790";
process.env.OVERHAND_RELAY_KEY = relayKeys.pub;
const cert = await signToken(await signingKey(relayKeys.priv), {
  typ: "link",
  ws: "dev-workspace",
  email: "dev@localhost",
  pub: device.pub,
  name: "e2e",
  iat: Date.now(),
});
await Bun.write(
  join(home, ".relay.json"),
  JSON.stringify({ enabled: true, priv: device.priv, pub: device.pub, cert, email: "dev@localhost", ent: "" }),
);

/** The raw public half of a PKCS#8 Ed25519 key. */
async function publicOf(pkcs8: string): Promise<string> {
  const k = await crypto.subtle.importKey("pkcs8", unb64url(pkcs8), { name: "Ed25519" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", k);
  return jwk.x ?? "";
}

type Who = { role: "daemon" | "peer"; id: string };
const sockets = new Set<ServerWebSocket<Who>>();
const relay = Bun.serve<Who>({
  port: WRANGLER ? 0 : 8790,
  async fetch(req, server) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === "/relay/me") return Response.json({ signedIn: true, email: "me@x", active: true });
    if (p === "/relay/ice") return Response.json({ iceServers: [] });
    if (p === "/relay/entitlement") {
      const now = Date.now();
      const token = await signToken(await signingKey(relayKeys.priv), {
        typ: "ent",
        ws: "w",
        plan: "pro",
        seats: 1,
        iat: now,
        exp: now + 3_600_000,
      });
      return Response.json({ token });
    }
    if (p === "/relay/ws") {
      const role = url.searchParams.has("cert") ? "daemon" : "peer";
      return server.upgrade(req, { data: { role, id: crypto.randomUUID() } }) ? undefined : new Response("no", { status: 400 });
    }
    const file = Bun.file(join(DIST, p === "/" ? "index.html" : p));
    return new Response((await file.exists()) ? file : Bun.file(join(DIST, "index.html")));
  },
  websocket: {
    open(ws) {
      sockets.add(ws);
      if (ws.data.role === "peer")
        ws.send(
          JSON.stringify({ type: "daemon", online: [...sockets].some((s) => s.data.role === "daemon"), pub: device.pub, name: "Mac" }),
        );
    },
    message(ws, raw) {
      if (raw === "ping") return void ws.send("pong");
      const m = JSON.parse(String(raw));
      if (ws.data.role === "peer") for (const s of sockets) s.data.role === "daemon" && s.send(JSON.stringify({ ...m, from: ws.data.id }));
      else for (const s of sockets) s.data.id === m.to && s.send(JSON.stringify(m));
    },
    close(ws) {
      sockets.delete(ws);
    },
  },
});

const { handle } = await import("../packages/core/src/server");
const { startRelay } = await import("../packages/core/src/relay");
const { newPairing } = await import("../packages/core/src/devices");
await startRelay(handle);

const browser = await chromium.launch();
let failed = "";
try {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && console.log(`  console: ${m.text()}`));
  await page.goto(WRANGLER ? "http://localhost:8790/relay/dev-login?ws=dev-workspace" : "http://localhost:8790/");
  await page.getByRole("heading", { name: "Pair this device" }).waitFor({ timeout: 20_000 });
  console.log("✓ the hosted page reached the daemon over WebRTC and asks to pair");
  await page.getByLabel("Pairing code").fill(newPairing().code);
  await page.getByRole("button", { name: "Pair" }).click();
  await page.getByRole("heading", { name: "Pair this device" }).waitFor({ state: "detached", timeout: 20_000 });
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith("overhand-session:")), null, { timeout: 20_000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: SHOT });
  console.log(`✓ paired over the channel; the dashboard loads over WebRTC (screenshot: ${SHOT})`);
} catch (e) {
  failed = e instanceof Error ? e.message : String(e);
} finally {
  await browser.close();
  relay.stop(true);
  rmSync(home, { recursive: true, force: true });
}
if (failed) {
  console.error(`✗ ${failed}`);
  process.exit(1);
}
process.exit(0);
