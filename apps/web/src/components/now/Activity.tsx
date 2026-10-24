import { type CSSProperties, useState } from "react";
import type { Model } from "@/app/data";
import { outcomeBeats, useFocus } from "@/app/focus";
import { Term, useWords } from "@/app/theme";
import { useUi } from "@/app/ui";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { type Beat, type BeatTone, beats } from "@/lib/beats";
import { leadNamed, withNames } from "@/lib/sessions";
import { cn } from "@/lib/utils";
import { Muted, Pane, Steps } from "../Pane";

export const TONE: Record<BeatTone, string> = {
  ok: "var(--ok)",
  bad: "var(--bad)",
  warn: "var(--warn)",
  info: "var(--primary)",
  quiet: "var(--muted-foreground)",
};

/** How many beats a phone shows before "Show all": the long one-screen layout stays short. */
const PHONE_BEATS = 5;

/** Beats on a thread, newest first; with `clip`, a phone hides all but the latest few. */
function Thread({ m, story, clip }: { m: Model; story: Beat[]; clip: boolean }) {
  // the newest beat pulses only while something works: a pulse left on all night cost CPU and meant nothing
  const live = m.s.running.length > 0 || m.s.godmode.some((g) => g.running);
  return (
    <ol className="relative text-[13px] before:absolute before:top-2 before:bottom-2 before:left-[3px] before:w-px before:bg-linear-to-b before:from-primary/60 before:to-primary/5">
      {story.map((b, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: beats can repeat
          key={`${b.time}-${b.text}-${i}`}
          className={cn(
            "relative py-1.5 pl-4 leading-snug",
            b.tone === "quiet" ? "text-muted-foreground" : "text-foreground/85",
            i === 0 && "text-foreground",
            b.count > 1 && "my-1 border border-(--c)/40 bg-(--c)/8 py-2 pr-2 text-foreground",
            clip && i >= PHONE_BEATS && "max-md:hidden",
          )}
          style={{ "--c": TONE[b.tone] } as CSSProperties}
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-[0.65rem] left-0 size-[7px] rounded-full bg-(--c) shadow-[0_0_8px_var(--c)]",
              i === 0 && live && "m-pulse",
            )}
          />
          <time className="mr-2 font-mono text-xs text-muted-foreground tabular-nums">{b.time}</time>
          <BeatText m={m} b={b} />
        </li>
      ))}
    </ol>
  );
}

/** A beat's sentence; a lead that failed or crashed opens its log, which says why. */
function BeatText({ m, b }: { m: Model; b: Beat }) {
  const ui = useUi();
  const text = withNames(b.text, m.s.godmode, m.s.names);
  const lead = b.tone === "bad" && b.who ? leadNamed(m.s.godmode, m.s.names, b.who) : undefined;
  if (!lead) return <span className="[overflow-wrap:anywhere]">{text}</span>;
  return (
    <button
      type="button"
      className="text-left underline decoration-(--c)/60 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-(--c)"
      onClick={() => ui.openDrawer({ kind: "lead", key: lead.key })}
    >
      {text}
    </button>
  );
}

/**
 * The day so far as story beats on a thread, newest first; a restart loop is one loud beat, not a wall of lines. A phone
 * shows the latest five and opens the rest in a sheet. With Focus, the thread holds the outcomes (results, anything
 * broken, a loop) and the steps between them open under it.
 */
export function Activity({ m, className }: { m: Model; className?: string }) {
  const w = useWords();
  const [all, setAll] = useState(false);
  const focus = useFocus();
  const story = beats(m.s.reports).reverse().slice(0, 80);
  // Focus keeps the outcomes on the thread; the steps between them open under it
  const kept = outcomeBeats(story);
  const steps = story.filter((b) => !kept.includes(b));
  return (
    <Pane title="paneActivity" className={className}>
      {focus && story.length ? (
        <>
          {kept.length ? <Thread m={m} story={kept} clip={false} /> : null}
          <Steps when={steps.length > 0} className={kept.length ? "mt-2" : undefined}>
            <Thread m={m} story={steps} clip={false} />
          </Steps>
        </>
      ) : story.length ? (
        <>
          <Thread m={m} story={story} clip />
          {story.length > PHONE_BEATS ? (
            <Button variant="outline" size="sm" className="mt-2 w-full md:hidden" onClick={() => setAll(true)}>
              {w.showAll} ({story.length})
            </Button>
          ) : null}
          <Sheet open={all} onOpenChange={setAll}>
            <SheetContent
              side="bottom"
              className="max-h-[88dvh] gap-0 overflow-y-auto rounded-t-2xl bg-popover p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
            >
              <SheetHeader className="px-0 pt-0">
                <SheetTitle className="font-display text-xl">
                  <Term k="paneActivity" />
                </SheetTitle>
                <SheetDescription className="sr-only">{w.paneActivity}</SheetDescription>
              </SheetHeader>
              <div className="mt-3">
                <Thread m={m} story={story} clip={false} />
              </div>
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <Muted>
          <Term k="emptyActivity" />
        </Muted>
      )}
    </Pane>
  );
}
