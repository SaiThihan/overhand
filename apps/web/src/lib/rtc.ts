/**
 * The hosted page's way to its daemon (loaded only there): signalling over the relay's WebSocket, then a WebRTC data
 * channel straight to the daemon, carrying the dashboard's API as frames (contract/relay.ts). The daemon signs its
 * answer with its device key, which this page pins (from the pairing link's #k=, else on first use), so not even the
 * relay can slip itself in between. The paired device's session token lives in localStorage on this origin, since
 * cookies don't cross a data channel.
 */
import { bodyFrames, type Frame, fingerprint, parseFrame, type Signal, unb64url, verify, verifyingKey } from "@overhand/contract";
import { type EventStream, setChannel } from "@/lib/api";

/** Where the connection stands, for the hosted gate. */
export type RtcState =
  | { kind: "connecting" }
  | { kind: "online" }
  | { kind: "offline" }
  | { kind: "untrusted"; pinned: string; got: string; pub: string }
  | { kind: "error"; message: string };

const PIN = "overhand-daemon-key";
const sessionKey = (pub: string) => `overhand-session:${pub}`;

const store = {
  get: (k: string): string => {
    try {
      return localStorage.getItem(k) ?? "";
    } catch {
      return "";
    }
  },
  set: (k: string, v: string): void => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // private mode: this tab still works, the next one pairs again
    }
  },
};

/** Takes a key the pairing link carried (#k=…) as the pin, and clears it from the address bar. */
function takePinFromLink(): void {
  const k = new URLSearchParams(location.hash.slice(1)).get("k");
  if (k && /^[A-Za-z0-9_-]{43}$/.test(k)) {
    store.set(PIN, k);
    history.replaceState(null, "", location.pathname + location.search);
  }
}

/** Trusts a new daemon key from now on (after the user confirms it changed on purpose). */
export const trustKey = (pub: string): void => store.set(PIN, pub);

/** The API over one open data channel: fetch and event streams, as frames. */
function channelClient(dc: RTCDataChannel, pub: string) {
  let next = 1;
  const pending = new Map<
    number,
    { resolve(r: Response): void; reject(e: Error): void; ctrl: ReadableStreamDefaultController<Uint8Array> | null; chain: Promise<void> }
  >();
  const send = (f: Frame) => dc.send(JSON.stringify(f));
  const gunzip = async (bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> =>
    new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());

  dc.onmessage = (e: MessageEvent<string>) => {
    const f = parseFrame(String(e.data));
    const p = f ? pending.get(f.id) : undefined;
    if (!f || !p) return;
    if (f.t === "res") {
      const token = /overhand_session=([A-Za-z0-9_-]+)/.exec(f.headers["set-cookie"] ?? "")?.[1];
      if (token) store.set(sessionKey(pub), token);
      const body = new ReadableStream<Uint8Array>({
        start: (c) => {
          p.ctrl = c;
        },
        cancel: () => {
          pending.delete(f.id);
          send({ t: "abort", id: f.id });
        },
      });
      const headers = f.headers["content-type"] ? { "content-type": f.headers["content-type"] } : undefined;
      p.resolve(new Response(f.status === 204 ? null : body, { status: f.status, headers }));
    } else if (f.t === "body") {
      // gzipped pieces decompress asynchronously; the chain keeps them in order
      p.chain = p.chain.then(async () => p.ctrl?.enqueue(f.z ? await gunzip(unb64url(f.d)) : unb64url(f.d))).catch(() => {});
    } else if (f.t === "end") {
      p.chain = p.chain.then(() => p.ctrl?.close()).catch(() => {});
      pending.delete(f.id);
    }
  };

  const doFetch = (url: string, init: RequestInit = {}): Promise<Response> =>
    new Promise((resolve, reject) => {
      if (dc.readyState !== "open") return reject(new Error("Not connected to your computer."));
      const id = next++;
      pending.set(id, { resolve, reject, ctrl: null, chain: Promise.resolve() });
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((v, k) => {
        if (k === "content-type" || k === "accept") headers[k] = v;
      });
      const token = store.get(sessionKey(pub));
      if (token) headers.cookie = `overhand_session=${token}`;
      const path = new URL(url, location.origin).pathname + new URL(url, location.origin).search;
      send({ t: "req", id, method: init.method ?? "GET", path, headers });
      if (typeof init.body === "string") for (const b of bodyFrames(id, new TextEncoder().encode(init.body))) send(b);
      send({ t: "end", id });
    });

  /** Server-sent events read from a fetch over the channel. */
  const events = (url: string): EventStream => {
    const es: EventStream & { readyState: number } = { onmessage: null, onerror: null, readyState: 0, close: () => {} };
    const ac = { closed: false, reader: null as ReadableStreamDefaultReader<Uint8Array> | null };
    es.close = () => {
      ac.closed = true;
      es.readyState = 2;
      void ac.reader?.cancel().catch(() => {});
    };
    void doFetch(url, { headers: { accept: "text/event-stream" } })
      .then(async (r) => {
        if (!r.ok || !r.body) throw new Error(String(r.status));
        es.readyState = 1;
        ac.reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await ac.reader.read();
          if (done || ac.closed) break;
          buf += dec.decode(value, { stream: true });
          let at = buf.indexOf("\n\n");
          while (at >= 0) {
            const data = buf
              .slice(0, at)
              .split("\n")
              .filter((l) => l.startsWith("data: "))
              .map((l) => l.slice(6))
              .join("\n");
            buf = buf.slice(at + 2);
            if (data) es.onmessage?.(new MessageEvent("message", { data }));
            at = buf.indexOf("\n\n");
          }
        }
        throw new Error("stream ended");
      })
      .catch(() => {
        es.readyState = 2;
        if (!ac.closed) es.onerror?.(new Event("error"));
      });
    return es;
  };

  const fail = () => {
    for (const p of pending.values()) {
      p.reject(new Error("The connection to your computer closed."));
      p.ctrl?.error(new Error("closed"));
    }
    pending.clear();
  };
  return { fetch: doFetch, events, fail };
}

