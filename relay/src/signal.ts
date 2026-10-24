/**
 * One Durable Object per workspace, doing signalling only: it brokers WebRTC offers, answers and ICE candidates between
 * the workspace's daemon and its browsers, then the dashboard flows peer to peer and the object goes back to sleep.
 * Hibernation-friendly: no state lives in memory. Who is who comes from each socket's tags and attachment, so a fresh
 * instance woken by a message routes exactly like the one that accepted the sockets. Pings are answered by the runtime
 * (setWebSocketAutoResponse) without waking it.
 *
 * Everyone here has already been authenticated by the Worker for this workspace (worker.ts); the object only ever pairs
 * sockets it holds, which are all one workspace's.
 */
import type { Signal } from "@overhand/contract";

/** The parts of a Workers WebSocket the hibernation API uses. */
export type HibernatingSocket = {
  send(message: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

/** The parts of DurableObjectState used here. */
export type SignalState = {
  acceptWebSocket(ws: HibernatingSocket, tags?: string[]): void;
  getWebSockets(tag?: string): HibernatingSocket[];
  setWebSocketAutoResponse(pair?: unknown): void;
};

/** Who a socket belongs to, stored on the socket so it survives hibernation (≤ 16 KiB). */
export type Who = { role: "daemon"; pub: string; name: string } | { role: "peer"; id: string };

declare const WebSocketRequestResponsePair: { new (request: string, response: string): unknown };
declare const WebSocketPair: { new (): { 0: unknown; 1: HibernatingSocket } };

/** Browsers per workspace at once; more is someone hammering it. */
export const MAX_PEERS = 16;
/** Bigger signalling messages are dropped: an SDP with candidates is a few KiB. */
const MAX_SIGNAL = 32 * 1024;

const PEER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const whoOf = (ws: HibernatingSocket): Who | null => {
  const a = ws.deserializeAttachment();
  if (typeof a !== "object" || a === null || !("role" in a)) return null;
  if (a.role === "daemon" && "pub" in a && "name" in a) return { role: "daemon", pub: String(a.pub), name: String(a.name) };
  if (a.role === "peer" && "id" in a) return { role: "peer", id: String(a.id) };
  return null;
};

const sendTo = (ws: HibernatingSocket, s: Signal): void => {
  try {
    ws.send(JSON.stringify(s));
  } catch {
    // closing already; its close handler tidies up
  }
};

/** A signalling message from a peer or the daemon, or null when it isn't one it may send. */
function parseSignal(raw: string, from: Who["role"]): Signal | null {
  if (raw.length > MAX_SIGNAL) return null;
  try {
    const m: unknown = JSON.parse(raw);
    if (typeof m !== "object" || m === null || !("type" in m)) return null;
    const o: Record<string, unknown> = { ...m };
    const s = (k: string) => (typeof o[k] === "string" ? String(o[k]) : null);
    if (from === "peer" && o.type === "offer" && s("sdp") !== null) return { type: "offer", sdp: s("sdp") ?? "" };
    if (o.type === "ice" && s("candidate") !== null && s("mid") !== null) {
      const ice: Signal = { type: "ice", candidate: s("candidate") ?? "", mid: s("mid") ?? "" };
      if (from === "peer") return ice;
      const to = s("to");
      return to ? { ...ice, to } : null;
    }
    if (from === "daemon" && o.type === "answer" && s("sdp") !== null && s("sig") !== null && s("to"))
      return { type: "answer", sdp: s("sdp") ?? "", sig: s("sig") ?? "", to: s("to") ?? "" };
    return null;
  } catch {
    return null;
  }
}

/** The workspace's signalling room. */
export class Workspace {
  constructor(
    private readonly ctx: SignalState,
    _env: unknown,
  ) {
    // set on every wake (it's cheap and idempotent): the daemon's and browsers' keep-alive never wakes the object
    if (typeof WebSocketRequestResponsePair !== "undefined") ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** The Worker forwards an authenticated upgrade here, naming the role in x-role (and the daemon's key and name). */
  async fetch(req: Request): Promise<Response> {
    // only the Worker reaches the object, and it forwards clients' requests only as upgrades (without x-kick)
    const kick = req.headers.get("x-kick");
    if (kick && req.headers.get("upgrade") !== "websocket") {
      this.kick(kick);
      return new Response(null, { status: 204 });
    }
    if (req.headers.get("upgrade") !== "websocket") return new Response("expected a websocket", { status: 426 });
    const role = req.headers.get("x-role");
    const who: Who | null =
      role === "daemon"
        ? { role: "daemon", pub: req.headers.get("x-pub") ?? "", name: req.headers.get("x-name") ?? "" }
        : role === "peer"
          ? { role: "peer", id: crypto.randomUUID() }
          : null;
    if (!who) return new Response("no role", { status: 400 });
    const pair = new WebSocketPair();
    if (!this.accept(pair[1], who)) return new Response("too many browsers on this workspace", { status: 429 });
    const init: ResponseInit & { webSocket: unknown } = { status: 101, webSocket: pair[0] };
    return new Response(null, init);
  }

  /** Takes a socket in; false when the workspace already has MAX_PEERS browsers. */
  accept(ws: HibernatingSocket, who: Who): boolean {
    if (who.role === "peer") {
      if (this.ctx.getWebSockets("peer").length >= MAX_PEERS) return false;
      this.ctx.acceptWebSocket(ws, ["peer", who.id]);
      ws.serializeAttachment(who);
      const d = this.daemon();
      sendTo(ws, { type: "daemon", online: Boolean(d), pub: d?.who.pub ?? "", name: d?.who.name ?? "" });
      return true;
    }
    // one daemon per workspace: a new connection (a restart, a network change) replaces the old one
    for (const old of this.ctx.getWebSockets("daemon")) old.close(4000, "replaced by a newer connection");
    this.ctx.acceptWebSocket(ws, ["daemon"]);
    ws.serializeAttachment(who);
    for (const p of this.ctx.getWebSockets("peer")) sendTo(p, { type: "daemon", online: true, pub: who.pub, name: who.name });
    return true;
  }

  /**
   * Closes every browser ("peers": Sign out everywhere) or the daemon holding one key ("daemon:<pub>": Unlink this
   * computer), telling the other side as a normal close would.
   */
  kick(who: string): void {
    for (const ws of this.ctx.getWebSockets(who === "peers" ? "peer" : "daemon")) {
      const w = whoOf(ws);
      if (!w || (w.role === "daemon" && `daemon:${w.pub}` !== who)) continue;
      ws.close(4001, w.role === "peer" ? "signed out" : "unlinked");
      this.webSocketClose(ws, 4001, "", true);
    }
  }

  /** The connected daemon, if any. A replaced one may still be closing, so the newest wins. */
  private daemon(): { ws: HibernatingSocket; who: Extract<Who, { role: "daemon" }> } | null {
    const all = this.ctx.getWebSockets("daemon");
    for (let i = all.length - 1; i >= 0; i--) {
      const ws = all[i];
      const who = ws ? whoOf(ws) : null;
      if (ws && who?.role === "daemon") return { ws, who };
    }
    return null;
  }

  /** Routes one message: a browser's offer or candidate to the daemon, the daemon's answer or candidate to that browser. */
  webSocketMessage(ws: HibernatingSocket, message: string | ArrayBuffer): void {
    const who = whoOf(ws);
    if (!who || typeof message !== "string") return;
    const s = parseSignal(message, who.role);
    if (!s) return;
    if (who.role === "peer") {
      const d = this.daemon();
      if (!d) sendTo(ws, { type: "daemon", online: false, pub: "", name: "" });
      else if (s.type === "offer" || s.type === "ice") sendTo(d.ws, { ...s, from: who.id });
      return;
    }
    if (!("to" in s) || !s.to || !PEER_ID.test(s.to)) return;
    // only a socket this object holds, tagged as that browser: there is no way to reach another workspace from here
    for (const p of this.ctx.getWebSockets(s.to)) if (whoOf(p)?.role === "peer") sendTo(p, s);
  }

  /** A daemon leaving tells its browsers; a browser leaving tells the daemon to drop that peer connection. */
  webSocketClose(ws: HibernatingSocket, _code: number, _reason: string, _wasClean: boolean): void {
    const who = whoOf(ws);
    if (!who) return;
    if (who.role === "peer") {
      const d = this.daemon();
      if (d) sendTo(d.ws, { type: "bye", from: who.id });
      return;
    }
    const still = this.ctx.getWebSockets("daemon").some((d) => d !== ws);
    if (!still) for (const p of this.ctx.getWebSockets("peer")) sendTo(p, { type: "daemon", online: false, pub: "", name: "" });
  }

  /** Errors close the socket; treated as a close. */
  webSocketError(ws: HibernatingSocket, _error: unknown): void {
    this.webSocketClose(ws, 1011, "error", false);
  }
}
