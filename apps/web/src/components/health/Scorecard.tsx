import { comboLabel, isBilled, type ScoreRow } from "@overhand/contract";
import { useState } from "react";
import type { Model } from "@/app/data";
import { Term, useWords } from "@/app/theme";
import { useUi } from "@/app/ui";
import { Button, Choice } from "@/components/ui/button";
import { fmt, money, pct, times } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Muted, Pane } from "../Pane";

/** "40 min", "11 h", "3 days": time to merge, as rough as it's useful. */
const hours = (min: number) =>
  min < 60 ? `${Math.round(min)} min` : min < 48 * 60 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} days`;

/** Merges per day as a thin line; the row's text says the same in words. */
function Spark({ daily, best }: { daily: number[]; best: boolean }) {
  const max = Math.max(1, ...daily);
  const step = 80 / Math.max(1, daily.length - 1);
  const points = daily.map((n, i) => `${(i * step).toFixed(1)},${(17 - (n / max) * 15).toFixed(1)}`).join(" ");
  return (
    <svg
      viewBox="0 0 80 18"
      className={cn("hidden h-4.5 w-20 shrink-0 sm:block", best ? "text-primary" : "text-muted-foreground")}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** One agent CLI × model: merge rate as the readout, the counts and why the rest didn't land beneath. */
function Row({ r, best }: { r: ScoreRow; best: boolean }) {
  const w = useWords();
  const missed = [
    [r.failures.noPr, w.scoreNoPr],
    [r.failures.failed, w.scoreFailed],
    [r.failures.timeout, w.scoreTimeout],
    [r.failures.closed, w.scoreClosed],
  ] as const;
  const reasons = missed
    .filter(([n]) => n)
    .map(([n, word]) => fmt(word, { n }))
    .join(", ");
  return (
    <li className={cn("grid grid-cols-[1fr_auto] items-center gap-x-3 py-2", r.few && "opacity-70")}>
      <div className="min-w-0">
        <b className={cn("block truncate text-sm font-medium", best && "text-primary")}>
          {comboLabel(r.combo)}
          {best ? <span className="ml-1.5 text-xs font-normal">{w.scoreBest}</span> : null}
        </b>
        <p className="text-xs text-muted-foreground">
          {r.few ? (
            fmt(w.scoreFew, { n: r.runs })
          ) : (
            <>
              {fmt(w.scoreLine, { runs: r.runs, prs: r.prs, merged: r.merged, first: r.firstTry })}
              {r.mergeMin !== null ? <> · {fmt(w.scoreMergeTime, { t: hours(r.mergeMin) })}</> : null}
              {r.costPerMerge !== null ? (
                <>
                  {" "}
                  ·{" "}
                  {r.billings.some(isBilled)
                    ? `${fmt(w.scoreBilledPerMerge, { cost: money(r.billedPerMerge ?? 0) })} · `
                    : r.billings.includes("plan")
                      ? `${w.scoreInPlan} · `
                      : ""}
                  {fmt(w.scoreApiPerMerge, { cost: money(r.costPerMerge) })}
                </>
              ) : null}
            </>
          )}
        </p>
        {!r.few && reasons ? <p className="text-xs text-muted-foreground">{fmt(w.scoreMissed, { reasons })}</p> : null}
      </div>
      <div className="flex items-center gap-3">
        {r.few ? null : <Spark daily={r.daily} best={best} />}
        <div className="flex w-14 flex-col items-end">
          <span className={cn("readout text-2xl leading-none font-semibold", best && "hud-glow text-primary")}>
            {r.few ? "–" : pct(r.mergeRate)}
          </span>
          <span className="text-[11px] text-muted-foreground">{w.scoreRate}</span>
        </div>
      </div>
    </li>
  );
}

/** Which agent CLI and model lands work best, overall and per project, over 7 or 30 days; and what routing does with it. */
export function Scorecard({ m, className }: { m: Model; className?: string }) {
  const w = useWords();
  const ui = useUi();
  const [days, setDays] = useState<7 | 30>(30);
  const [project, setProject] = useState("");
  const card = days === 7 ? m.s.scorecard.week : m.s.scorecard.month;
  const shown = card.projects.find((p) => p.project === project);
  const rows = shown ? shown.rows : card.overall;
  const best = shown ? shown.best : rows[0] && !rows[0].few && rows[0].merged ? rows[0].combo : null;
  const routing = m.s.routing;
  return (
    <Pane
      title="paneScorecard"
      className={className}
      extra={
        <div className="flex gap-1">
          <Choice on={days === 7} onClick={() => setDays(7)}>
            {w.scoreWeek}
          </Choice>
          <Choice on={days === 30} onClick={() => setDays(30)}>
            {w.scoreMonth}
          </Choice>
        </div>
      }
    >
      {card.projects.length > 1 ? (
        <div className="mb-1 flex flex-wrap gap-1">
          <Choice on={!shown} onClick={() => setProject("")}>
            {w.scoreAll}
          </Choice>
          {card.projects.map((p) => (
            <Choice key={p.project} on={shown?.project === p.project} onClick={() => setProject(p.project)}>
              {p.project}
            </Choice>
          ))}
        </div>
      ) : null}
      {rows.length ? (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <Row key={r.combo} r={r} best={r.combo === best} />
          ))}
        </ul>
      ) : (
        <Muted className="py-2 text-sm">{w.scoreEmpty}</Muted>
      )}
      {routing.suggestions
        .filter((s) => !shown || s.project === shown.project)
        .map((s) => (
          <div key={s.project} className="mt-2 flex items-baseline justify-between gap-2 border-l-2 border-warn pl-2 text-xs">
            <span>{fmt(w.alRouteSuggest, { to: comboLabel(s.to), x: times(s.toRate, s.fromRate), project: s.project })}</span>
            {/* a quiet action on its line's baseline, its label ending on the pane's edge with the rates above it */}
            <Button
              variant="ghost"
              size="xs"
              className="-mr-2 shrink-0"
              onClick={() => ui.openDrawer({ kind: "settings", tab: "projects", project: s.project })}
            >
              {w.scoreSwitch}
            </Button>
          </div>
        ))}
      {/* Share sits down here, not in the header: up there it crowded the title on a phone, and it shares the week
          whichever span the card shows */}
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <Muted className="text-xs">
          {routing.mode === "auto" ? w.routingAuto : routing.mode === "suggest" ? w.routingSuggest : w.routingOff}
        </Muted>
        <Button variant="ghost" size="xs" className="-mr-2 shrink-0" onClick={() => ui.openDrawer({ kind: "share", span: "week" })}>
          <Term k="share" />
        </Button>
      </div>
    </Pane>
  );
}
