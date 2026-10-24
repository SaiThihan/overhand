import { type PrReview, PrReviewSchema } from "@overhand/contract";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { useActions } from "@/app/actions";
import type { Model } from "@/app/data";
import { Named, useWords } from "@/app/theme";
import { Explain } from "@/components/Explain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DEMO } from "@/demo/demo";
import { get } from "@/lib/api";
import { collapsed, type DiffFile, type DiffLine, parseDiff } from "@/lib/diff";
import { explainPr } from "@/lib/explain";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DecisionCard } from "../DecisionCard";
import { Dot } from "../Pane";
import { Corners } from "./Corners";
import { DrawerHead } from "./DrawerHost";
import { PreviewReview } from "./PreviewReview";
import { Proof } from "./Proof";

/** A check's state as a state colour: green passing, red failing, starlight still running, ink otherwise. */
function checkColor(state: string): string {
  if (/SUCCESS|PASS|NEUTRAL|SKIPPED/i.test(state)) return "var(--ok)";
  if (/FAIL|ERROR|TIMED_OUT|CANCEL|ACTION_REQUIRED/i.test(state)) return "var(--bad)";
  if (/PENDING|QUEUED|IN_PROGRESS|EXPECTED|WAITING/i.test(state)) return "var(--primary)";
  return "var(--muted-foreground)";
}

const SECTION = "font-display text-xs tracking-widest text-primary uppercase";

/** One diff line: old and new line numbers, a +/− gutter, and the text; additions green, deletions red, the rest ink. */
function Line({ l }: { l: DiffLine }) {
  if (l.kind === "hunk" || l.kind === "note") return <div className="bg-muted/60 px-3 py-0.5 text-muted-foreground">{l.text}</div>;
  const sign = l.kind === "add" ? "+" : l.kind === "del" ? "−" : " ";
  return (
    <div
      className={cn(
        "grid grid-cols-[2.25rem_2.25rem_1rem_1fr] sm:grid-cols-[3.25rem_3.25rem_1rem_1fr]",
        l.kind === "add" && "bg-ok/10 text-foreground",
        l.kind === "del" && "bg-bad/10 text-foreground",
      )}
    >
      <span className="pr-2 text-right text-muted-foreground/70 select-none">{l.old ?? ""}</span>
      <span className="pr-2 text-right text-muted-foreground/70 select-none">{l.new ?? ""}</span>
      <span className={cn("select-none", l.kind === "add" ? "text-ok" : l.kind === "del" ? "text-bad" : "")} aria-hidden="true">
        {sign}
      </span>
      <span className="pr-3 whitespace-pre-wrap [overflow-wrap:anywhere]">{l.text || " "}</span>
    </div>
  );
}

/** One file's section: its path and counts, its lines; big, deleted, binary and lock files start collapsed. */
function FileSection({ f }: { f: DiffFile }) {
  const w = useWords();
  const [open, setOpen] = useState(() => !collapsed(f));
  const changed = f.additions + f.deletions;
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background/40">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
      >
        <span aria-hidden="true" className="w-3 shrink-0 text-muted-foreground">
          {open ? "▾" : "▸"}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.path}>
          {f.status === "renamed" ? `${f.from} → ${f.path}` : f.path}
        </span>
        {f.status !== "modified" && f.status !== "renamed" ? (
          <span className="shrink-0 text-xs text-muted-foreground">{f.status}</span>
        ) : null}
        <span className="shrink-0 font-mono text-xs tabular-nums">
          <span className="text-ok">+{f.additions}</span> <span className="text-bad">−{f.deletions}</span>
        </span>
      </button>
      {open ? (
        f.binary ? (
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{w.reviewBinary}</p>
        ) : (
          <div data-data="" className="overflow-x-auto border-t border-border font-mono text-xs leading-5">
            {f.lines.map((l, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no id and never reorder
              <Line key={i} l={l} />
            ))}
          </div>
        )
      ) : changed && !f.binary ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full border-t border-border px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/60"
        >
          {fmt(w.reviewShowFile, { n: changed })}
        </button>
      ) : null}
    </section>
  );
}

