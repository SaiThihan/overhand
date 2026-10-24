/**
 * Instrument, the default world: a field of light, no characters. In the dark each agent is a precise point of light
 * in a hairline ring (a rounded square for a lead) with a soft halo and a thin progress arc; on paper, a small lit
 * object with a shadow. A faint lattice of points lies under the map, felt more than seen. You are the logo's square:
 * paper while nothing waits, the one orange with your count (and a soft halo) when something does.
 */
import { type MapAgent, polar, R, youAt } from "../model";
import { dots, hash, type World, type WorldCtx } from "../world";

/** The signal light's colour for a state: what needs you is the one colour; working is light; done is green. */
export const LIGHT: Record<MapAgent["state"], string> = {
  waiting: "var(--you-fill)",
  working: "var(--ink-12)",
  idle: "var(--ink-8)",
  done: "var(--ok)",
};

/** An arc of radius `r` from `a0` to `a1` degrees (0 at the top, clockwise); `rev` runs it the other way, for text. */
export function arcD(r: number, a0: number, a1: number, rev = false): string {
  const [x0, y0] = polar(r, rev ? a1 : a0);
  const [x1, y1] = polar(r, rev ? a0 : a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${rev ? 0 : 1} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** The count of what waits on you as a badge on your centre's rim (the themes' centres); nothing when it's zero. */
export function Badge({ c }: { c: WorldCtx }) {
  const n = c.model.waiting;
  if (!n) return null;
  const at = R.you * 0.72;
  return (
    <g className="you-badge">
      <circle cx={at} cy={-at} r={15} className="you-count-bg" />
      <text x={at} y={-at} dy="0.36em" textAnchor="middle" className="you-count" style={{ fontSize: 15 }}>
        {n}
      </text>
    </g>
  );
}

/** Your name under the centre, clear of the rim that points at what waits on you. */
export function YouName({ c }: { c: WorldCtx }) {
  const me = youAt(c.k);
  return (
    <text className="you-label" textAnchor="middle" y={me.nameY} style={{ fontSize: me.nameSize }}>
      {c.you}
    </text>
  );
}

/** The lattice under the map: a point every 36 units, about half lit, fading from the centre, as a few paths. */
function lattice(): { d: string; o: number }[] {
  const buckets: [number, number, number][][] = [[], [], [], []];
  for (let x = -540; x <= 540; x += 36)
    for (let y = -540; y <= 540; y += 36) {
      const h = hash(x * 7 + y * 13);
      if (h < 0.5) continue;
      const d = Math.hypot(x, y);
      buckets[h > 0.97 ? 3 : Math.min(2, Math.floor(d / 260))]?.push([x, y, h > 0.97 ? 1.6 : 0.9]);
    }
  return buckets.map((b, i) => ({ d: dots(b), o: [0.28, 0.2, 0.12, 0.42][i] ?? 0.1 }));
}
const LATTICE = lattice();

export const instrument: World = {
  id: "instrument",
  rings: "line",
  ticks: true,
  links: "pulse",
  atlas: (c) => (
    <>
      <radialGradient id={`${c.id}obj`} cx="0.35" cy="0.28" r="0.9">
        {c.light ? (
          <>
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.65" stopColor="var(--ink-2)" />
            <stop offset="1" stopColor="var(--ink-6)" />
          </>
        ) : (
          <>
            <stop offset="0" stopColor="var(--ink-7)" />
            <stop offset="0.6" stopColor="var(--ink-4)" />
            <stop offset="1" stopColor="var(--ink-1)" />
          </>
        )}
      </radialGradient>
      <radialGradient id={`${c.id}youhalo`} r="0.5">
        <stop offset="0" stopColor="var(--you-fill)" stopOpacity={c.light ? 0.3 : 0.26} />
        <stop offset="1" stopColor="var(--you-fill)" stopOpacity="0" />
      </radialGradient>
    </>
  ),
  ground: (c) =>
    c.light ? (
      <>
        {/* the pool fades out inside the map's own layer, so cool paper shows no edge */}
        <circle r={R.r3 + 90} fill={`url(#${c.id}poolL)`} />
        {/* embossed rings: a white line just under each ring line */}
        {[R.r0, R.r1, R.r2, R.r3].map((r) => (
          <circle key={r} cy={1.2} r={r} className="emboss" />
        ))}
      </>
    ) : (
      <>
        {/* the lattice is felt on a full map; a small one (a phone, a teammate's hub) goes without */}
        {c.lod === "full" ? (
          <g className="lattice">
            {LATTICE.map((l) => (
              <path key={l.o} d={l.d} opacity={l.o} />
            ))}
          </g>
        ) : null}
        <circle r={R.r3 + 60} fill={`url(#${c.id}pool)`} />
        <circle r={(R.r1 + R.r2) / 2} fill="none" stroke="var(--ink-12)" strokeOpacity={0.03} strokeWidth={R.r2 - R.r1} />
      </>
    ),
  centre: (c) => {
    // your square grows on a small map so the count stays readable on a phone
    const r = youAt(c.k).r;
    const h = r * 0.72;
    const n = c.model.waiting;
    return (
      <g className="you">
        {n ? <circle r={r * 2.1} fill={`url(#${c.id}youhalo)`} /> : null}
        <rect x={-h} y={-h + 4} width={h * 2} height={h * 2} rx={6} className="shadow" opacity={c.light ? 0.35 : 0.8} />
        <rect x={-h} y={-h} width={h * 2} height={h * 2} rx={6} className={n ? "you-mark on" : "you-mark"} />
        <text textAnchor="middle" dy="0.36em" className={n ? "you-num mark-on" : "you-num"} style={{ fontSize: Math.max(27, 13 * c.k) }}>
          {n}
        </text>
        <YouName c={c} />
      </g>
    );
  },
  character: (a, c) => {
    const r = c.u * 0.26;
    const st = a.state;
    const lc = st === "idle" ? "var(--ink-8)" : LIGHT[st];
    const ar = r * 1.55;
    // on paper a small lit object; in the dark a smoked-glass ring round the light
    const body = c.light
      ? { fill: `url(#${c.id}obj)`, style: { stroke: "var(--ink-7)", strokeOpacity: 1 } }
      : { fill: "var(--ink-1)", fillOpacity: 0.6 };
    return (
      <>
        {c.light ? <ellipse cy={r * 0.9} rx={r * 0.95} ry={r * 0.28} className="shadow" opacity={0.7} /> : null}
        {/* the halo: a point of light in the dark */}
        {/* how bright: working lights brighten as the real hour gets dark, what waits on you stays lit, done rests (map.css) */}
        {!c.light && st !== "idle" ? <circle r={r * 2.8} fill={`url(#${c.id}h-${st})`} className={`halo halo-${st}`} /> : null}
        {c.light && st === "working" ? <circle r={r * 2.8} fill={`url(#${c.id}h-hour)`} className="halo halo-working" /> : null}
        {a.lead ? (
          <rect className="obj" x={-r} y={-r} width={2 * r} height={2 * r} rx={r * 0.38} {...body} />
        ) : (
          <circle className="obj" r={r} {...body} />
        )}
        {c.light ? <path className="spec" d={`M${-r * 0.7} ${-r * 0.45} A${r * 0.85} ${r * 0.85} 0 0 1 ${r * 0.2} ${-r * 0.82}`} /> : null}
        {st === "working" || st === "waiting" ? (
          <>
            <circle r={ar} className="track" />
            <circle
              r={ar}
              className={st === "waiting" ? "prog you" : "prog"}
              pathLength={100}
              strokeDasharray={`${Math.round(Math.max(0.12, a.progress) * 100)} 100`}
              transform="rotate(-90)"
            />
          </>
        ) : null}
        {st === "working" ? <circle r={ar} className="scanarc" pathLength={100} /> : null}
        {st === "waiting" ? <circle className="breathe-ring" r={r * 1.9} /> : null}
        {st === "done" ? <circle className="done-ring" r={ar} pathLength={100} /> : null}
        {st !== "idle" && !(c.light && st === "working") ? <circle r={r * 0.9} fill={`url(#${c.id}h-${st})`} /> : null}
        <circle className="light" r={r * (st === "idle" ? 0.22 : 0.38)} fill={lc} />
        {!c.light && st !== "idle" ? <circle r={r * 0.16} fill="#ffffff" opacity={0.9} /> : null}
      </>
    );
  },
  orbit: (_a, i, c) => polar(c.u * 0.78, -55 + i * 38),
  companion: (_a, _i, c) => <circle r={c.u * 0.09} className="companion" />,
};
