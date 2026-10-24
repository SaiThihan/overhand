/**
 * The attention map's model: the dashboard's state laid out around you. Pure, no DOM.
 *
 * You sit at the centre. The inner ring is what needs you, the middle ring what's working, the outer ring what's idle
 * or done. Each project owns a sector. Past `CAP` agents in a sector the quiet ones gather into a crew (a count and
 * its states); what waits on you is never gathered. Subagents orbit their parent.
 */
import { type DashboardState, questionLine } from "@overhand/contract";
import type { Alert } from "@/lib/alerts";
import { leadName } from "@/lib/sessions";
import { leadsIn } from "@/lib/world";

type MapState = "waiting" | "working" | "idle" | "done";

/** Where clicking an agent goes. */
export type MapOpen =
  | { kind: "lead"; key: string }
  | { kind: "ticket"; key: string }
  | { kind: "review"; key: string }
  | { kind: "crew"; project: string };

export interface MapAgent {
  id: string;
  label: string;
  /** A short line of what it's doing or asking. */
  note: string;
  state: MapState;
  lead: boolean;
  sector: number;
  /** Subagents at work under it. */
  subs: number;
  /** 0…1 through its run, for the working arc; 0 when unknown. */
  progress: number;
  open: MapOpen;
  x: number;
  y: number;
  /** Degrees, 0 at the top, clockwise. */
  angle: number;
  /** The heading it travels along, where a world lays it on a line (Transit); its angle otherwise. */
  dir?: number;
}

export interface MapCrew {
  id: string;
  sector: number;
  project: string;
  count: number;
  working: number;
  quiet: number;
  x: number;
  y: number;
  angle: number;
  dir?: number;
}

export interface MapSector {
  name: string;
  /** Start and span in degrees, 0 at the top, clockwise. */
  a0: number;
  span: number;
  merged: number;
  broken: boolean;
}

export interface MapModel {
  /** How many things wait on you: the same count as Needs you. */
  waiting: number;
  sectors: MapSector[];
  agents: MapAgent[];
  crews: MapCrew[];
}

/** Ring radii in map units (the map is 1000 units across): you, then the borders of the three rings. */
export const R = { you: 46, r0: 72, r1: 204, r2: 334, r3: 452 } as const;
/**
 * Your centre at a drawn size (`k` map units per CSS px): its radius, never under 22 px so a phone's map keeps a
 * readable count, and your name's size and baseline, clear below the rim that points at what waits on you.
 */
export function youAt(k: number): { r: number; rim: number; nameSize: number; nameY: number; name: Box } {
  const r = Math.max(R.you, 20 * k);
  const nameSize = Math.max(13, 11 * k);
  // the rim's arcs sit at r + 9, 3 units thick; the name starts 4 px under them
  const rim = r + 10.5;
  const nameY = rim + 4 * k + nameSize * 0.78;
  // the name's box, wide enough for a short word ("You", a teammate's first name)
  const half = nameSize * 2.2;
  return { r, rim, nameSize, nameY, name: [-half, rim + 2 * k, half, nameY + nameSize * 0.3 + 2 * k] };
}
/** Individuals per sector before the quiet rest gather into a crew. */
export const CAP = 7;
/** The middle of each ring, where its agents sit. */
const RING: Record<MapState, number> = {
  waiting: (R.r0 + R.r1) / 2,
  working: (R.r1 + R.r2) / 2,
  idle: (R.r2 + R.r3) / 2 + 6,
  done: (R.r2 + R.r3) / 2 - 10,
};
/** The least angle between neighbours on a ring, in degrees (a little more on the tight inner ring). */
const GAP: Record<MapState, number> = { waiting: 16, working: 9, idle: 7, done: 7 };

/** A point on the map from a radius and an angle (0 at the top, clockwise). */
export function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
}

/** A note as one plain sentence: no Markdown, tables or code, no repeated ticket key. */
const plain = (text: string, key: string): string => questionLine(text.replace(new RegExp(`^${key}:?\\s*`, "gm"), ""));

const keyOf = (a: Alert): string | null =>
  a.target.kind === "ticket" || a.target.kind === "review" || a.target.kind === "held" ? a.target.key : null;

/** Agents not yet placed: the model before the spreading pass. */
export type Draft = Omit<MapAgent, "x" | "y" | "angle">;

/**
 * Spreads `items` evenly across a sector's span on one ring, keeping `gap` degrees between neighbours. When they don't
 * fit, alternate ones step in and out by a little so names don't sit on each other.
 */