/**
 * What you can do: approve and mark ready (or only mark ready on your own PR), request changes, close. Never merge: on
 * Ship GitHub's auto-merge does that, and it says so.
 */
function Actions({ pr, shipping }: { pr: PrReview; shipping: boolean }) {
  const w = useWords();
  const { prReady, prChanges, prClose } = useActions();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const own = !pr.viewer || pr.viewer === pr.author;
  const open = pr.state === "OPEN" || pr.state === "";
  if (!open) return <p className="mt-4 text-sm text-muted-foreground">{w.reviewClosed}</p>;
  return (
    <section className="mt-5 grid gap-3" aria-label={w.review}>
      {own && pr.draft ? <p className="text-xs text-muted-foreground">{fmt(w.reviewSelf, { login: pr.author || "you" })}</p> : null}
      <div className="flex flex-wrap gap-2">
        {pr.draft ? (
          <Button onClick={() => void prReady(pr.key)}>
            <Named k={own ? "reviewMarkReady" : "reviewApprove"} inline />
          </Button>
        ) : null}
        <Button variant="outline" aria-expanded={asking} onClick={() => setAsking((a) => !a)}>
          {w.reviewRequestChanges}
        </Button>
        <Button variant="danger" onClick={() => void prClose(pr.key)}>
          {w.reviewClose}
        </Button>
      </div>
      {asking ? (
        <form
          className="grid gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            void prChanges(pr.key, note.trim()).then((sent) => {
              if (!sent) return;
              setNote("");
              setAsking(false);
            });
          }}
        >
          <Label htmlFor="review-note" className="text-muted-foreground">
            {w.reviewChangesHint}
          </Label>
          <Textarea id="review-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-24" autoFocus />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAsking(false)}>
              {w.cancel}
            </Button>
            <Button type="submit" variant="outline" disabled={!note.trim()}>
              {w.reviewSendChanges}
            </Button>
          </div>
        </form>
      ) : null}
      <p className="text-xs text-muted-foreground">{shipping ? w.reviewShipOn : w.reviewNeverMerges}</p>
    </section>
  );
}

/** A link to a PR's preview deploy. In the demo it explains itself instead of leaving for a made-up address. */
export function PreviewLink({ url, className, children }: { url: string; className?: string; children: ReactNode }) {
  const w = useWords();
  return (
    <a
      className={className}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={w.reviewPreviewHint}
      onClick={(e) => {
        if (!DEMO) return;
        e.preventDefault();
        toast(w.reviewPreviewDemo);
      }}
    >
      {children}
    </a>
  );
}

/**
 * An agent PR in full: title, the agent's summary, checks, a readable diff, and ready / request changes / close. With a
 * preview, it can be reviewed on the running change too (`onPreview` opens it there). `short` (a live piece on the
 * site) stops after the review on the preview, what's worth a look and the proof: the summary, the checks one by one,
 * the actions and the diff are in the live demo.
 */
