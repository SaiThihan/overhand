/**
 * The demo's review on the preview: a drawn invite page (Mobile app's) to pin notes on, crops cut from the same drawing, and
 * the agent "pushing" its fix a few seconds after the notes go. Nothing leaves the page.
 */
import type { PreviewPin, PreviewReview, PreviewViewport } from "@overhand/contract";

const PAGE: Record<PreviewViewport, { width: number; height: number }> = {
  wide: { width: 1280, height: 980 },
  phone: { width: 390, height: 1060 },
};

/** The invite page as SVG shapes: before the fix a small "I'm in" button and a plain headline, after it a big friendly one. */
function shapes(v: PreviewViewport, fixed: boolean): string {
  const { width } = PAGE[v];
  const phone = v === "phone";
  const x = phone ? 16 : 260;
  const w = phone ? width - 32 : 760;
  const serif = 'font-family="Georgia, serif"';
  const sans = 'font-family="system-ui, sans-serif"';
  const top = 168;
  const cardH = phone ? 360 : 310;
  const head = fixed ? ["Sam would love you at", "dinner on Saturday"] : ["You're invited to", "Sam's dinner"];
  const headline = phone
    ? `<text x="${x + 20}" y="${top + 84}" ${serif} font-size="26" font-weight="700" fill="#2b2118">${head[0]}</text><text x="${x + 20}" y="${top + 116}" ${serif} font-size="26" font-weight="700" fill="#2b2118">${head[1]}</text>`
    : `<text x="${x + 28}" y="${top + 92}" ${serif} font-size="32" font-weight="700" fill="#2b2118">${head.join(" ")}</text>`;
  const by = top + (phone ? 150 : 128);
  const faces = ["#c0583a", "#3f6b4f", "#5b5fa8", "#b8902f"]
    .map((c, i) => `<circle cx="${x + 40 + i * 22}" cy="${by + 46}" r="14" fill="${c}" stroke="#fff" stroke-width="2"/>`)
    .join("");
  const bw = fixed ? (phone ? w - 40 : 240) : 78;
  const bh = fixed ? 54 : 30;
  const bx = x + 20;
  const btY = by + (phone ? 96 : 84);
  const button = `<rect x="${bx}" y="${btY}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="#3f6b4f"/><text x="${bx + bw / 2}" y="${btY + bh / 2 + 5}" ${sans} font-size="${fixed ? 18 : 13}" font-weight="600" fill="#fff" text-anchor="middle">I'm in</text>`;
  const cant = fixed
    ? `<text x="${bx + (phone ? bw / 2 : bw + 24)}" y="${phone ? btY + bh + 30 : btY + bh / 2 + 5}" ${sans} font-size="15" fill="#7a6a58" text-anchor="${phone ? "middle" : "start"}" text-decoration="underline">Can't make it</text>`
    : `<text x="${bx + bw + 14}" y="${btY + 20}" ${sans} font-size="12" fill="#7a6a58" text-decoration="underline">Can't make it</text>`;
  const listY = top + cardH + 56;
  const rows = ["Mia: lemon tart", "Leo: focaccia", "Sam: the big pot of ragù"]
    .map(
      (t, i) =>
        `<rect x="${x}" y="${listY + 22 + i * 60}" width="${w}" height="48" rx="10" fill="#fff" stroke="#ece4d8"/><text x="${x + 16}" y="${listY + 52 + i * 60}" ${sans} font-size="15" fill="#5b4c3d">${t}</text>`,
    )
    .join("");
  return [
    `<rect width="${width}" height="${PAGE[v].height}" fill="#fbf7f0"/>`,
    `<text x="${x}" y="58" ${serif} font-size="26" font-weight="700" fill="#2b2118">mobile app</text>`,
    phone ? "" : `<text x="${x + w}" y="56" ${sans} font-size="15" fill="#7a6a58" text-anchor="end">Dinners    Friends    You</text>`,
    `<line x1="${x}" y1="86" x2="${x + w}" y2="86" stroke="#ece4d8"/>`,
    `<text x="${x}" y="132" ${sans} font-size="14" fill="#7a6a58">Dinners · Saturday 25 October</text>`,
    `<rect x="${x}" y="${top}" width="${w}" height="${cardH}" rx="16" fill="#fff" stroke="#ece4d8"/>`,
    `<text x="${x + (phone ? 20 : 28)}" y="${top + 40}" ${sans} font-size="12" letter-spacing="1.5" fill="#7a6a58">SAM'S DINNER</text>`,
    headline,
    `<text x="${x + (phone ? 20 : 28)}" y="${by}" ${sans} font-size="15" fill="#7a6a58">Saturday at 7, at Sam's place on Elm Street</text>`,
    faces,
    `<text x="${x + 140}" y="${by + 51}" ${sans} font-size="15" fill="#2b2118">Mia, Leo and 4 more are coming</text>`,
    button,
    cant,
    `<text x="${x}" y="${listY}" ${serif} font-size="20" font-weight="700" fill="#2b2118">Who's bringing what</text>`,
    rows,
  ].join("");
}

