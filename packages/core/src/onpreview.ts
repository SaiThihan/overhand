/**
 * Reviewing an agent PR on its deployed preview: a still of the page to pin notes on, the notes sent to the same agent as
 * its PR's next fix round, and the pinned spots checked again once it pushes. Review, not building: nothing here edits code.
 * A preview on another site can't be read from the dashboard, so pins sit on a still the daemon takes at a fixed size.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { PreviewPin, PreviewReview, PreviewViewport } from "@overhand/contract";
import { type Clip, captureStill, shotsDir } from "./shots";
import { readJson, type TrackedPr, writeJsonAtomic } from "./state";

/** The sizes a preview is looked at in. */
const VIEWPORTS: Record<PreviewViewport, { width: number; height: number }> = {
  wide: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
};

/** The most pins one review sends, and the longest note. */
const MAX_PINS = 20;
const MAX_NOTE = 500;

/** What a review keeps on disk: the still, your pins, and the head commit the preview showed when you sent them. */
interface Session {
  url: string;
  viewport: PreviewViewport;
  width: number;
  height: number;
  pins: { n: number; x: number; y: number; note: string }[];
  round: number;
  sha: string;
  note: string;
}

const dirOf = (key: string): string => join(shotsDir(key), "review");
const fileOf = (key: string): string => join(dirOf(key), "session.json");
const loadSession = (key: string): Session | null => readJson<Session | null>(fileOf(key), null);
const saveSession = (key: string, s: Session): void => {
  mkdirSync(dirOf(key), { recursive: true });
  writeJsonAtomic(fileOf(key), s);
};

/** The files a review writes, by name: only these are served back to the dashboard. */
const STILL = (v: PreviewViewport): string => `still-${v}.png`;
const crop = (n: number, when: "before" | "after"): string => `pin-${n}-${when}.png`;
const REVIEW_FILE = /^(still-(wide|phone)|pin-\d{1,2}-(before|after))\.png$/;
/** A review image on disk, or "" when the name isn't one a review writes or it isn't there. */
export function reviewImage(key: string, name: string): string {
  const f = join(dirOf(key), name);
  return REVIEW_FILE.test(name) && existsSync(f) ? f : "";
}

/**
 * Whether a site lets another page show it in a frame, from its response headers: no `X-Frame-Options` DENY/SAMEORIGIN,
 * and a CSP `frame-ancestors` that is absent or allows `*` or `origin`.
 */
export function frameable(h: { get(name: string): string | null }, origin = ""): boolean {
  if (/deny|sameorigin/i.test(h.get("x-frame-options") ?? "")) return false;
  const ancestors = /frame-ancestors([^;]*)/i.exec(h.get("content-security-policy") ?? "")?.[1];
  if (ancestors === undefined) return true;
  const allowed = ancestors.trim().split(/\s+/);
  return allowed.includes("*") || (origin !== "" && allowed.includes(origin));
}

const framing = new Map<string, { at: number; ok: boolean }>();
/** Whether `url` may be shown in the dashboard's frame (asked once per 10 minutes); a site that doesn't answer can't. */
export async function canFrame(url: string, origin: string): Promise<boolean> {
  const hit = framing.get(url);
  if (hit && Date.now() - hit.at < 600_000) return hit.ok;
  const ok = await fetch(url, { signal: AbortSignal.timeout(8000) })
    .then((r) => r.ok && frameable(r.headers, origin))
    .catch(() => false);
  framing.set(url, { at: Date.now(), ok });
  return ok;
}

/**
 * The area cropped around a pin: the page's full width, `h` tall, centred on the pin's height and kept inside the page.
 * Full width so a line of text is never cut at the sides, and before and after always share one shape.
 */
export function cropAround(_x: number, y: number, page: { width: number; height: number }, h = 320): Clip {
  const height = Math.min(h, page.height);
  const top = Math.min(Math.max(0, Math.round(y - height / 2)), page.height - height);
  return { x: 0, y: top, width: page.width, height };
}

/**
 * Your pins as the fix round's feedback: each spot in words, the note, and the crop the agent can open. The agent sees
 * the page at the same size by opening the preview.
 */
export function pinNotes(s: Pick<Session, "url" | "viewport" | "pins">, cropFile: (n: number) => string): string {
  const size = VIEWPORTS[s.viewport];
  return [
    `Notes pinned on the preview ${s.url}, seen ${s.viewport === "phone" ? "on a phone" : "on a laptop"} (${size.width}×${size.height}):`,
    ...s.pins.map((p) => {
      const f = cropFile(p.n);
      return `${p.n}. At ${p.x},${p.y} on the page: "${p.note}".${f ? ` The spot as it is now: ${f}` : ""}`;
    }),
    "Fix each note where it points. Check it at the same size before you push.",
  ].join("\n");
}

