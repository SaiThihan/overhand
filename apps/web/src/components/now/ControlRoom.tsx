import type { ControlSession } from "@overhand/contract";
import { type FormEvent, useState } from "react";
import { useActions } from "@/app/actions";
import type { Model } from "@/app/data";
import { Term, useWords } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ago, fmt, hm } from "@/lib/format";
import { InsightLine } from "../DecisionCard";
import { Dot, Muted, Pane } from "../Pane";

/** What connecting or disconnecting would write, shown before anything is written. */
type Preview = { on: boolean; file: string; after: string };

/**
 * One session on this machine: where it works, what it holds (browsers, ports, heavy jobs), whether the house rules
 * reach it, and Connect (with exactly what gets written first), Disconnect, Resume or Ask.
 */
function SessionRow({ x, m, onAsk }: { x: ControlSession; m: Model; onAsk: (key: string) => void }) {
  const w = useWords();
  const { connectSession, resumeSession } = useActions();
  const [preview, setPreview] = useState<Preview | null>(null);
  const show = async (on: boolean) => {
    const r = await connectSession(x.key, on, true);
    if (r) setPreview({ on, ...r });
  };
  const facts = [
    x.branch,
    x.browsers ? fmt(w.sessBrowsers, { n: x.browsers }) : "",
    x.ports.length ? fmt(w.sessPorts, { ports: x.ports.join(", ") }) : "",
    ...x.heavy.map((j) => `${j.kind} ${ago(j.since)}`),
  ].filter(Boolean);
  return (
    <li className="grid gap-1 border-t border-border py-2 text-xs first:border-0 first:pt-0">
      <div className="flex min-w-0 items-center gap-2">
        <Dot color={x.active ? "var(--ok)" : "var(--muted-foreground)"} on={x.active} label={x.active ? w.working : w.idle} />
        <b className="shrink-0 text-sm font-medium" style={{ color: m.hue(x.project) }}>
          {x.label}
        </b>
        <span className="shrink-0 text-muted-foreground">
          <Term k={x.kind === "you" ? "kindYou" : x.kind === "lead" ? "kindLead" : "kindAgent"} />
        </span>
        <span className="truncate text-muted-foreground">{facts.join(" · ")}</span>
      </div>
      <p className={x.connected && x.rulesAck ? "text-muted-foreground" : "text-(--warn)"}>
        {!x.connected && x.kind === "you" ? w.sessNotConnected : !x.rulesAck && x.connected ? w.sessRulesNew : w.sessConnected}
      </p>
      {x.paused ? <p className="text-(--warn)">{fmt(w.sessPaused, { reason: x.paused })}</p> : null}
      {preview ? (
        <div className="grid gap-1.5">
          <p className="text-muted-foreground">{fmt(preview.on ? w.sessConnectBody : w.sessDisconnectBody, { file: preview.file })}</p>
          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px] whitespace-pre-wrap">
            {preview.after || "{}"}
          </pre>
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="xs" onClick={() => setPreview(null)}>
              {w.cancel}
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() => void connectSession(x.key, preview.on, false).then((r) => r && setPreview(null))}
            >
              {preview.on ? w.sessConnectGo : w.sessDisconnectGo}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-1">
          {x.paused ? (
            <Button variant="outline" size="xs" onClick={() => void resumeSession(x.key)}>
              {w.sessResume}
            </Button>
          ) : null}
          {x.kind === "you" ? (
            <Button variant="ghost" size="xs" onClick={() => void show(!x.connected)}>
              {x.connected ? w.sessDisconnect : w.sessConnect}
            </Button>
          ) : null}
          {x.connected ? (
            <Button variant="ghost" size="xs" onClick={() => onAsk(x.key)}>
              {w.sessAsk}
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}

/** Every agent session on this machine, Overhand's and yours: the control room's registry. */
function Sessions({ m, onAsk }: { m: Model; onAsk: (key: string) => void }) {
  const w = useWords();
  const list = m.s.control.sessions;
  return (
    <Pane title="paneSessions" count={list.length}>
      {list.length ? (
        <ul className="grid">
          {list.map((x) => (
            <SessionRow key={x.key} x={x} m={m} onAsk={onAsk} />
          ))}
        </ul>
      ) : (
        <InsightLine m={m} surface="crew" fallback={<Muted>{w.sessEmpty}</Muted>} />
      )}
    </Pane>
  );
}

/**
 * Requests between sessions and what Overhand did with your authority, newest first, with a form to send one: a typed
 * request is handed to the session at its next tool call and tracked until it's done or refused.
 */
function Timeline({ m, to, setTo }: { m: Model; to: string; setTo: (key: string) => void }) {
  const w = useWords();
  const { askSession } = useActions();
  const [text, setText] = useState("");
  const [by, setBy] = useState("");
  const targets = m.s.control.sessions.filter((x) => x.connected);
  const target = targets.find((x) => x.key === to) ?? targets[0];
  const state = { sent: w.reqSent, acknowledged: w.reqAcknowledged, done: w.reqDone, refused: w.reqRefused, dropped: w.reqDropped };
  const items = [
    ...m.s.control.requests.map((r) => ({
      at: r.changedAt || r.at,
      key: `r-${r.id}`,
      line: `${r.from} → ${r.toLabel}: ${r.text}`,
      meta: [state[r.state], r.by ? hm(r.by) : "", r.note].filter(Boolean).join(" · "),
      bad: r.state === "refused",
    })),
    ...m.s.control.actions.map((a, i) => ({
      at: a.at,
      key: `a-${a.at}-${i}`,
      line: a.result,
      meta: a.auto ? w.timelineAuto : w.timelineYou,
      bad: !a.ok,
    })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 20);
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!target || !text.trim()) return;
    void askSession(target.key, text.trim(), by.trim()).then((ok) => {
      if (!ok) return;
      setText("");
      setBy("");
    });
  };
  return (
    <Pane title="paneRequests">
      {targets.length && target ? (
        <form className="mb-3 grid gap-1.5" onSubmit={send}>
          <div className="flex gap-1.5">
            <select
              aria-label={w.reqTo}
              className="h-8 max-w-40 rounded-md border border-input bg-transparent px-1.5 text-xs pointer-coarse:h-9"
              value={target.key}
              onChange={(e) => setTo(e.target.value)}
            >
              {targets.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
            <Input
              aria-label={w.reqText}
              placeholder={w.reqText}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="flex gap-1.5">
            <Input
              aria-label={w.reqBy}
              placeholder={w.reqBy}
              value={by}
              onChange={(e) => setBy(e.target.value)}
              className="h-8 max-w-40 text-sm"
            />
            <Button type="submit" variant="outline" size="sm" disabled={!text.trim()}>
              {w.reqSend}
            </Button>
          </div>
        </form>
      ) : null}
      {items.length ? (
        <ul className="grid gap-1.5">
          {items.map((x) => (
            <li key={x.key} className="grid gap-0.5 text-xs">
              <span className={x.bad ? "text-(--bad)" : ""}>{x.line}</span>
              <span className="text-muted-foreground">{[hm(x.at), x.meta].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Muted>{w.timelineEmpty}</Muted>
      )}
    </Pane>
  );
}

/** The control room in Crew: the session registry beside the timeline; Ask on a session picks it in the form. */
export function ControlRoom({ m }: { m: Model }) {
  const [to, setTo] = useState("");
  return (
    <>
      <Sessions m={m} onAsk={setTo} />
      <Timeline m={m} to={to} setTo={setTo} />
    </>
  );
}