/** A drawing as an image URL, the whole page or one spot of it (`box`). */
function image(v: PreviewViewport, fixed: boolean, box?: { x: number; y: number; width: number; height: number }): string {
  const { width, height } = PAGE[v];
  const b = box ?? { x: 0, y: 0, width, height };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="${b.x} ${b.y} ${b.width} ${b.height}">${shapes(v, fixed)}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The band around a pin: the page's full width, 320 tall, kept on the page (as the daemon's cropAround crops it). */
function spot(p: { x: number; y: number }, v: PreviewViewport) {
  const { width, height } = PAGE[v];
  const h = Math.min(320, height);
  return { x: 0, y: Math.min(Math.max(0, Math.round(p.y - h / 2)), height - h), width, height: h };
}

interface Session {
  viewport: PreviewViewport;
  pins: { n: number; x: number; y: number; note: string }[];
  round: number;
  pushed: boolean;
  checked: boolean;
}
const sessions = new Map<string, Session>();

/** The fix round a PR's notes became in the demo, and whether its agent has "pushed" (for the PR card and fix count). */
export const demoReviewRound = (key: string): { round: number; pushed: boolean } => {
  const s = sessions.get(key);
  return { round: s?.round ?? 0, pushed: s?.pushed ?? false };
};

/** The demo's GET /api/preview/review. */
export function demoReview(key: string): PreviewReview {
  const s = sessions.get(key);
  const url = `https://${key.toLowerCase()}.preview.example.com`;
  if (!s)
    return { key, url, frameable: false, viewport: "wide", still: "", width: 0, height: 0, pins: [], round: 0, pushed: false, note: "" };
  const pins: PreviewPin[] = s.pins.map((p) => ({
    ...p,
    before: s.round ? image(s.viewport, false, spot(p, s.viewport)) : "",
    after: s.checked ? image(s.viewport, true, spot(p, s.viewport)) : "",
  }));
  return {
    key,
    url,
    frameable: false,
    viewport: s.viewport,
    still: image(s.viewport, false),
    ...PAGE[s.viewport],
    pins,
    round: s.round,
    pushed: s.pushed,
    note: "",
  };
}

/** The demo's POST /api/preview/still, send and check; `fixes` is the PR's fix rounds so far. */
export function demoReviewPost(url: string, key: string, body: Record<string, unknown>, fixes: number): PreviewReview | undefined {
  if (url === "/api/preview/still") {
    const viewport = body.viewport === "phone" ? "phone" : "wide";
    sessions.set(key, { viewport, pins: [], round: 0, pushed: false, checked: false });
    return demoReview(key);
  }
  const s = sessions.get(key);
  if (!s) return undefined;
  if (url === "/api/preview/send" && Array.isArray(body.pins) && body.pins.length) {
    s.pins = body.pins.map((p, i) => ({
      n: i + 1,
      x: Math.round(Number((p as { x?: unknown }).x) || 0),
      y: Math.round(Number((p as { y?: unknown }).y) || 0),
      note: String((p as { note?: unknown }).note ?? ""),
    }));
    s.round = fixes + 1;
    // the agent takes the round and pushes a little later, as a real fix round would on the next pass
    setTimeout(() => {
      s.pushed = true;
    }, 6000);
    return demoReview(key);
  }
  if (url === "/api/preview/check" && s.pushed) {
    s.checked = true;
    return demoReview(key);
  }
  return undefined;
}
