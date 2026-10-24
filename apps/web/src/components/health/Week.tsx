import type { Model } from "@/app/data";
import { useWords } from "@/app/theme";
import { Pane } from "../Pane";

/** The week in numbers: agent PRs and first-try success. Merges are in Work, the money in Spend. */
export function Week({ m }: { m: Model }) {
  const w = useWords();
  const wk = m.s.week;
  const rate = wk.successRate === null ? "–" : `${Math.round(wk.successRate * 100)}%`;
  return (
    <Pane title="paneWeek">
      <dl className="grid grid-cols-2 gap-2">
        {(
          [
            [wk.opened, w.weekPrs],
            [rate, w.weekSuccess],
          ] as const
        ).map(([n, label]) => (
          <div key={label} className="flex flex-col-reverse">
            <dt className="mt-1 text-xs text-muted-foreground">{label}</dt>
            <dd className="readout hud-glow text-3xl leading-none font-semibold">{n}</dd>
          </div>
        ))}
      </dl>
    </Pane>
  );
}
