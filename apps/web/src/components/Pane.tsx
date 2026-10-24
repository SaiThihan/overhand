import type { WordKey } from "@overhand/themes";
import { ChevronRight } from "lucide-react";
import { type CSSProperties, type ReactNode, useId, useState } from "react";
import { useFocus } from "@/app/focus";
import { Term, useWords } from "@/app/theme";
import { useUi, VIEW_META, type View } from "@/app/ui";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "Open Work": opens the place behind a bridge section, by name, with its keyboard shortcut in the tooltip. */
function SeeAll({ view }: { view: View }) {
  const w = useWords();
  const ui = useUi();
  const { word, key } = VIEW_META[view];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="xs" className="see-all -mr-1 text-muted-foreground" onClick={() => ui.openDrawer({ kind: view })}>
          {fmt(w.openPlace, { name: w[word] })}
          <ChevronRight aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{fmt(w.openView, { name: w[word], key })}</TooltipContent>
    </Tooltip>
  );
}

/**
 * One dashboard panel in the HUD's chamfered glass: a themed title with an optional count, an optional action on the
 * right, and its content. With `view`, it's a section of the bridge whose full view opens from "See all".
 */
export function Pane({
  title,
  extra,
  subtitle,
  count,
  countTone = "var(--muted-foreground)",
  view,
  className,
  dataId,
  children,
}: {
  title: WordKey;
  extra?: ReactNode;
  /** A quiet line under the title, e.g. a count that would crowd the title on a phone. */
  subtitle?: ReactNode;
  /** A badge beside the title; hidden at zero. */
  count?: number;
  /** The badge's colour: the state it counts (amber needs you, red broken). */
  countTone?: string;
  view?: View;
  className?: string;
  /** What the site's pages find this pane by (`data-id`): the home page's live window zooms toward Needs you. */
  dataId?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-id={dataId} className={cn("hud-pane", className)}>
      {/* the subtitle takes the pane's full width under the title row, never squeezed beside its buttons */}
      <header>
        <div className="flex items-start gap-3">
          <h2 id={id} className="flex min-w-0 flex-1 items-center gap-2">
            <Term k={title} />
            {count ? (
              <span className="pane-count" style={{ "--c": countTone } as CSSProperties}>
                {count}
              </span>
            ) : null}
          </h2>
          {extra ? <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">{extra}</div> : null}
          {view ? <SeeAll view={view} /> : null}
        </div>
        {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** Quiet explanatory text, e.g. an empty state. */
export function Muted({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-sm text-muted-foreground", className)}>{children}</p>;
}

/** A small status dot; pulses (and glows, in the themed worlds) when `on`, which means live or working. Colour is any CSS colour. */
export function Dot({ color, on = false, label }: { color: string; on?: boolean; label?: string }) {
  const cls = cn("dot inline-block size-2 shrink-0 rounded-full", on && "m-pulse");
  const style = { background: color, boxShadow: on ? `0 0 8px ${color}` : undefined };
  return label ? (
    <span role="img" aria-label={label} className={cls} style={style} />
  ) : (
    <span aria-hidden="true" className={cls} style={style} />
  );
}

/**
 * The steps on the way to an outcome: shown as they are without Focus; with Focus folded behind a small "Show steps"
 * button that opens the full trail in place. With `when` false there's nothing to fold: no button.
 */
export function Steps({ children, when = true, className }: { children: ReactNode; when?: boolean; className?: string }) {
  const w = useWords();
  const focus = useFocus();
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!focus) return children;
  if (!when) return null;
  return (
    <div className={className}>
      <Button
        variant="ghost"
        size="xs"
        className="-ml-2 text-muted-foreground"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight aria-hidden="true" className={cn("transition-transform", open && "rotate-90")} />
        {open ? w.hideSteps : w.showSteps}
      </Button>
      <div id={id} hidden={!open}>
        {open ? children : null}
      </div>
    </div>
  );
}
