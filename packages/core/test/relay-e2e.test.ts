/**
 * End to end on localhost: the real daemon relay client (startRelay, werift answering, the server's own handler) and
 * a second real WebRTC peer standing in for the browser, through a stand-in signalling relay that routes like the
 * Durable Object. The browser side checks the daemon's signed answer, pairs over the channel and reads the API.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Frame, newKeyPair, parseFrame, signingKey, signToken, unb64url, verify, verifyingKey } from "@overhand/contract";
import type { ServerWebSocket } from "bun";
import { RTCPeerConnection } from "werift";
import { newPairing } from "../src/devices";
import { OPS } from "../src/env";
import { relayTiming, setEnabled, startRelay } from "../src/relay";
import { handle } from "../src/server";

const relayKeys = await newKeyPair();
const device = await newKeyPair();
type Who = { role: "daemon" | "peer"; id: string };
const sockets = new Set<ServerWebSocket<Who>>();
/** How long the stand-in takes to hand out ICE servers (TURN credentials take a round trip on the real relay). */
let iceDelay = 0;
/** A relay gone quiet: pings go unanswered, as on a half-open socket after a laptop's sleep. */
let mute = false;
let daemonDials = 0;

// the stand-in relay: entitlement, ICE, and Durable-Object-style routing between one daemon and its browsers
const relay = Bun.serve<Who>({
  port: 0,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/relay/entitlement") {
      const now = Date.now();
      return Response.json({
        token: await signToken(await signingKey(relayKeys.priv), {
          typ: "ent",
          ws: "w",
          plan: "pro",
          seats: 1,
          iat: now,
          exp: now + 60_000,
        }),
      });
    }
    if (url.pathname === "/relay/ice") {
      await Bun.sleep(iceDelay);
      return Response.json({ iceServers: [] });
    }
    const role = url.searchParams.has("cert") ? "daemon" : "peer";
    if (server.upgrade(req, { data: { role, id: crypto.randomUUID() } })) return undefined;
    return new Response("no", { status: 400 });
  },
  websocket: {
    open(ws) {
      sockets.add(ws);
      if (ws.data.role === "daemon") daemonDials++;
      if (ws.data.role === "peer") {
        const online = [...sockets].some((s) => s.data.role === "daemon");
        ws.send(JSON.stringify({ type: "daemon", online, pub: device.pub, name: "Mac" }));
      }
    },
    message(ws, raw) {
      if (raw === "ping") return void (mute || ws.send("pong"));
      const m = JSON.parse(String(raw));
      if (ws.data.role === "peer") {
        for (const s of sockets) if (s.data.role === "daemon") s.send(JSON.stringify({ ...m, from: ws.data.id }));
      } else for (const s of sockets) if (s.data.id === m.to) s.send(JSON.stringify(m));
    },
    close(ws) {
      sockets.delete(ws);
    },
  },
});
const RELAY = `http://localhost:${relay.port}`;

beforeAll(() => {
  process.env.OVERHAND_RELAY_URL = RELAY;
  process.env.OVERHAND_RELAY_KEY = relayKeys.pub;
  writeFileSync(
    join(OPS, ".relay.json"),
    JSON.stringify({ enabled: true, priv: device.priv, pub: device.pub, cert: "cert", email: "me@x", ent: "" }),
  );
  rmSync(join(OPS, ".devices.json"), { force: true });
});
afterAll(() => {
  setEnabled(false);
  relay.stop(true);
  for (const f of [".relay.json", ".devices.json"]) rmSync(join(OPS, f), { force: true });
  delete process.env.OVERHAND_RELAY_URL;
  delete process.env.OVERHAND_RELAY_KEY;
});

const until = async (ok: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(25);
  }
};

// first: the daemon caches ICE servers for an hour, and this needs the first, slow fetch
test("candidates a browser trickles while the daemon is still setting up aren't lost", async () => {
  // a TURN-only browser's relay candidates are its only way in; the real relay's credential fetch is a round trip,
  // and the browser sends its candidates right after the offer, so they arrive before the daemon has a connection
  const seen: string[] = [];
  const real = RTCPeerConnection.prototype.addIceCandidate;
  RTCPeerConnection.prototype.addIceCandidate = function (this: RTCPeerConnection, c) {
    seen.push(String(c?.candidate ?? ""));
    return real.call(this, c);
  };
  iceDelay = 300;
  try {
    await startRelay(handle);
    await until(() => [...sockets].some((s) => s.data.role === "daemon"));
    const pc = new RTCPeerConnection({});
    pc.createDataChannel("api");
    const ws = new WebSocket(`${RELAY.replace("http", "ws")}/relay/ws`);
    let answered = false;
    ws.onmessage = async (e) => {
      const m = JSON.parse(String(e.data));
      if (m.type === "daemon" && m.online) {
        await pc.setLocalDescription(await pc.createOffer());
        ws.send(JSON.stringify({ type: "offer", sdp: pc.localDescription?.sdp ?? "" }));
        ws.send(
          JSON.stringify({ type: "ice", candidate: "candidate:1 1 udp 16777215 192.0.2.7 9 typ relay raddr 0.0.0.0 rport 0", mid: "0" }),
        );
      } else if (m.type === "answer") answered = true;
    };
    await until(() => answered, 15_000);
    await until(() => seen.some((c) => c.includes("192.0.2.7")), 2000);
    ws.close();
    await pc.close();
  } finally {
    RTCPeerConnection.prototype.addIceCandidate = real;
    iceDelay = 0;
  }
}, 30_000);