/**
 * Connects to the daemon and keeps trying: reports each state change to `onState`. Returns a function that stops.
 * When the channel opens, the dashboard's API (lib/api.ts) switches to it.
 */
export function connectRelay(onState: (s: RtcState) => void): () => void {
  takePinFromLink();
  let stopped = false;
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let backoff = 2000;

  const teardown = () => {
    setChannel(null);
    pc?.close();
    pc = null;
  };
  const again = () => {
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = null;
      open();
    }, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };

  async function call(pub: string) {
    const socket = ws;
    if (!socket) return;
    teardown();
    const ice = await fetch("/relay/ice", { method: "POST" })
      .then((r) => r.json())
      .then((j: { iceServers?: RTCIceServer[] }) => j.iceServers ?? [])
      .catch((): RTCIceServer[] => []);
    const conn = new RTCPeerConnection({ iceServers: ice });
    pc = conn;
    const dc = conn.createDataChannel("api", { ordered: true });
    const client = channelClient(dc, pub);
    dc.onopen = () => {
      backoff = 2000;
      setChannel(client);
      onState({ kind: "online" });
    };
    dc.onclose = () => {
      client.fail();
      if (pc !== conn) return;
      teardown();
      onState({ kind: "connecting" });
      // the daemon may be back already: ask again through the still-open signalling socket
      if (ws?.readyState === WebSocket.OPEN) void call(pub);
      else again();
    };
    conn.onicecandidate = (e) => {
      if (e.candidate?.candidate)
        socket.send(JSON.stringify({ type: "ice", candidate: e.candidate.candidate, mid: e.candidate.sdpMid ?? "0" }));
    };
    await conn.setLocalDescription(await conn.createOffer());
    socket.send(JSON.stringify({ type: "offer", sdp: conn.localDescription?.sdp ?? "" }));
  }

  async function onSignal(m: Signal) {
    if (m.type === "daemon") {
      if (!m.online) {
        teardown();
        return onState({ kind: "offline" });
      }
      const pinned = store.get(PIN);
      if (pinned && pinned !== m.pub) {
        teardown();
        return onState({ kind: "untrusted", pinned: await fingerprint(pinned), got: await fingerprint(m.pub), pub: m.pub });
      }
      if (!pinned) store.set(PIN, m.pub); // first contact: trusted on first use, unless a pairing link pinned it
      onState({ kind: "connecting" });
      return call(m.pub);
    }
    const conn = pc;
    if (!conn) return;
    if (m.type === "answer") {
      // only an answer signed by the pinned key: its DTLS fingerprint is then the daemon's own
      const ok = await verify(await verifyingKey(store.get(PIN)), m.sdp, m.sig);
      if (!ok) {
        teardown();
        return onState({ kind: "error", message: "Your computer's answer wasn't signed by its key; not connecting." });
      }
      await conn.setRemoteDescription({ type: "answer", sdp: m.sdp });
    } else if (m.type === "ice") await conn.addIceCandidate({ candidate: m.candidate, sdpMid: m.mid }).catch(() => {});
  }

  function open() {
    if (stopped) return;
    onState({ kind: "connecting" });
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/relay/ws`);
    ws = socket;
    let keepAlive: ReturnType<typeof setInterval> | null = null;
    socket.onopen = () => {
      // answered by the Durable Object's auto-response, without waking it
      keepAlive = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send("ping"), 50_000);
    };
    socket.onmessage = (e: MessageEvent<string>) => {
      if (e.data === "pong") return;
      try {
        void onSignal(JSON.parse(String(e.data)));
      } catch {
        // not a signal
      }
    };
    socket.onclose = (e: CloseEvent) => {
      // the relay closed it on purpose (Sign out everywhere): start over, which shows the sign-in card
      if (e.code === 4001) return location.reload();
      if (keepAlive) clearInterval(keepAlive);
      if (ws === socket) ws = null;
      // an open data channel outlives the signalling socket; only reconnect signalling when there's none
      if (pc?.connectionState !== "connected") {
        teardown();
        onState({ kind: "connecting" });
      }
      again();
    };
  }

  open();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    ws?.close();
    teardown();
  };
}

/** Subscribes this browser to the daemon's own Web Push (through the data channel), with the hosted service worker. */
export async function subscribePush(
  vapidKey: string,
  post: (sub: PushSubscriptionJSON) => Promise<void>,
): Promise<"done" | "denied" | "unsupported"> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if ((await Notification.requestPermission()) !== "granted") return "denied";
  const reg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64url(vapidKey) });
  await post(sub.toJSON());
  return "done";
}
