import { type AgentPr, type PreviewPin, PreviewReviewSchema, type PreviewViewport, type PrReview } from "@overhand/contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type MouseEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { useActions } from "@/app/actions";
import { type Model, STATE_KEY } from "@/app/data";
import { useWords } from "@/app/theme";
import { Explain } from "@/components/Explain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { get, post } from "@/lib/api";
import { explainPr } from "@/lib/explain";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApiImage } from "./Proof";
import { PreviewLink } from "./ReviewDrawer";

const SECTION = "font-display text-xs tracking-widest text-primary uppercase";
/** A note not yet sent: where on the still (page pixels) and what you said. */
type Draft = { x: number; y: number; note: string };

/** A numbered pin on a still, placed in page pixels over an image of the whole page. */
function Pin({ n, x, y, width, height }: { n: number; x: number; y: number; width: number; height: number }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--you-fill)] font-mono text-xs text-white shadow ring-2 ring-white"
      style={{ left: `${(x / width) * 100}%`, top: `${(y / height) * 100}%` }}
    >
      {n}
    </span>
  );
}

/** A pinned spot as it was when you sent the note, and after the agent's fix when it has been checked. */
function Spot({ p, phone }: { p: PreviewPin; phone: boolean }) {
  const w = useWords();
  const before = useApiImage(p.before);
  const after = useApiImage(p.after);
  return (
    <li className="grid gap-2 rounded-lg border border-border bg-background/40 p-3">
      <p className="text-sm">
        <span className="font-mono text-xs text-muted-foreground">{fmt(w.pvNote, { n: p.n })} · </span>
        {p.note}
      </p>
      {before || after ? (
        <div className={cn("grid gap-2", phone && "sm:grid-cols-2")}>
          {before ? (
            <figure className="grid gap-1">
              <img src={before} alt={`${w.pvBefore}: ${p.note}`} className="w-full rounded border border-border" />
              <figcaption className="text-xs text-muted-foreground">{w.pvBefore}</figcaption>
            </figure>
          ) : null}
          {after ? (
            <figure className="grid gap-1">
              <img src={after} alt={`${w.pvAfter}: ${p.note}`} className="w-full rounded border border-ok/60" />
              <figcaption className="text-xs text-ok">{w.pvAfter}</figcaption>
            </figure>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Review on the preview: look at the running change, click what's wrong, say what should change, and the notes go to the
 * same agent as this PR's next fix round. Then each spot is shown before and after, and you approve (merging stays yours).
 */
export function PreviewReview({ m, pr, tracked }: { m: Model; pr: PrReview; tracked: AgentPr }) {
  const w = useWords();
  const qc = useQueryClient();
  const { prReady } = useActions();
  const key = tracked.key;
  const queryKey = ["preview-review", key];
  const { data: r } = useQuery({
    queryKey,
    queryFn: () => get(`/api/preview/review?key=${encodeURIComponent(key)}`, PreviewReviewSchema),
    // while the agent works on your notes, look again every few seconds for its push
    refetchInterval: (q) => (q.state.data?.round && !q.state.data.pushed ? 5000 : false),
  });
  const [size, setSize] = useState<PreviewViewport | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const still = useApiImage(r?.still ?? "");
  // the preview's place, until its review arrives
  if (!r) return <Skeleton className="mt-4 h-48 rounded-[var(--radius-tile)]" />;
  const viewport = size ?? r.viewport;

  const act = async (path: string, body: object, then?: () => void) => {
    setBusy(path);
    try {
      qc.setQueryData(queryKey, await post(path, { key, ...body }, PreviewReviewSchema));
      then?.();
      void qc.invalidateQueries({ queryKey: STATE_KEY });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const takeStill = (v: PreviewViewport) => act("/api/preview/still", { viewport: v }, () => setDrafts([]));
  const setNote = (i: number, note: string) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, note } : x)));

  /** A click on the still adds a pin there; Enter or Space (no pointer) adds one at the middle of what's in view. */
  const pinAt = (e: MouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const view = scroller.current;
    const keyboard = e.detail === 0;
    const px = keyboard ? box.width / 2 : e.clientX - box.left;
    const py = keyboard && view ? view.scrollTop + view.clientHeight / 2 : e.clientY - box.top;
    const x = Math.round((px / box.width) * r.width);
    const y = Math.round((py / box.height) * r.height);
    setDrafts((d) => [...d, { x, y, note: "" }]);
  };

  const sent = r.round > 0;
  const checked = r.pins.some((p) => p.after);
  const own = !pr.viewer || pr.viewer === pr.author;
  const sizes = sent ? (
    <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
      {viewport === "wide" ? w.pvWide : w.pvPhone}
    </span>
  ) : (
    <fieldset className="m-0 flex min-w-0 items-center gap-1 border-0 p-0" aria-label={w.pvSize}>
      {(["wide", "phone"] as const).map((v) => (
        <Button
          key={v}
          size="sm"
          variant={viewport === v ? undefined : "outline"}
          aria-pressed={viewport === v}
          disabled={!!busy}
          onClick={() => {
            setSize(v);
            if (r.still && !sent) void takeStill(v);
          }}
        >
          {v === "wide" ? w.pvWide : w.pvPhone}
        </Button>
      ))}
    </fieldset>
  );

  return (
    <section
      id="review-on-preview"
      className="mt-5 flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card/60 p-4"
      aria-label={w.pvTitle}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={SECTION}>{w.pvTitle}</h3>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {sizes}
          <PreviewLink url={r.url} className="hit-area relative text-sm text-primary hover:underline">
            {w.pvOpenTab} ↗
          </PreviewLink>
        </div>
      </div>
      <p className="max-w-[40em] text-sm text-muted-foreground">{w.pvIntro}</p>
      {r.note ? (
        <p role="alert" className="text-sm text-bad">
          {r.note}
        </p>
      ) : null}

      {!sent && !r.still ? (
        // before pinning: the change running (when its site allows a frame), and the way in to pinning
        <div className="flex flex-col gap-3">
          {r.frameable ? (
            <div
              className={cn(
                "overflow-hidden rounded-lg border border-border bg-background",
                viewport === "phone" && "mx-auto w-[390px] max-w-full",
              )}
            >
              <iframe
                src={r.url}
                title={fmt(w.pvLiveLabel, { key })}
                className={cn("block w-full border-0", viewport === "phone" ? "h-[640px]" : "aspect-[16/10]")}
                sandbox="allow-scripts allow-same-origin allow-forms"
                loading="lazy"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{w.pvNoFrame}</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!!busy || !r.url} onClick={() => void takeStill(viewport)}>
              {busy ? w.pvTaking : w.pvPoint}
            </Button>
            <span className="text-xs text-muted-foreground">{w.pvStillWhy}</span>
          </div>
        </div>
      ) : null}

      {!sent && r.still ? (
        // pinning: click the still where something is wrong, then say what should change
        <div className="flex flex-col gap-3">
          <p className="text-sm">{w.pvPinHint}</p>
          <div
            ref={scroller}
            className={cn(
              "max-h-[60vh] overflow-auto rounded-lg border border-border bg-background",
              viewport === "phone" && "mx-auto w-[390px] max-w-full",
            )}
          >
            <button type="button" aria-label={w.pvStillLabel} onClick={pinAt} className="relative block w-full cursor-crosshair">
              {still ? <img src={still} alt="" className="block w-full select-none" draggable={false} /> : null}
              {drafts.map((d, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a pin is its place in the list; removing renumbers the rest
                <Pin key={i} n={i + 1} x={d.x} y={d.y} width={r.width} height={r.height} />
              ))}
            </button>
          </div>
          {drafts.length ? (
            <ol className="flex flex-col gap-3">
              {drafts.map((d, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: as above
                <li key={i} className="grid gap-1.5">
                  <label htmlFor={`pin-note-${i}`} className="text-xs text-muted-foreground">
                    {fmt(w.pvNote, { n: i + 1 })}
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id={`pin-note-${i}`}
                      value={d.note}
                      placeholder={w.pvNoteHint}
                      maxLength={500}
                      autoFocus={i === drafts.length - 1}
                      onChange={(e) => setNote(i, e.target.value)}
                    />
                    <Button variant="ghost" size="sm" onClick={() => setDrafts((x) => x.filter((_, j) => j !== i))}>
                      <span aria-hidden="true">✕</span>
                      <span className="sr-only">{fmt(w.pvRemove, { n: i + 1 })}</span>
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[w.pvChipSmall, w.pvChipColour, w.pvChipText].map((chip) => (
                      <Button key={chip} variant="outline" size="sm" onClick={() => setNote(i, chip)}>
                        {chip}
                      </Button>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!!busy || !drafts.length || drafts.some((d) => !d.note.trim())}
              onClick={() =>
                void act("/api/preview/send", { pins: drafts.map((d) => ({ ...d, note: d.note.trim() })) }, () => {
                  setDrafts([]);
                  toast(fmt(w.pvSaidSent, { key }));
                })
              }
            >
              {drafts.length === 1 ? w.pvSendOne : fmt(w.pvSend, { n: drafts.length })}
            </Button>
            <Button variant="ghost" disabled={!!busy} onClick={() => void takeStill(viewport)}>
              {w.pvRetake}
            </Button>
          </div>
        </div>
      ) : null}

      {sent ? (
        // after sending: where the fix round stands, each spot before (and after), then approve or another note
        <div className="flex flex-col gap-3">
          <p className="text-sm" aria-live="polite">
            {r.pushed ? fmt(w.pvPushed, { n: r.round }) : `${fmt(w.pvSent, { n: r.round })} ${w.pvWaiting}`}
          </p>
          <ol className="grid gap-2">
            {r.pins.map((p) => (
              <Spot key={p.n} p={p} phone={r.viewport === "phone"} />
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            {r.pushed && !checked ? (
              <Button disabled={!!busy} onClick={() => void act("/api/preview/check", {})}>
                {w.pvCheck}
              </Button>
            ) : null}
            {checked ? (
              <>
                {own && !pr.draft ? null : <Button onClick={() => void prReady(key)}>{own ? w.reviewMarkReady : w.reviewApprove}</Button>}
                <Button variant="outline" disabled={!!busy} onClick={() => void takeStill(viewport)}>
                  {w.pvAnother}
                </Button>
              </>
            ) : null}
            <Explain x={explainPr(m.s, tracked, w)} about={key} />
          </div>
          {checked && own && !pr.draft ? <p className="text-xs text-muted-foreground">{w.pvApproveSelf}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