function spread<T>(
  items: readonly T[],
  a0: number,
  span: number,
  r: (item: T) => number,
  gap: number,
): { item: T; r: number; angle: number }[] {
  const pad = Math.min(span * 0.12, 8);
  const room = span - pad * 2;
  const step = items.length > 1 ? room / items.length : 0;
  const tight = step < gap;
  return items.map((item, i) => ({
    item,
    angle: a0 + pad + (items.length > 1 ? step * (i + 0.5) : room / 2),
    r: tight ? r(item) + (i % 2 ? 22 : -14) : r(item),
  }));
}

/** The attention map's model from the dashboard's state and the Needs you alerts (`computeAlerts`). */
export function mapFrom(s: DashboardState, alerts: readonly Alert[], waiting: number, now: number): MapModel {
  const n = Math.max(1, s.clients.length);
  const span = 360 / n;
  const sectors: MapSector[] = s.clients.map((c, i) => ({
    name: c.name,
    a0: i * span,
    span,
    merged: s.reports.filter((r) => r.includes(`${c.prefix}-`) && /PR merged/.test(r)).length,
    broken: s.status.ci.some((k) => k.client === c.name && k.state === "fail"),
  }));

  // what waits on you, by ticket key (a review, a question in a ticket, something held)
  const asks = new Map<string, Alert>();
  for (const a of alerts) {
    const k = keyOf(a);
    if (k && !a.broken && a.sev >= 2) asks.set(k, a);
  }

  const drafts: Draft[] = [];
  s.clients.forEach((c, sector) => {
    const mine = (key: string) => key.startsWith(`${c.prefix}-`);
    for (const g of leadsIn(s.godmode, c.name)) {
      const state: MapState = g.waiting || g.open ? "waiting" : g.running ? "working" : "idle";
      drafts.push({
        id: `lead:${g.key}`,
        label: leadName(g, s.names),
        note: plain(g.waiting || g.open ? (g.inbox?.text ?? g.reason) : g.reason, g.key),
        state,
        lead: true,
        sector,
        subs: 0,
        progress: 0,
        open: { kind: "lead", key: g.key },
      });
    }
    for (const r of s.running.filter((x) => mine(x.name))) {
      const ask = asks.get(r.name);
      const session = s.sessions.find((x) => x.pid === r.pid);
      drafts.push({
        id: r.name,
        label: r.name,
        note: plain(ask?.sub || ask?.title || session?.lastAction || "", r.name),
        state: ask ? "waiting" : "working",
        lead: false,
        sector,
        subs: session?.subagents.filter((x) => x.active).length ?? 0,
        // an hour is a long run: the arc fills toward it and never quite closes
        progress: Math.min(0.95, Math.max(0.05, (now - r.startedAt) / 3_600_000)),
        open: { kind: "ticket", key: r.name },
      });
    }
    const placed = new Set(drafts.map((d) => d.id));
    for (const [key, a] of asks)
      if (mine(key) && !placed.has(key))
        drafts.push({
          id: key,
          label: key,
          note: plain(a.sub || a.title, key),
          state: "waiting",
          lead: false,
          sector,
          subs: 0,
          progress: 0,
          open: a.target.kind === "review" ? { kind: "review", key } : { kind: "ticket", key },
        });
    for (const p of s.prs.filter((x) => mine(x.key) && !placed.has(x.key) && !asks.has(x.key)))
      drafts.push({
        id: p.key,
        label: p.key,
        note: p.branch,
        state: "done",
        lead: false,
        sector,
        subs: 0,
        progress: 1,
        open: { kind: "review", key: p.key },
      });
  });

  return { waiting, sectors, ...place(sectors, drafts) };
}

/**
 * The spreading pass: each sector's agents along their rings, the quiet past `CAP` gathered into a crew, what waits on
 * you never gathered.
 */
export function place(sectors: readonly MapSector[], drafts: readonly Draft[]): Pick<MapModel, "agents" | "crews"> {
  const agents: MapAgent[] = [];
  const crews: MapCrew[] = [];
  sectors.forEach((sec, i) => {
    const here = drafts.filter((d) => d.sector === i);
    // what waits on you is never gathered; past CAP the quiet ones (then the working) go into a crew
    const asking = here.filter((d) => d.state === "waiting");
    const rest = here.filter((d) => d.state !== "waiting");
    const order: MapState[] = ["working", "idle", "done"];
    rest.sort((a, b) => Number(b.lead) - Number(a.lead) || order.indexOf(a.state) - order.indexOf(b.state));
    const keep = Math.max(0, CAP - asking.length);
    const shown = here.length > CAP ? [...asking, ...rest.slice(0, Math.max(0, keep - 1))] : here;
    const gathered = here.length > CAP ? rest.slice(Math.max(0, keep - 1)) : [];
    // idle and done share the outer ring's band (a few units apart), so they spread as one row and never stack
    for (const band of [["waiting"], ["working"], ["idle", "done"]] as MapState[][]) {
      const ring = shown.filter((d) => band.includes(d.state));
      // the crew takes the end of the working ring, so leave it a slot
      const slots = band[0] === "working" && gathered.length ? [...ring, null] : ring;
      for (const p of spread(slots, sec.a0, sec.span, (d) => RING[d?.state ?? "working"], GAP[band[0] ?? "idle"])) {
        const [x, y] = polar(p.r, p.angle);
        if (p.item) agents.push({ ...p.item, x, y, angle: p.angle });
        else
          crews.push({
            id: `crew:${sec.name}`,
            sector: i,
            project: sec.name,
            count: gathered.length,
            working: gathered.filter((d) => d.state === "working").length,
            quiet: gathered.filter((d) => d.state !== "working").length,
            x,
            y,
            angle: p.angle,
          });
      }
    }
  });
  return { agents, crews };
}

