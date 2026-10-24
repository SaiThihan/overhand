import type { SplitPart } from "@overhand/contract";
import type { WordKey } from "@overhand/themes";
import { useState } from "react";
import { useActions } from "@/app/actions";
import type { Model } from "@/app/data";
import { Term, useWords } from "@/app/theme";
import { useUi } from "@/app/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { canAssign, isAssigned, projectOfKey } from "@/lib/assign";
import { fmt } from "@/lib/format";
import { findTicket, plannedKeys, statusOf, type TicketStatus } from "@/lib/plan";
import { AssignButton } from "../AssignButton";
import { DecisionCard, useBrief } from "../DecisionCard";
import { DrawerHead } from "./DrawerHost";

const STATUS: Record<TicketStatus, { word: WordKey; color: string }> = {
  working: { word: "stWorking", color: "var(--primary)" },
  blocked: { word: "stBlocked", color: "var(--bad)" },
  review: { word: "stReview", color: "var(--warn)" },
  queued: { word: "stQueued", color: "var(--primary)" },
  planned: { word: "stPlanned", color: "var(--primary)" },
  mine: { word: "stMine", color: "var(--muted-foreground)" },
};

/** One ticket: where it stands, links, and handing it to (or taking it from) the agent. */
export function TicketDrawer({ m, ticketKey }: { m: Model; ticketKey: string }) {
  const w = useWords();
  const { toggle } = useActions();
  const ui = useUi();
  const t = findTicket(m.s.tickets, ticketKey);
  const st = t ? statusOf(t, m.s, plannedKeys(m.plan)) : null;
  const pr = m.s.prs.find((p) => p.key === ticketKey);
  const project = t?.client ?? projectOfKey(m.s, ticketKey);
  // the decision card already offers assigning an agent (watch and propose projects): one way to do it, not two
  const cardAssigns = useBrief(t ? `ticket:${ticketKey}` : undefined).data?.options.some((o) => o.do === "assign") ?? false;
  const ai = Object.values(m.plan.clients)
    .flatMap((c) => c.agent)
    .find((a) => a.key === ticketKey);
  return (
    <>
      <DrawerHead
        color={t ? m.hue(t.client) : undefined}
        kicker={`${ticketKey}${t ? ` ${fmt(w.inClient, { client: t.client })}` : ""}`}
        title={t?.title || w.ticketNotOpen}
      />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {st ? (
          <Badge variant="outline" style={{ color: STATUS[st].color, borderColor: STATUS[st].color }}>
            <Term k={STATUS[st].word} />
          </Badge>
        ) : null}
        {t ? <Badge variant="outline">{t.status}</Badge> : null}
        {t?.priority ? <Badge variant="outline">{t.priority}</Badge> : null}
        {t?.labels.map((l) => (
          <Badge key={l} variant="outline" className="text-muted-foreground">
            {l}
          </Badge>
        ))}
      </div>
      {/* Open ticket lives in the card's options; the button stands in only when there's no brief */}
      {t ? (
        <DecisionCard
          m={m}
          item={`ticket:${ticketKey}`}
          here={`ticket:${ticketKey}`}
          fallback={
            t.url ? (
              <Button asChild variant="outline" className="mt-4">
                <a href={t.url} target="_blank" rel="noopener noreferrer">
                  {w.openTicket} ↗
                </a>
              </Button>
            ) : null
          }
        />
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {pr ? (
          <>
            {/* the agent's PR opens in Review, like everywhere else; GitHub is one step further */}
            <Button variant="outline" onClick={() => ui.openDrawer({ kind: "review", key: ticketKey })}>
              <Term k="review" />
            </Button>
            <Button asChild variant="ghost">
              <a href={pr.url} target="_blank" rel="noopener noreferrer">
                {w.reviewOnGithub} ↗
              </a>
            </Button>
          </>
        ) : null}
        {cardAssigns ? null : project && !pr && canAssign(m.s, project) ? (
          <AssignButton offer={{ project, key: ticketKey, title: t?.title }} assigned={isAssigned(m.s, ticketKey)} variant="primary" />
        ) : t && st && !["queued", "working", "review"].includes(st) ? (
          <AssignButton offer={{ project, key: ticketKey }} variant="primary" />
        ) : null}
        {ai ? (
          <Button variant="outline" onClick={() => void toggle(ai.i)}>
            {ai.on ? w.takeOff : w.giveBack}
          </Button>
        ) : null}
      </div>
      {ai?.why ? <p className="mt-4 text-sm text-muted-foreground">{fmt(w.whyPicked, { why: ai.why })}</p> : null}
      {m.s.splits[ticketKey] ? <SplitEditor ticketKey={ticketKey} proposed={m.s.splits[ticketKey]} /> : null}
    </>
  );
}

/** The agent's proposed split of a too-big ticket: edit the parts, clear a title to drop one, then file them. */
function SplitEditor({ ticketKey, proposed }: { ticketKey: string; proposed: SplitPart[] }) {
  const w = useWords();
  const { split } = useActions();
  const [parts, setParts] = useState(proposed);
  const set = (i: number, patch: Partial<SplitPart>) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const keep = parts.filter((p) => p.title.trim()).map((p) => ({ title: p.title.trim(), scope: p.scope.trim() }));
  return (
    <section className="mt-5 grid gap-3" aria-label={w.splitFile}>
      <p className="text-sm text-muted-foreground">{w.splitHint}</p>
      {parts.map((p, i) => (
        // the proposal's order is fixed while editing, so the index is a stable key
        // biome-ignore lint/suspicious/noArrayIndexKey: parts have no id and never reorder
        <div key={i} className="grid gap-1.5">
          <Label htmlFor={`part-${i}`}>{fmt(w.splitPart, { n: i + 1 })}</Label>
          <Input id={`part-${i}`} value={p.title} onChange={(e) => set(i, { title: e.target.value })} />
          <Label htmlFor={`scope-${i}`} className="text-muted-foreground">
            {w.splitScope}
          </Label>
          <Textarea id={`scope-${i}`} value={p.scope} onChange={(e) => set(i, { scope: e.target.value })} className="min-h-16" />
        </div>
      ))}
      <div>
        <Button disabled={!keep.length} onClick={() => void split(ticketKey, keep)}>
          {w.splitFile}
        </Button>
      </div>
    </section>
  );
}