/** What the dashboard shows of a PR's review; `img` turns a file name into a URL the dashboard can fetch. */
export function reviewOf(key: string, pr: TrackedPr, frame: boolean, img: (name: string) => string): PreviewReview {
  const s = loadSession(key);
  const url = pr.preview ?? "";
  if (!s)
    return { key, url, frameable: frame, viewport: "wide", still: "", width: 0, height: 0, pins: [], round: 0, pushed: false, note: "" };
  const has = (name: string) => (reviewImage(key, name) ? img(name) : "");
  const pins: PreviewPin[] = s.pins.map((p) => ({ ...p, before: has(crop(p.n, "before")), after: has(crop(p.n, "after")) }));
  return {
    key,
    url,
    frameable: frame,
    viewport: s.viewport,
    still: has(STILL(s.viewport)),
    width: s.width,
    height: s.height,
    pins,
    round: s.round,
    // the agent has pushed since your notes: its preview moved to a newer head commit
    pushed: s.round > 0 && !!pr.previewSha && pr.previewSha !== s.sha,
    note: s.note,
  };
}

/** Takes a fresh still of the preview at `viewport` and starts a new review on it (earlier pins and crops go). */
export async function takeStill(key: string, pr: TrackedPr, viewport: PreviewViewport): Promise<string> {
  if (!pr.preview) return "this PR has no preview yet";
  rmSync(dirOf(key), { recursive: true, force: true });
  mkdirSync(dirOf(key), { recursive: true });
  const r = await captureStill(key, pr.preview, VIEWPORTS[viewport], { still: join(dirOf(key), STILL(viewport)) });
  const base = { url: pr.preview, viewport, pins: [], round: 0, sha: pr.previewSha ?? "" };
  saveSession(key, r.ok ? { ...base, width: r.width, height: r.height, note: "" } : { ...base, width: 0, height: 0, note: r.why });
  return r.ok ? "" : r.why;
}

/** Checks pins sent from the dashboard against the still: numbered from 1, on the page, each with a short note. */
export function cleanPins(raw: unknown, page: { width: number; height: number }): Session["pins"] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "pin at least one spot";
  if (raw.length > MAX_PINS) return `keep it to ${MAX_PINS} notes`;
  const pins: Session["pins"] = [];
  for (const [i, p] of raw.entries()) {
    const x = Number((p as { x?: unknown }).x);
    const y = Number((p as { y?: unknown }).y);
    const note = String((p as { note?: unknown }).note ?? "").trim();
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > page.width || y > page.height) return "a pin is off the page";
    if (!note) return `pin ${i + 1} has no note`;
    if (note.length > MAX_NOTE) return `keep each note under ${MAX_NOTE} characters`;
    pins.push({ n: i + 1, x: Math.round(x), y: Math.round(y), note });
  }
  return pins;
}

/**
 * Records your pins, crops each spot as it is now, and returns the fix round's feedback text (or an error). The caller
 * queues the text like any review note, so the same agent takes it on its PR's next fix round.
 */
export async function sendPins(key: string, pr: TrackedPr, raw: unknown): Promise<{ text: string } | { error: string }> {
  const s = loadSession(key);
  if (!s?.width) return { error: "take a still of the preview first" };
  const pins = cleanPins(raw, s);
  if (typeof pins === "string") return { error: pins };
  const crops = pins.map((p) => ({ file: join(dirOf(key), crop(p.n, "before")), clip: cropAround(p.x, p.y, s) }));
  const r = await captureStill(key, s.url, VIEWPORTS[s.viewport], { crops });
  const next: Session = { ...s, pins, round: pr.fixes + 1, sha: pr.previewSha ?? s.sha, note: r.ok ? "" : r.why };
  saveSession(key, next);
  return { text: pinNotes(next, (n) => reviewImage(key, crop(n, "before"))) };
}

/** Once the agent has pushed: crops the same spots on its new preview, so each note shows before and after. */
export async function checkFix(key: string, pr: TrackedPr): Promise<string> {
  const s = loadSession(key);
  if (!s?.round) return "send your notes first";
  if (!pr.preview || !pr.previewSha || pr.previewSha === s.sha) return "the agent hasn't pushed a fix yet";
  const crops = s.pins.map((p) => ({ file: join(dirOf(key), crop(p.n, "after")), clip: cropAround(p.x, p.y, s) }));
  const r = await captureStill(key, pr.preview, VIEWPORTS[s.viewport], { crops });
  saveSession(key, { ...s, note: r.ok ? "" : r.why });
  return r.ok ? "" : r.why;
}

/** The fix round a PR's preview notes became, for its card; 0 when none were sent. */
export const reviewRound = (key: string): number => loadSession(key)?.round ?? 0;