/** Each state's ring band: [inner, outer] radius. */
const BAND: Record<MapState, [number, number]> = { waiting: [R.r0, R.r1], working: [R.r1, R.r2], idle: [R.r2, R.r3], done: [R.r2, R.r3] };

/**
 * Pushes apart agents closer than `min` map units (their tap targets at the drawn size), off any crew, and out of each
 * `keep` disc (you and your name), each staying inside its own ring band (`body` clear of its edges) and its own
 * project's sector. Where a sector is too full to fit them all it gets as close as the room allows. Run after `place`,
 * once the drawn size is known.
 */
export function separate(m: MapModel, min: number, body: number, keep: readonly { x: number; y: number; r: number }[] = []): MapModel {
  const pts = m.agents.map((a) => ({ a, x: a.x, y: a.y, r: min }));
  const bound = (p: (typeof pts)[number]) => {
    const sec = m.sectors[p.a.sector];
    const [lo, hi] = BAND[p.a.state];
    const r = Math.min(Math.max(Math.hypot(p.x, p.y), Math.min(lo + body, (lo + hi) / 2)), Math.max(hi - body, (lo + hi) / 2));
    let deg = (Math.atan2(p.y, p.x) * 180) / Math.PI + 90;
    if (sec) {
      const mid = sec.a0 + sec.span / 2;
      const edge = Math.max(0, sec.span / 2 - 2);
      deg = mid + Math.min(edge, Math.max(-edge, ((((deg - mid) % 360) + 540) % 360) - 180));
    }
    [p.x, p.y] = polar(r, deg);
  };
  // crews and kept spots never move: built once, not on every pass and agent (the Team view draws 20 maps at once)
  const fixed = [...m.crews.map((c) => ({ a: null, x: c.x, y: c.y, r: min })), ...keep.map((o) => ({ a: null, ...o }))];
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p) continue;
      for (let j = i + 1; j < pts.length + fixed.length; j++) {
        const q = j < pts.length ? pts[j] : fixed[j - pts.length];
        if (!q) continue;
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const d = Math.hypot(dx, dy);
        if (d >= q.r) continue;
        // two on the same spot part sideways, along the ring
        const [ux, uy] = d > 0.01 ? [dx / d, dy / d] : [-p.y / (Math.hypot(p.x, p.y) || 1), p.x / (Math.hypot(p.x, p.y) || 1)];
        const push = q.a ? (q.r - d) / 2 : q.r - d;
        p.x += ux * push;
        p.y += uy * push;
        if (q.a) {
          q.x -= ux * push;
          q.y -= uy * push;
        }
        moved = true;
      }
    }
    for (const p of pts) bound(p);
    if (!moved) break;
  }
  return {
    ...m,
    agents: pts.map(({ a, x, y }) => ({ ...a, x, y, angle: ((((Math.atan2(y, x) * 180) / Math.PI + 90) % 360) + 360) % 360 })),
  };
}

/** One project as a teammate's presence reports it, for their hub. */
export interface HubProject {
  name: string;
  state: "needs" | "working" | "idle" | "red";
  agents: number;
}

/**
 * A person's hub on the Team view: their own small attention map, one object per project in the ring its state puts it
 * in (a red project works on, under a crimson name). `waiting` is their count of what waits on them.
 */
export function hubModel(projects: readonly HubProject[]): MapModel {
  const span = 360 / Math.max(1, projects.length);
  const sectors: MapSector[] = projects.map((p, i) => ({ name: p.name, a0: i * span, span, merged: 0, broken: p.state === "red" }));
  const drafts: Draft[] = projects.map((p, sector) => ({
    id: p.name,
    label: p.name,
    note: "",
    state: p.state === "needs" ? "waiting" : p.state === "idle" ? "idle" : "working",
    lead: false,
    sector,
    subs: Math.min(3, Math.max(0, p.agents - 1)),
    progress: 0,
    open: { kind: "crew", project: p.name },
  }));
  return { waiting: projects.filter((p) => p.state === "needs").length, sectors, ...place(sectors, drafts) };
}

