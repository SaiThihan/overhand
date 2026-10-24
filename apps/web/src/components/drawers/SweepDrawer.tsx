import { CLEANUP_CATEGORIES, type CleanupCategory, type CleanupItem, CleanupStatusSchema, ownData } from "@overhand/contract";
import type { WordKey } from "@overhand/themes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { STATE_KEY } from "@/app/data";
import { Named, useWords } from "@/app/theme";
import { useUi } from "@/app/ui";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { get, post } from "@/lib/api";
import { ago, fmt, size } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DrawerHead } from "./DrawerHost";

const LABELS: Record<CleanupCategory, [WordKey, WordKey]> = {
  worktrees: ["sweepCatWorktrees", "sweepCatWorktreesHint"],
  versions: ["sweepCatVersions", "sweepCatVersionsHint"],
  caches: ["sweepCatCaches", "sweepCatCachesHint"],
  builds: ["sweepCatBuilds", "sweepCatBuildsHint"],
  clones: ["sweepCatClones", "sweepCatClonesHint"],
  history: ["sweepCatHistory", "sweepCatHistoryHint"],
  models: ["sweepCatModels", "sweepCatModelsHint"],
  tools: ["sweepCatTools", "sweepCatToolsHint"],
  temp: ["sweepCatTemp", "sweepCatTempHint"],
  docker: ["sweepCatDocker", "sweepCatDockerHint"],
  simulators: ["sweepCatSimulators", "sweepCatSimulatorsHint"],
  logs: ["sweepCatLogs", "sweepCatLogsHint"],
};
const SCHEDULES: ["off" | "weekly" | "daily", WordKey][] = [
  ["off", "sweepAutoOff"],
  ["weekly", "sweepAutoWeekly"],
  ["daily", "sweepAutoDaily"],
];
const CLEANUP_KEY = ["cleanup"] as const;
const Ok = z.object({});
const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

/**
 * Disk cleanup. Opening it starts a scan when there's no fresh plan; the drawer then lists what would go by category,
 * each with its switch, and removes only the ticked items when you press the button. Polls while a scan or cleanup runs.
 */
