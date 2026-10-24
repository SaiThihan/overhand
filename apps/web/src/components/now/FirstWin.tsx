import { useActions } from "@/app/actions";
import type { Model } from "@/app/data";
import { useWords } from "@/app/theme";
import { useUi } from "@/app/ui";
import { Button } from "@/components/ui/button";
import { fmt } from "@/lib/format";
import { Checkup } from "../Checkup";
import { Dot, Muted, Pane } from "../Pane";

/**
 * "Your first win": the one small safe task Overhand picked from your repos right after setup, with where it stands
 * (looking, starting, an agent on it for n minutes, the PR) and the one thing to do next. Gone a few days after it ends.
 */
export function FirstWin({ m }: { m: Model }) {
  const w = useWords();
  const ui = useUi();
  const { run } = useActions();
  const win = m.s.firstWin;
  if (!win) return null;
  const live = m.s.running.find((r) => r.name === win.key);
  const minutes = live ? Math.max(1, Math.round((m.s.now - live.startedAt) / 60_000)) : 0;
  const tracked = m.s.prs.some((p) => p.key === win.key);
  const line = {
    looking: w.winLooking,
    queued: m.s.paused ? w.winWaiting : w.winQueued,
    running: minutes ? fmt(w.winRunningFor, { n: minutes }) : w.winRunning,
    pr: w.winPr,
    report: w.winReport,
    failed: w.winFailed,
    none: fmt(w.winNone, { label: m.s.labels.queue }),
  }[win.state];
  return (
    <Pane title="paneFirstWin">
      {/* the pane's body is one block: the status, the check-up and the next step need their own gap */}
      <div className="grid gap-3">
        <div className="grid gap-1.5" aria-live="polite">
          {win.title ? (
            <p className="flex items-baseline gap-2 text-sm font-medium text-foreground [overflow-wrap:anywhere]">
              {win.state === "running" ? <Dot color="var(--primary)" on /> : null}
              {win.title}
            </p>
          ) : null}
          {win.repo ? <p className="text-xs text-muted-foreground">{fmt(w.winWhere, { project: win.project, repo: win.repo })}</p> : null}
          <Muted>{line}</Muted>
          {/* what the agent did and how it proved it (its summary), a watch project's report, or why it failed */}
          {win.message && ["pr", "report", "failed"].includes(win.state) ? (
            <p className="line-clamp-4 text-sm [overflow-wrap:anywhere]">{win.message}</p>
          ) : null}
        </div>
        {/* once it's settled, the rest of the check-up: what else an agent could take, one click each */}
        {["pr", "report", "failed", "none"].includes(win.state) ? <Checkup only={win.repo || undefined} tasksOnly limit={3} /> : null}
        {win.state === "pr" ? (
          <div className="flex justify-end">
            {tracked ? (
              <Button size="sm" onClick={() => ui.openDrawer({ kind: "review", key: win.key })}>
                {w.review}
              </Button>
            ) : (
              <Button size="sm" asChild>
                <a href={win.url} target="_blank" rel="noopener noreferrer">
                  {w.openPr}
                </a>
              </Button>
            )}
          </div>
        ) : win.state === "none" ? (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => void run({ name: "plan" })}>
              {w.planDay}
            </Button>
          </div>
        ) : null}
      </div>
    </Pane>
  );
}