/** Where a name sits: its anchor point in map units, how the text hangs off it, and whether a leader line reaches it. */
export interface LabelSpot {
  x: number;
  /** The box's vertical centre. */
  y: number;
  anchor: "start" | "middle" | "end";
  leader: boolean;
}

/** What a label is placed round: an object on the map, and whether its name must always show. */
export interface LabelItem {
  id: string;
  x: number;
  y: number;
  text: string;
  named: boolean;
}

/** A label's box in map units: [x0, y0, x1, y1]. */
type Box = [number, number, number, number];

/** Directions to try, as turns away from straight out from you (degrees), nearest first. */
const TURNS = [0, 28, -28, 56, -56, 90, -90, 125, -125];
/** Distances from the object's centre to try, in CSS px; past `LEADER` the name gets a leader line. */
const REACH = [19, 27, 38, 52, 70, 92];
const LEADER = 30;

/**
 * Collision-free places for the names that must always show (what waits on you): each tries straight out from you
 * first, then turns either way and steps further out (with a leader line past a short reach), never over another name,
 * any object on the map, you, or the map's edge. Monospace names make the width exact: `size` px per line, 0.6 em per
 * character. A name with nowhere to go gets `null`; the map shows it on hover or focus instead, and the object itself
 * keeps the one colour, so what waits on you never goes unmarked.
 */
export function placeLabels(items: readonly LabelItem[], k: number, size = 12): Map<string, LabelSpot | null> {
  const out = new Map<string, LabelSpot | null>();
  const body = 15 * k;
  const pad = 5 * k;
  const you = youAt(k);
  const h = size * 1.3 * k;
  const placed: Box[] = [];
  const hits = (b: Box) =>
    b[0] < -496 ||
    b[2] > 496 ||
    b[1] < -496 ||
    b[3] > 496 ||
    // you, the rim that points at what waits on you, and your name under it
    boxDisc(b, 0, 0, you.rim + 4 * k) ||
    (b[0] < you.name[2] && b[2] > you.name[0] && b[1] < you.name[3] && b[3] > you.name[1]) ||
    items.some((o) => boxDisc(b, o.x, o.y, body)) ||
    placed.some((p) => b[0] < p[2] + pad && b[2] > p[0] - pad && b[1] < p[3] + pad && b[3] > p[1] - pad);
  // what's crowded first: a name with neighbours close by has fewer places to go
  const named = items
    .filter((i) => i.named)
    .map((i) => ({ i, near: items.filter((o) => o !== i && Math.hypot(o.x - i.x, o.y - i.y) < 70 * k).length }))
    .sort((a, b) => b.near - a.near)
    .map((x) => x.i);
  for (const it of named) {
    const w = it.text.length * 0.6 * size * k;
    const out0 = Math.atan2(it.y, it.x);
    let spot: LabelSpot | null = null;
    for (const reach of REACH) {
      for (const turn of TURNS) {
        const a = out0 + (turn * Math.PI) / 180;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        const x = it.x + dx * reach * k;
        const y = it.y + dy * reach * k;
        const anchor = dx > 0.38 ? "start" : dx < -0.38 ? "end" : "middle";
        const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
        // straight above or below, the box hangs off the point; to either side it centres on it
        const cy = anchor === "middle" ? y + Math.sign(dy) * (h / 2) : y;
        const b: Box = [x0, cy - h / 2, x0 + w, cy + h / 2];
        if (hits(b)) continue;
        placed.push(b);
        spot = { x, y: cy, anchor, leader: reach > LEADER };
        break;
      }
      if (spot) break;
    }
    out.set(it.id, spot);
  }
  return out;
}

/** Whether a box overlaps a disc. */
function boxDisc(b: Box, cx: number, cy: number, r: number): boolean {
  const nx = Math.max(b[0], Math.min(cx, b[2]));
  const ny = Math.max(b[1], Math.min(cy, b[3]));
  return Math.hypot(nx - cx, ny - cy) < r;
}

/** A short fingerprint of a model, so the map redraws only when something it shows has changed. */
export function signature(m: MapModel): string {
  return JSON.stringify([
    m.waiting,
    m.sectors.map((s) => [s.name, s.merged, s.broken]),
    m.agents.map((a) => [a.id, a.state, a.subs, Math.round(a.progress * 20), a.note]),
    m.crews.map((c) => [c.id, c.count, c.working]),
  ]);
}
