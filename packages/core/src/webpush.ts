/**
 * Web Push sent by the daemon itself: VAPID keys made and kept on this machine (.push.json, 0600), payloads encrypted
 * per RFC 8291 (aes128gcm) and authorised per RFC 8292, posted straight to each browser's push service. No push server
 * of ours exists; a browser subscribes through the hosted page, over the data channel.
 */
import { createCipheriv, createECDH, createHmac, createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { b64url, REPO_URL, unb64url } from "@overhand/contract";
import { z } from "zod";
import { OPS } from "./env";

const SubscriptionSchema = z.object({
  endpoint: z.url().refine((u) => u.startsWith("https://"), "push endpoints are https"),
  keys: z.object({ p256dh: z.string().min(80).max(100), auth: z.string().min(16).max(32) }),
});
/** A browser's push subscription, as PushSubscription.toJSON() gives it. */

const JwkSchema = z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string(), y: z.string(), d: z.string() });
const StoreSchema = z.object({ vapid: JwkSchema, subs: z.array(SubscriptionSchema.extend({ at: z.number() })) });
type Store = z.infer<typeof StoreSchema>;

const file = () => join(OPS, ".push.json");
/** Browsers kept at once; the oldest goes first. */
const MAX_SUBS = 20;

function load(): Store {
  try {
    const s = StoreSchema.safeParse(existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : null);
    if (s.success) return s.data;
  } catch {
    // unreadable: make new keys below; old subscriptions are lost, browsers subscribe again
  }
  const jwk = JwkSchema.parse(generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }));
  const store = { vapid: jwk, subs: [] };
  save(store);
  return store;
}
const save = (s: Store) => writeFileSync(file(), JSON.stringify(s), { mode: 0o600 });

/** The VAPID public key (uncompressed P-256 point, base64url): a browser's applicationServerKey. */
export const vapidPublicKey = (s = load()): string => b64url(new Uint8Array([4, ...unb64url(s.vapid.x), ...unb64url(s.vapid.y)]));

/** Stores a browser's subscription (replacing the same endpoint); false when it isn't one. */
export function addSubscription(raw: unknown, now = Date.now()): boolean {
  const sub = SubscriptionSchema.safeParse(raw);
  if (!sub.success) return false;
  const s = load();
  s.subs = [...s.subs.filter((x) => x.endpoint !== sub.data.endpoint), { ...sub.data, at: now }].slice(-MAX_SUBS);
  save(s);
  return true;
}

/** How many browsers are subscribed. */
export const subscriptions = (): number => load().subs.length;

const hmac = (key: Uint8Array, data: Uint8Array) => new Uint8Array(createHmac("sha256", key).update(data).digest());
const cat = (...parts: Uint8Array[]) => new Uint8Array(parts.flatMap((p) => [...p]));
const text = (s: string) => new TextEncoder().encode(s);

/**
 * RFC 8291 encryption of one push message: a single aes128gcm record. `salt` and `senderPrivate` exist for the RFC's
 * test vector; in use both are fresh per message.
 */
export function encryptPush(
  plaintext: Uint8Array,
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
  opts: { salt?: Uint8Array; senderPrivate?: Uint8Array } = {},
): Uint8Array<ArrayBuffer> {
  const ecdh = createECDH("prime256v1");
  if (opts.senderPrivate) ecdh.setPrivateKey(opts.senderPrivate);
  else ecdh.generateKeys();
  const asPublic = new Uint8Array(ecdh.getPublicKey());
  const secret = new Uint8Array(ecdh.computeSecret(uaPublic));
  const salt = opts.salt ?? new Uint8Array(randomBytes(16));
  const prkKey = hmac(authSecret, secret);
  const ikm = hmac(prkKey, cat(text("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, cat(text("Content-Encoding: aes128gcm\0"), new Uint8Array([1]))).slice(0, 16);
  const nonce = hmac(prk, cat(text("Content-Encoding: nonce\0"), new Uint8Array([1]))).slice(0, 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // one record, so the padding delimiter is 0x02 (last record)
  const body = cat(
    new Uint8Array(cipher.update(cat(plaintext, new Uint8Array([2])))),
    new Uint8Array(cipher.final()),
    new Uint8Array(cipher.getAuthTag()),
  );
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return cat(salt, rs, new Uint8Array([asPublic.length]), asPublic, body);
}

/** The RFC 8292 Authorization header for a push service's origin, valid 12 hours. */
export function vapidAuth(endpoint: string, s = load(), now = Date.now()): string {
  const enc = (o: object) => b64url(text(JSON.stringify(o)));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: REPO_URL };
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc(claims)}`;
  const key = createPrivateKey({ key: s.vapid, format: "jwk" });
  const sig = new Uint8Array(sign("sha256", text(unsigned), { key, dsaEncoding: "ieee-p1363" }));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${vapidPublicKey(s)}`;
}

/**
 * Pushes `title`/`body` to every subscribed browser; a tap opens `url`. A subscription the push service says is gone
 * (404, 410) is dropped. Never throws: a failed push is logged, like ntfy's.
 */
export async function webPushAll(title: string, body: string, url: string): Promise<number> {
  const s = load();
  if (!s.subs.length) return 0;
  const payload = text(JSON.stringify({ title, body, url }).slice(0, 3000));
  const gone = new Set<string>();
  let sent = 0;
  await Promise.all(
    s.subs.map(async (sub) => {
      try {
        const r = await fetch(sub.endpoint, {
          method: "POST",
          headers: { TTL: "86400", Urgency: "high", "Content-Encoding": "aes128gcm", Authorization: vapidAuth(sub.endpoint, s) },
          body: encryptPush(payload, unb64url(sub.keys.p256dh), unb64url(sub.keys.auth)),
          signal: AbortSignal.timeout(10_000),
        });
        if (r.status === 404 || r.status === 410) gone.add(sub.endpoint);
        else if (r.ok) sent++;
        else console.error(`web push failed: HTTP ${r.status}`);
      } catch (e) {
        console.error(`web push failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );
  if (gone.size) {
    const now = load();
    save({ ...now, subs: now.subs.filter((x) => !gone.has(x.endpoint)) });
  }
  return sent;
}
