import { useWords } from "@/app/theme";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Explained } from "@/lib/explain";
import { cn } from "@/lib/utils";

/**
 * The one way to ask "what does this mean?": a small round ? beside an engineering fact, opening a plain sentence about
 * this case and what to do. A popover, not a tooltip, so a tap on a phone and Enter on a keyboard open it too.
 */
export function Explain({ x, about, className }: { x: Explained; about: string; className?: string }) {
  const w = useWords();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${w.explain} ${about}`}
          title={w.explain}
          className={cn(
            "hit-area relative inline-grid size-[18px] shrink-0 place-items-center rounded-full border border-border bg-background align-middle font-sans text-[11px] leading-none font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            className,
          )}
          // inside a card that opens on click, asking what something means mustn't also open the card
          onClick={(e) => e.stopPropagation()}
        >
          ?
        </button>
      </PopoverTrigger>
      <PopoverContent
        collisionPadding={12}
        className="grid w-80 max-w-[calc(100vw-2rem)] gap-2 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <p>{x.says}</p>
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">{w.explainTodo}:</span> {x.todo}
        </p>
      </PopoverContent>
    </Popover>
  );
}