export function ReviewDrawer({
  m,
  ticketKey,
  onPreview = false,
  short = false,
}: {
  m: Model;
  ticketKey: string;
  onPreview?: boolean;
  short?: boolean;
}) {
  const w = useWords();
  const [reviewing, setReviewing] = useState(onPreview);
  const tracked = m.s.prs.find((p) => p.key === ticketKey);
  const client = m.s.clients.find((c) => ticketKey.startsWith(`${c.prefix}-`));
  const { data: pr, error } = useQuery({
    queryKey: ["pr-review", ticketKey],
    queryFn: () => get(`/api/pr/review?key=${encodeURIComponent(ticketKey)}`, PrReviewSchema),
  });
  const files = useMemo(() => parseDiff(pr?.diff ?? ""), [pr?.diff]);
  const adds = files.reduce((n, f) => n + f.additions, 0);
  const dels = files.reduce((n, f) => n + f.deletions, 0);
  return (
    <>
      <DrawerHead
        color={client ? m.hue(client.name) : undefined}
        kicker={`${fmt(w.reviewKicker, { key: ticketKey })}${client ? ` ${fmt(w.inClient, { client: client.name })}` : ""}`}
        title={pr?.title || tracked?.branch || ticketKey}
      />
      {pr ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={pr.draft ? "border-warn/60 text-warn" : "border-ok/60 text-ok"}>
            {pr.draft ? w.reviewDraft : w.reviewReady}
          </Badge>
          {tracked ? <Explain x={explainPr(m.s, tracked, w)} about={ticketKey} /> : null}
          <Badge variant="outline" className="font-mono">
            {pr.repo}#{pr.number}
          </Badge>
          {tracked?.preview ? (
            <>
              <Button size="sm" className="ml-auto" aria-expanded={reviewing} onClick={() => setReviewing((x) => !x)}>
                {w.pvTitle}
              </Button>
              <Button asChild size="sm" variant="outline">
                <PreviewLink url={tracked.preview}>{w.reviewPreview} ↗</PreviewLink>
              </Button>
            </>
          ) : null}
          <a
            className={cn("hit-area relative text-sm text-primary hover:underline", !tracked?.preview && "ml-auto")}
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {w.reviewOnGithub} ↗
          </a>
        </div>
      ) : null}
      {tracked ? <DecisionCard m={m} item={`pr:${ticketKey}`} here={`pr:${ticketKey}`} /> : null}
      {error ? (
        <p role="alert" className="mt-4 text-sm text-bad">
          {error.message}
        </p>
      ) : !pr ? (
        // the corners, then the proof: the review's shape until the PR and its diff arrive
        <div className="mt-4 grid gap-4">
          <SkeletonRows label={w.reviewLoading} rows={2} row="h-16 rounded-[var(--radius-tile)]" className="grid-cols-2" />
          <SkeletonRows rows={4} />
        </div>
      ) : short ? (
        <>
          {reviewing && tracked?.preview ? <PreviewReview m={m} pr={pr} tracked={tracked} /> : null}
          <Corners corners={pr.corners} />
          <Proof prKey={ticketKey} proof={tracked?.proof ?? null} ci={pr.checks} />
        </>
      ) : (
        <>
          {reviewing && tracked?.preview ? <PreviewReview m={m} pr={pr} tracked={tracked} /> : null}
          <Corners corners={pr.corners} />
          <Proof prKey={ticketKey} proof={tracked?.proof ?? null} ci={pr.checks} />
          <Actions pr={pr} shipping={tracked?.ship?.on ?? false} />
          <section className="mt-5">
            <h3 className={SECTION}>{w.reviewSummary}</h3>
            <div
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard
              tabIndex={0}
              className="mt-2 max-h-56 max-w-[33em] overflow-auto rounded-lg bg-muted/50 p-3 text-sm leading-relaxed whitespace-pre-wrap"
            >
              {pr.body.trim() || w.reviewNoSummary}
            </div>
          </section>
          <section className="mt-5">
            <h3 className={SECTION}>{w.reviewChecks}</h3>
            {pr.checks.length ? (
              <ul className="mt-2 grid gap-1 text-sm">
                {pr.checks.map((c) => (
                  <li key={`${c.name}-${c.state}`} className="flex items-center gap-2">
                    <Dot color={checkColor(c.state)} label={c.state.toLowerCase()} />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.state.toLowerCase().replaceAll("_", " ")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{w.reviewNoChecks}</p>
            )}
          </section>
          <section className="mt-5">
            <h3 className={SECTION}>
              {w.reviewChanges}{" "}
              <span className="ml-1 tracking-normal text-muted-foreground normal-case">
                {fmt(w.reviewFiles, { n: files.length, add: adds, del: dels })}
              </span>
            </h3>
            <div className="mt-2 grid gap-2">
              {files.map((f) => (
                <FileSection key={`${f.from}->${f.path}`} f={f} />
              ))}
            </div>
            {pr.truncated ? <p className="mt-2 text-xs text-muted-foreground">{w.reviewTruncated}</p> : null}
          </section>
        </>
      )}
    </>
  );
}