export function SweepDrawer() {
  const w = useWords();
  const ui = useUi();
  const qc = useQueryClient();
  const { data: st } = useQuery({
    queryKey: CLEANUP_KEY,
    queryFn: () => get("/api/cleanup", CleanupStatusSchema),
    refetchInterval: (q) => (q.state.data?.status === "planning" || q.state.data?.status === "running" ? 2000 : false),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: CLEANUP_KEY });
  const fail = (e: Error) => toast(e.message);

  // a plan older than ten minutes is rescanned on open: the low-disk alert opens this and expects today's picture
  const started = useRef(false);
  useEffect(() => {
    if (!st || started.current) return;
    started.current = true;
    const stale = st.status === "ready" && Date.now() - st.at > 600_000;
    if (st.status === "idle" || st.status === "done" || st.status === "error" || stale)
      void post("/api/cleanup/plan", {}, Ok).then(refresh, fail);
  });
  const prev = useRef(st?.status);
  useEffect(() => {
    if (prev.current === "running" && st?.status === "done") {
      toast(fmt(w.saidFreed, { size: size(st.result?.freedKb ?? 0) }));
      void qc.invalidateQueries({ queryKey: STATE_KEY });
    }
    prev.current = st?.status;
  }, [st, qc, w]);

  // the ticks start from each item's default, once per plan
  const items = st?.items ?? [];
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const planAt = st?.status === "ready" ? st.at : 0;
  useEffect(() => {
    if (planAt) setPicked(new Set((st?.items ?? []).filter((i) => i.checked).map((i) => i.id)));
  }, [planAt, st?.items]);

  const cats = st?.config?.categories;
  const on = (c: CleanupCategory) => cats?.[c]?.enabled ?? false;
  const chosen = items.filter((i) => picked.has(i.id) && on(i.category));
  const total = chosen.reduce((n, i) => n + i.kb, 0);
  const flip = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // ticking something of yours (your own checkout, an agent's history, a model, a CLI) asks first, naming the path;
  // the run sends it
  const toggle = async (id: string) => {
    const it = items.find((i) => i.id === id);
    if (it?.personal && !picked.has(id)) {
      const ask = ownData(it)
        ? { title: w.confirmOwnTitle, body: fmt(w.confirmOwn, { path: home(it.path), why: it.why }), go: w.confirmMineGo }
        : { title: w.confirmMineTitle, body: fmt(w.confirmMine, { path: home(it.path) }), go: w.confirmMineGo };
      if (!(await ui.confirm(ask))) return;
    }
    flip(id);
  };
  const saveSwitches = (body: object) => void post("/api/cleanup/config", body, Ok).then(refresh, fail);

  let body: ReactNode = <SkeletonRows label={w.loading} rows={5} />;
  if (st?.status === "planning" || st?.status === "idle") body = <p className="text-sm text-muted-foreground">{w.sweepPlanning}</p>;
  else if (st?.status === "running") {
    const p = st.progress ?? { done: 0, total: items.filter((i) => i.checked).length };
    body = (
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">{fmt(w.sweepRunning, { done: p.done, n: p.total })}</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={p.done} aria-valuemax={p.total}>
          <div className="h-full bg-primary transition-[width]" style={{ width: `${p.total ? (100 * p.done) / p.total : 0}%` }} />
        </div>
      </div>
    );
  } else if (st?.status === "error") body = <p className="text-sm">{fmt(w.sweepError, { error: st.error ?? "unknown" })}</p>;
  else if (st?.status === "done") {
    const r = st.result;
    body = (
      <div className="grid gap-3">
        <p className="text-sm">{fmt(st.auto ? w.sweepDoneAuto : w.sweepDone, { n: r?.removed ?? 0, size: size(r?.freedKb ?? 0) })}</p>
        {r?.failed.length ? <PathList title={w.sweepKept} rows={r.failed.map((path) => ({ path, why: "" }))} /> : null}
        {r?.skipped.length ? <PathList title={w.sweepSkipped} rows={r.skipped} /> : null}
      </div>
    );
  } else if (st?.status === "ready")
    body = (
      <div className="grid gap-3">
        {CLEANUP_CATEGORIES.map((c) => (
          <Category
            key={c}
            title={w[LABELS[c][0]]}
            hint={w[LABELS[c][1]]}
            on={on(c)}
            onSwitch={(v) => saveSwitches({ categories: { [c]: v } })}
            items={items.filter((i) => i.category === c)}
            picked={picked}
            toggle={toggle}
          />
        ))}
      </div>
    );

  const schedule = st?.config?.auto.schedule ?? "off";
  return (
    <>
      <DrawerHead kicker={w.sweepKicker} named="sweep" />
      <p className="mt-3 text-sm text-muted-foreground">{w.sweepIntro}</p>
      {st?.freeGb !== undefined ? <p className="mt-2 text-sm">{fmt(w.sweepFree, { gb: st.freeGb.toFixed(1) })}</p> : null}
      <div className="mt-4">{body}</div>
      {st?.status === "ready" && items.length ? (
        <div className="sticky -bottom-5 -mx-5 mt-4 flex flex-wrap items-center gap-2 border-t border-border bg-popover px-5 py-3">
          <span className="mr-auto text-sm text-muted-foreground">
            {fmt(w.sweepSelected, { n: chosen.length })} · {size(total)}
          </span>
          <Button
            variant="danger"
            disabled={!chosen.length}
            onClick={() =>
              void post(
                "/api/cleanup/run",
                { ids: chosen.map((i) => i.id), confirm: chosen.filter((i) => i.personal).map((i) => i.path) },
                Ok,
              ).then(refresh, fail)
            }
          >
            <Named k="sweepGo" vars={{ size: size(total) }} inline />
          </Button>
        </div>
      ) : null}
      <section className="mt-5 grid gap-2 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">{w.sweepAuto}</h3>
          <Select value={schedule} onValueChange={(v) => saveSwitches({ schedule: v })}>
            <SelectTrigger size="sm" className="w-28" aria-label={w.sweepAuto}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCHEDULES.map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {w[label]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">{fmt(w.sweepAutoHint, { gb: st?.config?.auto.belowFreeGb ?? 20 })}</p>
      </section>
      <div className="mt-4 flex flex-wrap gap-2">
        {st && ["ready", "done", "error"].includes(st.status) ? (
          <Button variant="outline" onClick={() => void post("/api/cleanup/plan", {}, Ok).then(refresh, fail)}>
            {w.sweepScan}
          </Button>
        ) : null}
        <Button variant="outline" onClick={ui.closeDrawer}>
          {w.close}
        </Button>
      </div>
    </>
  );
}

/** One category: its switch, what it covers, and its items with a tick and a size each. Off dims and locks the items. */
function Category(p: {
  title: string;
  hint: string;
  on: boolean;
  onSwitch: (on: boolean) => void;
  items: CleanupItem[];
  picked: Set<string>;
  toggle: (id: string) => Promise<void>;
}) {
  const w = useWords();
  const kb = p.items.filter((i) => p.picked.has(i.id)).reduce((n, i) => n + i.kb, 0);
  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <Switch className="mt-0.5" checked={p.on} onCheckedChange={p.onSwitch} aria-label={p.title} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{p.title}</h3>
          <p className="text-xs text-muted-foreground">{p.hint}</p>
        </div>
        {p.on && kb ? <span className="text-xs text-muted-foreground">{size(kb)}</span> : null}
      </div>
      {!p.on ? (
        <p className="mt-2 text-xs text-muted-foreground">{w.sweepOff}</p>
      ) : !p.items.length ? (
        <p className="mt-2 text-xs text-muted-foreground">{w.sweepNoneHere}</p>
      ) : null}
      {p.items.length ? (
        <ul className={cn("mt-2 grid gap-1.5", !p.on && "opacity-50")}>
          {p.items.map((i) => (
            <li key={i.id}>
              <label className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-start gap-2 text-xs has-disabled:cursor-default">
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 accent-(--primary)"
                  checked={p.on && p.picked.has(i.id)}
                  disabled={!p.on}
                  onChange={() => void p.toggle(i.id)}
                />
                <span className="min-w-0">
                  <span className="block font-mono [overflow-wrap:anywhere]">{home(i.path)}</span>
                  <span className="block text-muted-foreground">
                    {i.why}
                    {i.usedAt ? ` · ${fmt(w.sweepUsed, { ago: ago(i.usedAt) })}` : null}
                  </span>
                </span>
                <span className="text-muted-foreground">{i.kb ? size(i.kb) : w.sweepSizeUnknown}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Paths a run kept or left alone, with why. */
function PathList({ title, rows }: { title: string; rows: { path: string; why: string }[] }) {
  return (
    <section>
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="mt-1 grid gap-1 text-xs">
        {rows.map((r) => (
          <li key={r.path} className="[overflow-wrap:anywhere]">
            <span className="font-mono">{home(r.path)}</span>
            {r.why ? <span className="text-muted-foreground"> — {r.why}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
