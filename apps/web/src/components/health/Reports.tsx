import { hoursMin, plainLine, rangeText, type WorkReport, WorkReportSchema } from "@overhand/contract";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import type { Model } from "@/app/data";
import { useWords } from "@/app/theme";
import { SkeletonRows } from "@/components/ui/skeleton";
import { apiFetch, get, post } from "@/lib/api";
import { date, fmt } from "@/lib/format";
import { Muted, Pane } from "../Pane";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const DAY = 864e5;
const iso = (ms: number) => new Date(ms).toLocaleDateString("sv-SE");
const SECTION = "font-display text-xs tracking-widest text-primary uppercase";

/** The query string for a report: the project, its range (`to` included), and this browser's date format for exports. */
const qs = (project: string, from: string, to: string) => new URLSearchParams({ project, from, to, lang: navigator.language }).toString();

/** Fetches an export through the API transport and hands it to the browser as a download. */
async function download(url: string, name: string): Promise<void> {
  const r = await apiFetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  const href = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement("a"), { href, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** Opens the printable page in a new tab and asks it to print. */
async function printable(url: string): Promise<void> {
  const r = await apiFetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  const href = URL.createObjectURL(new Blob([await r.text()], { type: "text/html" }));
  const win = window.open(href, "_blank");
  win?.addEventListener("load", () => win.print());
}

const tell = (e: unknown) => toast(e instanceof Error ? e.message : String(e));

/** One stat: a label over a number in the mono face. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg font-semibold" title={hint}>
        {value}
      </dd>
    </div>
  );
}

/** A built report: the numbers, PRs, failures and open items, the estimate's method, and its exports and channels. */
function ReportView({ m, r, query }: { m: Model; r: WorkReport; query: string }) {
  const w = useWords();
  const channels = m.s.updates.filter((u) => u.projects.includes(r.project));
  const file = `work-report-${r.project.replace(/[^A-Za-z0-9-]/g, "_")}-${iso(r.from)}`;
  const send = async (id: string, name: string) => {
    const [from, to] = [iso(r.from), iso(r.to - 1)];
    try {
      await post("/api/report/send", { project: r.project, from, to, channel: id }, z.object({ ok: z.boolean() }));
      toast(fmt(w.reportSent, { name }));
    } catch (e) {
      tell(e);
    }
  };
  const empty = !r.runs && !r.prs.length && !r.open.length;
  return (
    <article className="mt-3 rounded-lg border border-border bg-background/40 p-3" aria-label={`${w.paneReports}: ${r.project}`}>
      <header className="flex flex-wrap items-baseline gap-x-2">
        <b className="text-sm font-medium" style={{ color: m.hue(r.project) }}>
          {r.project}
        </b>
        <span className="text-xs text-muted-foreground">{rangeText(r, date)}</span>
      </header>
      {empty ? (
        <Muted className="mt-2 text-sm">{fmt(w.reportsNothing, { project: r.project })}</Muted>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label={w.reportTicketsDone} value={String(r.ticketsDone.length)} />
            <Stat label={w.reportPrs} value={`${r.opened} / ${r.merged}`} />
            <Stat label={w.reportAgentTime} value={hoursMin(r.agentMinutes)} />
            <Stat label={w.reportSaved} value={`~${hoursMin(r.estimate.minutes)}`} hint={r.estimate.method} />
            <Stat label={w.reportBilled} value={`$${r.billed.toFixed(2)}`} hint={w.billedEstimate} />
            <Stat label={w.reportApi} value={`$${r.cost.toFixed(2)}`} hint={w.apiPriceNote} />
          </dl>
          {r.prs.length ? (
            <section className="mt-4">
              <h4 className={SECTION}>{w.reportPrList}</h4>
              <ul className="mt-1 grid gap-1 text-sm">
                {r.prs.map((p) => (
                  <li key={`${p.key}-${p.url}`} className="flex min-w-0 items-baseline gap-2">
                    <span className="font-mono text-xs">{p.key}</span>
                    <span className="text-xs text-muted-foreground">{p.state}</span>
                    <a
                      className="min-w-0 truncate text-xs text-primary hover:underline"
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {p.url.replace(/^https?:\/\//, "")}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {r.failures.length ? (
            <section className="mt-4">
              <h4 className={SECTION}>{w.reportFailures}</h4>
              <ul className="mt-1 grid gap-1 text-sm">
                {r.failures.map((f) => (
                  <li key={`${f.key}-${f.at}`} className="[overflow-wrap:anywhere]" title={f.reason || undefined}>
                    <span className="font-mono text-xs">{f.key}</span> {f.outcome === "timeout" ? w.reportTimedOut : w.reportFailed}
                    {plainLine(f.reason) ? `: ${plainLine(f.reason)}` : ""} →{" "}
                    <span className={f.fixedBy ? "text-ok" : "text-muted-foreground"}>{f.fixedBy || w.reportNotFixed}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {r.open.length ? (
            <section className="mt-4">
              <h4 className={SECTION}>{w.reportOpenItems}</h4>
              <ul className="mt-1 grid gap-1 text-sm">
                {r.open.map((o) => (
                  <li key={`${o.key}-${o.what}`}>
                    <span className="font-mono text-xs">{o.key}</span> {o.what}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="mt-4">
            <h4 className={SECTION}>{w.reportMethod}</h4>
            <p className="mt-1 max-w-[40em] text-xs leading-relaxed text-muted-foreground">{r.estimate.method}</p>
          </section>
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="xs" variant="outline" onClick={() => void printable(`/api/report?${query}&format=html`).catch(tell)}>
          {w.reportPrint}
        </Button>
        <Button size="xs" variant="outline" onClick={() => void download(`/api/report?${query}&format=md`, `${file}.md`).catch(tell)}>
          {w.reportMarkdown}
        </Button>
        <Button size="xs" variant="outline" onClick={() => void download(`/api/report?${query}&format=csv`, `${file}.csv`).catch(tell)}>
          {w.reportCsv}
        </Button>
        {channels.map((c) => (
          <Button key={c.id} size="xs" variant="ghost" onClick={() => void send(c.id, c.name)}>
            {fmt(w.reportSend, { name: c.name })}
          </Button>
        ))}
      </div>
    </article>
  );
}

/**
 * Health → Work reports: pick a range (the last 7 days by default), then Report on a project for what its agents did,
 * with Print, Markdown and CSV, and Send to a status channel that carries the project. `project` shows only that one.
 */
export function WorkReports({ m, project, className }: { m: Model; project?: string; className?: string }) {
  const w = useWords();
  const today = new Date(new Date(Date.now()).toDateString()).getTime();
  const [from, setFrom] = useState(() => iso(today - 6 * DAY));
  const [to, setTo] = useState(() => iso(today));
  const [open, setOpen] = useState<string | null>(null);
  const id = useId();
  const query = open ? qs(open, from, to) : "";
  const report = useQuery({
    queryKey: ["work-report", query],
    queryFn: () => get(`/api/report?${query}`, WorkReportSchema),
    enabled: Boolean(open),
    staleTime: 60_000,
  });
  const names = m.s.clients.map((c) => c.name).filter((n) => !project || n === project);
  if (!names.length) return null;
  const last = (days: number) => {
    setFrom(iso(today - (days - 1) * DAY));
    setTo(iso(today));
  };
  return (
    <Pane title="paneReports" className={className}>
      <Muted className="text-xs">{w.reportsIntro}</Muted>
      {/* the two spans, then the dates as one pair that wraps together; a date is read in the UI face (tabular), since
          the mono face spaces a native date field's separators apart */}
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex gap-2">
          {(
            [
              [7, w.reportsLast7],
              [30, w.reportsLast30],
            ] as const
          ).map(([days, label]) => (
            <Button
              key={days}
              size="sm"
              variant="outline"
              className="aria-pressed:bg-primary/20"
              aria-pressed={to === iso(today) && from === iso(today - (days - 1) * DAY)}
              onClick={() => last(days)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor={`${id}-from`} className="grid gap-1 text-xs text-muted-foreground">
            {w.reportsFrom}
            <Input
              id={`${id}-from`}
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-auto text-xs text-foreground tabular-nums md:text-xs"
            />
          </label>
          <label htmlFor={`${id}-to`} className="grid gap-1 text-xs text-muted-foreground">
            {w.reportsTo}
            <Input
              id={`${id}-to`}
              type="date"
              value={to}
              min={from}
              max={iso(today)}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-auto text-xs text-foreground tabular-nums md:text-xs"
            />
          </label>
        </div>
      </div>
      <ul className="mt-3 grid gap-1">
        {names.map((n) => (
          <li key={n} className="border-t border-border py-1.5 text-sm first:border-0">
            <div className="flex items-center gap-2">
              <b className="min-w-0 flex-1 truncate font-medium" style={{ color: m.hue(n) }}>
                {n}
              </b>
              <Button
                size="xs"
                variant={open === n ? "ghost" : "outline"}
                aria-expanded={open === n}
                onClick={() => setOpen(open === n ? null : n)}
              >
                {open === n ? w.reportClose : w.reportsOpen}
              </Button>
            </div>
            {open !== n ? null : report.error ? (
              <p role="alert" className="mt-3 text-sm text-bad">
                {report.error.message}
              </p>
            ) : report.data ? (
              <ReportView m={m} r={report.data} query={query} />
            ) : (
              <SkeletonRows label={w.reportsLoading} rows={4} className="mt-3" />
            )}
          </li>
        ))}
      </ul>
    </Pane>
  );
}
