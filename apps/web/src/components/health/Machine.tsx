import type { DashboardState } from "@overhand/contract";
import type { Words } from "@overhand/themes";
import { useActions } from "@/app/actions";
import type { Model } from "@/app/data";
import { useWords } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { ago, fmt, hm } from "@/lib/format";
import { Dot, Muted, Pane } from "../Pane";

type Strain = DashboardState["governor"]["strain"];
type Gauge = Strain["gauges"][number];

const TONE = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)" } as const;
const pct = (x: number) => Math.round(x * 100);
const mb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`);

/** One gauge as a sentence: "Your laptop is working at 9× its capacity." */
function gaugeLine(g: Gauge, w: Words): string {
  if (g.what === "cpu")
    return g.value >= 1 ? fmt(w.strainCpuOver, { x: Math.round(g.value * 10) / 10 }) : fmt(w.strainCpu, { pct: pct(g.value) });
  if (g.what === "mem") return fmt(g.level === "ok" ? w.strainMem : w.strainMemTight, { pct: pct(g.value) });
  if (g.what === "disk") return fmt(w.strainDisk, { gb: g.value.toFixed(1) });
  if (g.what === "battery") return fmt(w.strainBattery, { pct: g.value });
  return w.strainHeat;
}

/**
 * The last 3 hours of processor load as one thin line against full capacity (the dashed 1×), with each red sample's
 * cause on a marker you can hover. Single series: the title names it, no legend.
 */
function History({ s }: { s: Strain }) {
  const w = useWords();
  const pts = s.history;
  if (pts.length < 2) return null;
  const W = 300;
  const H = 48;
  const top = Math.max(2, ...pts.map((p) => p.cpu));
  const t0 = pts[0]?.at ?? 0;
  const span = Math.max(1, (pts.at(-1)?.at ?? t0) - t0);
  const x = (at: number) => ((at - t0) / span) * W;
  const y = (v: number) => H - 2 - (v / top) * (H - 4);
  const spikes = pts.filter((p) => p.cause);
  return (
    <figure className="grid gap-1">
      <figcaption className="text-xs text-muted-foreground">{w.strainHistory}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-full overflow-visible" role="img" aria-label={w.strainHistory}>
        <line x1={0} x2={W} y1={y(1)} y2={y(1)} stroke="var(--border)" strokeDasharray="3 3" strokeWidth={1} />
        <polyline
          points={pts.map((p) => `${x(p.at).toFixed(1)},${y(p.cpu).toFixed(1)}`).join(" ")}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {spikes.map((p) => (
          <circle key={p.at} cx={x(p.at)} cy={y(p.cpu)} r={4} fill="var(--bad)" stroke="var(--card)" strokeWidth={2}>
            <title>{fmt(w.strainSpike, { time: hm(p.at), x: Math.round(p.cpu * 10) / 10, cause: p.cause })}</title>
          </circle>
        ))}
      </svg>
      {spikes.length ? (
        <ul className="grid gap-0.5 text-xs text-muted-foreground">
          {spikes.slice(-3).map((p) => (
            <li key={p.at}>{fmt(w.strainSpike, { time: hm(p.at), x: Math.round(p.cpu * 10) / 10, cause: p.cause })}</li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}

/**
 * This machine as the governor sees it: how hard it works (processor, memory, disk, and the battery and heat when they
 * matter) in plain sentences, the last 3 hours with spikes named by cause, who's using it while it's strained (by agent
 * session; your own apps only as one total), quiet mode, why heavy jobs would wait, and the heavy jobs holding a slot.
 */
export function Machine({ m }: { m: Model }) {
  const w = useWords();
  const { run } = useActions();
  const g = m.s.governor;
  const s = g.strain;
  const quiet = g.quietUntil > Date.now();
  return (
    <Pane title="paneMachine" count={g.jobs.length}>
      <div className="grid gap-2 text-sm">
        <ul className="grid gap-1">
          {s.gauges.map((x) => (
            <li key={x.what} className="flex items-center gap-2">
              <Dot color={TONE[x.level]} />
              <span>{gaugeLine(x, w)}</span>
              {x.what === "disk" ? (
                <Button variant="outline" size="sm" className="ml-auto" onClick={() => run({ name: "sweep" })}>
                  {w.machineFindSpace}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <History s={s} />
        {s.groups.length ? (
          <div className="grid gap-1">
            <p className="text-xs text-muted-foreground">{w.strainWho}</p>
            <ul className="grid gap-1 text-xs">
              {[...s.groups, { label: w.strainOther, ...s.other }].map((x) => (
                <li key={x.label} className="flex min-w-0 gap-2">
                  <span className="truncate">{x.label}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                    {fmt(w.strainShare, { cpu: pct(x.cpu), mem: mb(x.memMb) })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {quiet ? (
          <p className="text-xs text-(--warn)">{fmt(w.machineQuiet, { time: hm(g.quietUntil) })}</p>
        ) : g.holding ? (
          <p className="text-xs text-(--warn)">{fmt(w.machineHolding, { why: g.holding })}</p>
        ) : null}
        {!g.jobs.length ? (
          <Muted>{w.machineNoJobs}</Muted>
        ) : (
          <ul className="grid gap-1.5">
            {g.jobs.map((j) => (
              <li key={`${j.kind}-${j.since}`} className="grid gap-0.5 border-t border-border pt-1.5 text-xs first:border-0 first:pt-0">
                <code className="line-clamp-1 font-mono [overflow-wrap:anywhere]" title={j.cmd}>
                  {j.cmd}
                </code>
                <span className="text-muted-foreground">{[j.kind, j.run, ago(j.since)].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Pane>
  );
}
