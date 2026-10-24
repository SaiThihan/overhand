import { plainWords } from "@overhand/themes";
import type { CSSProperties } from "react";
import { type Model, useNow } from "@/app/data";
import { useWords } from "@/app/theme";
import { PLACE_WORD, PLACES, type Place, useUi } from "@/app/ui";
import { brokenCount } from "@/lib/alerts";
import { cn } from "@/lib/utils";
import { needs, needsTone } from "./now/Alerts";
import { dayPct, dayTicks, tone } from "./now/DayRibbon";

/** Each place's badge: what needs you on Now, open work, who's working, what's broken. */
function badges(m: Model): Partial<Record<Place, { n: number; c: string }>> {
  const list = needs(m);
  return {
    now: { n: list.length, c: needsTone(list) },
    work: { n: m.s.prs.length + m.armed, c: "var(--primary)" },
    crew: { n: m.s.running.length + m.s.godmode.filter((g) => g.running).length, c: "var(--primary)" },
    health: { n: brokenCount(m.s), c: "var(--bad)" },
  };
}

function Badge({ b }: { b: { n: number; c: string } | undefined }) {
  return b?.n ? (
    <span className="pane-count" style={{ "--c": b.c } as CSSProperties}>
      {b.n}
    </span>
  ) : null;
}

/**
 * The places in the header on a computer: the theme's word for each, with the plain word under it when the theme
 * renames it. Now is the bridge; the others open as drawers over it.
 */
export function PlaceNav({ m }: { m: Model }) {
  const w = useWords();
  const ui = useUi();
  const b = badges(m);
  return (
    <nav aria-label={w.places} className="place-nav hidden shrink-0 items-center gap-0.5 rounded-[10px] border border-border p-0.5 lg:flex">
      {PLACES.map((p) => {
        const k = PLACE_WORD[p];
        const themed = w[k] !== plainWords[k];
        return (
          <button
            key={p}
            type="button"
            aria-current={ui.place === p ? "page" : undefined}
            onClick={() => ui.goPlace(p)}
            className={cn(
              "place-tab hit-area relative flex h-10 items-center gap-1.5 rounded-[8px] px-2.5 text-left text-[13px] leading-tight text-muted-foreground transition-colors duration-(--m-instant) hover:bg-muted hover:text-foreground",
              ui.place === p && "bg-secondary text-foreground",
            )}
          >
            <span className="grid">
              <span className="whitespace-nowrap">{w[k]}</span>
              {themed ? <span className="text-[11px] whitespace-nowrap text-muted-foreground">{plainWords[k]}</span> : null}
            </span>
            <Badge b={b[p]} />
          </button>
        );
      })}
    </nav>
  );
}

/**
 * The phone's bottom bar (below 1024px): the five places as real tabs, each with its badge. Its top edge is the day so
 * far, dotted with the day's events.
 */
export function PlaceBar({ m }: { m: Model }) {
  const w = useWords();
  const ui = useUi();
  const now = useNow(60_000);
  const b = badges(m);
  return (
    <nav
      aria-label={w.places}
      className="jump-bar m-enter fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      {/* the day line: how far through the day, and a dot at each event. Only a picture: as a control it was an
          invisible strip over the page's content, catching taps meant for what scrolls behind it */}
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 -translate-y-px bg-border">
        <span className="absolute inset-0 origin-left bg-primary/70" style={{ transform: `scaleX(${dayPct(now) / 100})` }} />
        {dayTicks(m.s.reports).map((t) => (
          <span
            key={t.at}
            className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${t.at}%`, background: tone(t.line) }}
          />
        ))}
      </span>
      <div className="relative grid grid-cols-5">
        {/* the indicator: slides to the open tab */}
        <span
          aria-hidden="true"
          className="absolute top-0 left-0 h-0.5 w-1/5 transition-transform duration-(--m-base) ease-(--m-arrive)"
          style={{ transform: `translateX(${PLACES.indexOf(ui.place) * 100}%)` }}
        >
          <span className="mx-auto block h-full w-8 rounded-full bg-primary" />
        </span>
        {PLACES.map((p) => {
          const k = PLACE_WORD[p];
          const themed = w[k] !== plainWords[k];
          return (
            <button
              key={p}
              type="button"
              aria-current={ui.place === p ? "page" : undefined}
              onClick={() => ui.goPlace(p)}
              className={cn(
                "relative flex h-14 min-w-0 flex-col items-center justify-center px-0.5 short:h-11 text-[12.5px] leading-tight text-muted-foreground transition-colors duration-(--m-instant)",
                ui.place === p && "font-medium text-foreground",
              )}
            >
              <span className="max-w-full truncate">{w[k]}</span>
              <span className="flex h-[18px] max-w-full items-center gap-1 short:hidden">
                {themed ? <span className="truncate text-[11px] font-normal text-muted-foreground">{plainWords[k]}</span> : null}
                <Badge b={b[p]} />
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
