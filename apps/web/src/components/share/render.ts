/**
 * Draws the social card on a canvas: the theme's dark ink with a soft pool of light, the text in the house type, and the
 * Overhand mark and link, which never change with the theme. Loaded only with the Share drawer.
 */
import { SITE as SITE_URL } from "@overhand/contract";
import { markParts, SYSTEM, type ThemeDefinition, themeById, WORDMARK, you } from "@overhand/themes";
import type { CardContent } from "@/lib/card";

export const CARD_SIZES = { wide: [1200, 675], square: [1080, 1080] } as const;
export type CardSize = keyof typeof CARD_SIZES;

/** The site the card links to. */
const SITE = new URL(SITE_URL).host;
/** The house faces: the mark's wordmark and the brand line, the same in every world. */
const DISPLAY = SYSTEM.font.body;
const UI = SYSTEM.font.body;
/** The mark's one orange, the only orange that isn't about you. */
const MARK = you.fill;

/** Waits for the faces the card uses (the house faces, always on the page). Never throws. */
async function fonts(faces: string[]): Promise<void> {
  await Promise.all(faces.map((f) => document.fonts.load(f).catch(() => []))).catch(() => undefined);
}

/** `#rrggbb` at `alpha`, for the canvas. */
function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Lines of `text` that fit `width`, at most `max`, the last cut with an ellipsis. */
function wrap(c: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1] ?? "";
  while (last && c.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  kept[max - 1] = `${last.trimEnd()}…`;
  return kept;
}

/**
 * Overhand's lockup (packages/themes/src/brand.ts): the work, an outline square in `ink`, you lifted over it in signal
 * orange, then the wordmark in `ink`, the work square one cap height, standing on the baseline.
 */
function logo(c: CanvasRenderingContext2D, x: number, y: number, size: number, ink: string): void {
  const p = markParts(size);
  c.strokeStyle = ink;
  c.lineWidth = p.stroke;
  c.strokeRect(x + p.stroke / 2, y + p.lift + p.stroke / 2, p.side - p.stroke, p.side - p.stroke);
  c.fillStyle = MARK;
  c.fillRect(x + p.lift, y, p.side, p.side);
  c.fillStyle = ink;
  c.font = `${WORDMARK.weight} ${p.side / WORDMARK.cap}px ${DISPLAY}`;
  c.letterSpacing = WORDMARK.track;
  c.textBaseline = "alphabetic";
  c.fillText(WORDMARK.text, x + size + p.lift, y + size);
  c.letterSpacing = "0px";
}

/** Draws the card for `content` in `theme` at `size` onto `canvas` (which it resizes). */
export async function renderCard(canvas: HTMLCanvasElement, content: CardContent, chosen: ThemeDefinition, size: CardSize): Promise<void> {
  // always the theme's dark look, whatever the page's appearance: one card per world, whoever opens it
  const theme = themeById(chosen.id);
  const t = theme.tokens;
  const ink = (n: number) => theme.ink?.[n - 1] ?? t.foreground;
  const [w, h] = CARD_SIZES[size];
  const square = size === "square";
  const head = DISPLAY;
  const body = theme.fonts.body;
  await fonts([`600 96px ${head}`, `400 30px ${body}`, `${WORDMARK.weight} 40px ${DISPLAY}`, `500 22px ${UI}`]);
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d");
  if (!c) return;

  // the ground: the world's ink, with a quiet pool of light low on the right, away from the text
  c.fillStyle = t.background;
  c.fillRect(0, 0, w, h);
  const pool = c.createRadialGradient(w * 0.82, h * 0.86, 0, w * 0.82, h * 0.86, Math.max(w, h) * 0.7);
  pool.addColorStop(0, rgba(ink(12), 0.1));
  pool.addColorStop(1, rgba(ink(12), 0));
  c.fillStyle = pool;
  c.fillRect(0, 0, w, h);

  const pad = square ? 88 : 72;
  const width = (square ? w : w * 0.72) - pad;
  const footY = h - pad + 8;
  const top = pad + (square ? 220 : 150);
  /**
   * Sets the headline, the line under it, the counts and (with `details`) what the switches allowed, at headline size
   * `big`; returns where the text ends. Without `draw` it only measures.
   */
  const pass = (big: number, draw: boolean, details: boolean): number => {
    const put = (line: string, y: number) => {
      if (draw) c.fillText(line, pad, y);
    };
    c.textBaseline = "alphabetic";
    c.fillStyle = ink(12);
    c.font = `600 ${big}px ${head}`;
    let y = top - (square ? 0 : Math.max(0, 84 - big));
    for (const line of wrap(c, content.headline, width, 3)) {
      put(line, y);
      y += big * 1.05;
    }
    y += 10;
    c.font = `500 ${square ? 40 : 34}px ${body}`;
    c.fillStyle = ink(11);
    for (const line of wrap(c, content.sub, width, 2)) {
      put(line, y);
      y += square ? 52 : 44;
    }
    c.font = `400 ${square ? 30 : 26}px ${body}`;
    c.fillStyle = ink(10);
    if (content.stats.length) y += 12;
    for (const line of wrap(c, content.stats.join("  ·  "), width, 2)) {
      put(line, y);
      y += square ? 42 : 36;
    }
    if (!details) return y;
    y += 16;
    c.fillStyle = ink(11);
    c.font = `400 ${square ? 28 : 24}px ${body}`;
    for (const d of content.details) {
      if (y > footY - 50) break;
      for (const line of wrap(c, d, width, 1)) {
        put(line, y);
        y += square ? 40 : 34;
      }
    }
    return y;
  };
  // a long themed headline steps down until everything clears the brand line
  let big = square ? 96 : 84;
  while (big > 48 && pass(big, false, false) > footY - 50) big -= 6;
  logo(c, pad, pad - 6, 40, ink(12));
  pass(big, true, true);

  // the brand line: fixed, never themed
  c.font = `500 22px ${UI}`;
  c.fillStyle = ink(10);
  c.textBaseline = "alphabetic";
  c.fillText(`${content.foot} · ${SITE}`, pad, footY);
}

/** The canvas as a PNG. */
export const toPng = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("couldn't make the image"))), "image/png"));
