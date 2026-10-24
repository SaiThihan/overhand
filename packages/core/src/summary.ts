/**
 * The summary of a span from real state: merges and new PRs from the run history, open agent PRs from state.json,
 * blocked and queued tickets from the trackers, spend from the run log. The social card and status updates read it.
 */
import { type HistoryRun, isBilled, type Span, type Summary, type SummaryItem, spanFrom, type Ticket } from "@overhand/contract";
import { uiTickets } from "./dashboard";
import { CFG, clientOf, LABEL, OPS } from "./env";
import { mergedGuides } from "./guide";
import { identityOf, loadHistory, projectOf } from "./history";
import { loadState } from "./state";

/** What `buildSummary` reads, gathered by `summarize`. */
export interface SummaryInputs {
  history: HistoryRun[];
  /** Agent PRs open now. */
  prs: { key: string; project: string; url: string }[];
  /** Open tickets per project, or the tracker's error. */
  tickets: Record<string, Ticket[] | string>;
  labels: { blocked: string; queue: string };
  /** Onboarding guides whose PR merged, with when; those in the span are listed. */
  guides?: (SummaryItem & { at: number })[];
}

/** The summary of `span` ending at `now`. Pure: tests feed it inputs. */
export function buildSummary(span: Span, now: number, x: SummaryInputs): Summary {
  const from = spanFrom(span, now);
  const within = (t: number | undefined) => t !== undefined && t >= from && t <= now;
  const titles = new Map<string, string>();
  for (const list of Object.values(x.tickets)) if (Array.isArray(list)) for (const t of list) titles.set(t.key, t.title);
  const item = (project: string, key: string, url = ""): SummaryItem => ({ project, key, title: titles.get(key) ?? "", url });
  const once = (xs: SummaryItem[]) => [...new Map(xs.map((i) => [i.key, i])).values()];
  const tickets = (label: string) =>
    Object.entries(x.tickets).flatMap(([project, list]) =>
      Array.isArray(list)
        ? list.filter((t) => t.labels.includes(label)).map((t) => ({ project, key: t.key, title: t.title, url: t.url }))
        : [],
    );
  const prRuns = x.history.filter((r) => r.kind === "ticket" && r.pr && r.project);
  const spend: Record<string, number> = {};
  // billed money only: a plan's runs aren't charged per run, so their API-price cost is no spend to report
  for (const r of x.history)
    if (r.project && within(r.start) && r.cost && isBilled(r.billing)) spend[r.project] = (spend[r.project] ?? 0) + r.cost;
  return {
    span,
    from,
    to: now,
    shipped: once(prRuns.filter((r) => r.pr?.state === "merged" && within(r.pr.doneAt)).map((r) => item(r.project, r.key, r.pr?.url))),
    opened: once(prRuns.filter((r) => within(r.pr?.openedAt)).map((r) => item(r.project, r.key, r.pr?.url))),
    review: once(x.prs.filter((p) => p.project).map((p) => item(p.project, p.key, p.url))),
    blocked: once(tickets(x.labels.blocked)),
    next: once(tickets(x.labels.queue)),
    spend,
    guides: (x.guides ?? []).filter((g) => within(g.at)).map(({ at: _, ...g }) => g),
  };
}

/** The summary of `span` from this machine's state. */
export async function summarize(span: Span, now = Date.now()): Promise<Summary> {
  const prs = Object.entries(loadState().prs).map(([key, p]) => ({ key, project: clientOf(key)?.name ?? "", url: p.url }));
  return buildSummary(span, now, {
    history: loadHistory(OPS, 8, identityOf, projectOf, now),
    prs,
    tickets: CFG.clients.length ? await uiTickets() : {},
    labels: { blocked: LABEL.blocked, queue: LABEL.queue },
    guides: mergedGuides(),
  });
}
