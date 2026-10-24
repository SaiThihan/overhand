/**
 * Per-project work reports from the ops folder: the run history, the PR sizes outcomes.jsonl recorded and the failure
 * messages in the activity log, built into the contract's WorkReport. On demand for any range (Health → Report), and
 * weekly when `reports.weekly` is on: written to reports/work/ and, opt-in, posted to status update channels through
 * the outward firewall.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hoursMin, type PrSize, rangeText, reportMarkdown, type UpdateChannel, type WorkReport, workReport } from "@overhand/contract";
import { plainWords } from "@overhand/themes";
import { CFG, CLIENTS, OPS } from "./env";
import { identityOf, loadHistory, loadOutcomes, projectOf } from "./history";
import { notify } from "./notify";
import { holdLeak, scanOutward } from "./outward";
import { readJson, writeJsonAtomic } from "./state";
import { plainPayload, post, type SendDeps } from "./updates";

const DAY = 864e5;

/** The last failure message per ticket key in activity log lines (`- 10:02 ✗ KEY (acct, $0.40) attempt 1: why`). */
export function failureReasons(lines: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of lines) {
    const m = l.match(/^- \d\d:\d\d ✗ ([A-Z][A-Z0-9]+-\d+) \([^)]*\) attempt \d+: (.+)$/);
    if (m?.[1] && m[2]) out[m[1]] = m[2].trim().slice(0, 200);
  }
  return out;
}

/** PR sizes by URL, from the `pr` outcomes that carry one. */
export function prSizes(outcomes: readonly { event: string; url?: string; added?: number; removed?: number; docsOnly?: boolean }[]) {
  const out: Record<string, PrSize> = {};
  for (const o of outcomes)
    if (o.event === "pr" && o.url && o.added !== undefined)
      out[o.url] = { added: o.added, removed: o.removed ?? 0, docsOnly: o.docsOnly ?? false };
  return out;
}

/** One project's report for [from, to), read from the ops folder (history from 30 days before `from`). */
export function projectReport(project: string, from: number, to: number, now = Date.now()): WorkReport {
  const days = Math.ceil((now - from) / DAY) + 30;
  const runs = loadHistory(OPS, days, identityOf, projectOf, now);
  const dates = Array.from({ length: Math.max(1, Math.ceil((to - from) / DAY)) }, (_, i) =>
    new Date(from + i * DAY).toLocaleDateString("sv-SE"),
  );
  const lines = dates.flatMap((d) => {
    const f = join(OPS, "reports", `${d}.md`);
    return existsSync(f) ? readFileSync(f, "utf8").split("\n") : [];
  });
  return workReport(runs, project, from, to, prSizes(loadOutcomes(OPS)), failureReasons(lines));
}