test("a browser reaches the daemon over WebRTC, pairs, and reads the API through the same handler", async () => {
  await until(() => [...sockets].some((s) => s.data.role === "daemon"));

  const pc = new RTCPeerConnection({});
  const dc = pc.createDataChannel("api");
  const ws = new WebSocket(`${RELAY.replace("http", "ws")}/relay/ws`);
  let signedOk = false;
  ws.onmessage = async (e) => {
    const m = JSON.parse(String(e.data));
    if (m.type === "daemon" && m.online) {
      pc.onIceCandidate.subscribe(
        (c) => c?.candidate && ws.send(JSON.stringify({ type: "ice", candidate: c.candidate, mid: c.sdpMid ?? "0" })),
      );
      await pc.setLocalDescription(await pc.createOffer());
      ws.send(JSON.stringify({ type: "offer", sdp: pc.localDescription?.sdp ?? "" }));
    } else if (m.type === "answer") {
      signedOk = await verify(await verifyingKey(device.pub), m.sdp, m.sig);
      await pc.setRemoteDescription({ type: "answer", sdp: m.sdp });
    } else if (m.type === "ice") await pc.addIceCandidate({ candidate: m.candidate, sdpMid: m.mid });
  };
  let open = false;
  dc.stateChanged.subscribe((s) => {
    if (s === "open") open = true;
  });
  await until(() => open, 15_000);
  expect(signedOk).toBe(true);

  const replies = new Map<number, { status: number; headers: Record<string, string>; body: Uint8Array[]; done: boolean }>();
  dc.onMessage.subscribe((raw) => {
    const f = parseFrame(String(raw));
    if (!f) return;
    if (f.t === "res") replies.set(f.id, { status: f.status, headers: f.headers, body: [], done: false });
    const r = replies.get(f.id);
    if (f.t === "body" && r) r.body.push(f.z ? Bun.gunzipSync(unb64url(f.d)) : unb64url(f.d));
    if (f.t === "end" && r) r.done = true;
  });
  let id = 0;
  const request = async (method: string, path: string, headers: Record<string, string> = {}, body?: object) => {
    const n = ++id;
    const send = (f: Frame) => dc.send(JSON.stringify(f));
    send({ t: "req", id: n, method, path, headers });
    if (body) send({ t: "body", id: n, d: Buffer.from(JSON.stringify(body)).toString("base64url") });
    send({ t: "end", id: n });
    await until(() => replies.get(n)?.done === true);
    const r = replies.get(n);
    return { status: r?.status ?? 0, headers: r?.headers ?? {}, text: Buffer.concat(r?.body ?? []).toString() };
  };

  expect((await request("GET", "/api/devices")).status).toBe(401);
  const { code } = newPairing();
  const paired = await request("POST", "/api/pair", { "content-type": "application/json" }, { code });
  expect(paired.status).toBe(200);
  const token = /overhand_session=([^;]+)/.exec(paired.headers["set-cookie"] ?? "")?.[1] ?? "";
  const list = await request("GET", "/api/devices", { cookie: `overhand_session=${token}` });
  expect(list.status).toBe(200);
  expect(JSON.parse(list.text)).toMatchObject({ local: false, devices: [expect.objectContaining({ current: true })] });

  ws.close();
  await pc.close();
}, 30_000);

test("a closed socket dials again, and so does one that goes quiet", async () => {
  await until(() => [...sockets].some((s) => s.data.role === "daemon"));
  const before = daemonDials;
  const timing = { ...relayTiming };
  relayTiming.ping = 100;
  mute = true;
  try {
    // the running socket keeps its 50 s ping; a quiet relay is only noticed on a socket dialled with the short one
    for (const s of sockets) if (s.data.role === "daemon") s.close(4000, "test");
    await until(() => daemonDials >= before + 2, 15_000);
  } finally {
    mute = false;
    Object.assign(relayTiming, timing);
  }
}, 20_000); // two dials, each after the 5 s retry wait