/** Local midnight of a `YYYY-MM-DD` day, or NaN. */
export const dayStart = (d: string): number => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`).getTime() : Number.NaN);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** The report as a standalone printable page (Health → Print): plain, light, one column, its own styles. */
export function reportHtml(r: WorkReport, day?: (ms: number) => string): string {
  const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "");
  const link = (u: string) => (u ? ` <a href="${esc(u)}">${esc(u.replace(/^https?:\/\//, ""))}</a>` : "");
  const stat = (k: string, v: string) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  return [
    "<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>",
    `<title>Work report: ${esc(r.project)}</title>`,
    "<style>body{font:14px/1.5 Atkinson Hyperlegible Next,system-ui,sans-serif;color:#111;background:#fff;max-width:760px;margin:32px auto;padding:0 16px}",
    "h1{font-size:22px;margin:0}h2{font-size:15px;margin:24px 0 6px}.range{color:#555;margin:2px 0 16px}",
    "dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0}dt{color:#555;font-size:12px}",
    "dd{margin:0;font:600 18px Atkinson Hyperlegible Mono,ui-monospace,monospace}a{color:#111}li{margin:2px 0;overflow-wrap:anywhere}",
    ".note{color:#555;font-size:12px}@media print{body{margin:0}a{text-decoration:none}}</style></head><body>",
    `<h1>Work report: ${esc(r.project)}</h1><p class=range>${esc(rangeText(r, day))}</p><dl>`,
    stat("Tickets done", String(r.ticketsDone.length)),
    stat("PRs opened / merged", `${r.opened} / ${r.merged}`),
    stat("Agent time", hoursMin(r.agentMinutes)),
    stat("Human time saved (est.)", `~${hoursMin(r.estimate.minutes)}`),
    stat(plainWords.reportBilled, `$${r.billed.toFixed(2)}`),
    stat(plainWords.reportApi, `$${r.cost.toFixed(2)}`),
    "</dl>",
    r.prs.length ? `<h2>Pull requests</h2>${list(r.prs.map((p) => `${esc(p.key)}: ${p.state}${link(p.url)}`))}` : "",
    r.failures.length
      ? `<h2>Failures and what fixed them</h2>${list(r.failures.map((f) => `${esc(f.key)} ${f.outcome === "timeout" ? "timed out" : "failed"}${f.reason ? `: ${esc(f.reason)}` : ""} → ${esc(f.fixedBy || "not fixed yet")}`))}`
      : "",
    r.open.length ? `<h2>Open items</h2>${list(r.open.map((o) => `${esc(o.key)}: ${esc(o.what)}${link(o.url)}`))}` : "",
    `<h2>How time saved is estimated</h2><p class=note>${esc(r.estimate.method)}</p>`,
    "</body></html>",
  ].join("");
}

/**
 * Posts a project's report to a status update channel, through the outward firewall scoped to the channel's projects:
 * a leak is held in Needs you. Cost goes in only with `reports.cost`. "" when it went, else why not. Never throws.
 */
export async function sendReport(ch: UpdateChannel, r: WorkReport, deps?: SendDeps): Promise<string> {
  if (!ch.projects.includes(r.project)) return `${ch.name} doesn't carry ${r.project}.`;
  const text = reportMarkdown(r, { cost: CFG.reports.cost ? plainWords : false });
  const body = plainPayload(ch.kind, text);
  const hits = scanOutward(text, ch.projects);
  if (hits.length) {
    const held = { kind: "update", project: r.project, to: ch.projects, dest: `status channel ${ch.name}` } as const;
    const safe = hits.filter((h) => h.why === "secret").reduce((b, h) => b.split(h.term).join("[secret]"), body);
    holdLeak(
      { ...held, title: `Work report to ${ch.name}`, text, payload: { channel: ch.id, body: safe, to: ch.projects.join("\n") } },
      hits,
    );
    return "Held by the outward firewall: it's waiting in Needs you.";
  }
  return post(ch, body, deps);
}

/** The weekly slot at or before `now`: `weekday` at `hour`, local time. */
export function lastSlot(weekday: number, hour: number, now: number): number {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - weekday + 7) % 7));
  if (d.getTime() > now) d.setDate(d.getDate() - 7);
  return d.getTime();
}

const FILE = () => join(OPS, "work-reports.json");

/**
 * Runs every minute: when `reports.weekly` is on and its slot has passed since the last time, writes every project's
 * report on the 7 days before the slot's day to reports/work/<date>-<project>.md and posts it to the opted-in channels.
 * Seen for the first time, it starts its clock now (turning it on doesn't post last week at once).
 */
export async function tickReports(now = Date.now(), deps?: SendDeps): Promise<void> {
  const cfg = CFG.reports;
  if (!cfg.weekly) return;
  const last = readJson<{ lastAt?: number }>(FILE(), {}).lastAt;
  const slot = lastSlot(cfg.weekday, cfg.hour, now);
  if (last === undefined || last >= slot) {
    if (last === undefined) writeJsonAtomic(FILE(), { lastAt: now });
    return;
  }
  writeJsonAtomic(FILE(), { lastAt: now });
  const to = new Date(new Date(slot).toDateString()).getTime();
  const from = to - 7 * DAY;
  const dir = join(OPS, "reports", "work");
  mkdirSync(dir, { recursive: true });
  const day = new Date(to - 1).toLocaleDateString("sv-SE");
  const reports = CLIENTS.map((c) => projectReport(c.name, from, to, now));
  for (const r of reports)
    writeFileSync(join(dir, `${day}-${r.project.replace(/[^A-Za-z0-9-]/g, "_")}.md`), reportMarkdown(r, { cost: plainWords }));
  const failed: string[] = [];
  for (const ch of CFG.updates.filter((u) => cfg.channels.includes(u.id)))
    for (const r of reports.filter((x) => ch.projects.includes(x.project) && (x.runs || x.prs.length))) {
      const error = await sendReport(ch, r, deps);
      if (error) failed.push(`${ch.name}: ${error}`);
    }
  notify("Weekly work reports ready", failed.length ? failed.join("; ").slice(0, 140) : `${reports.length} projects, in Health → Reports`);
}
