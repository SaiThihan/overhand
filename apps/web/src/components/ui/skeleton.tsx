import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A grey block from the ink scale in the shape of what's loading: ink 6 on paper, ink 5 on dark (a step lighter reads
 * the same against a dark pane). It holds still: nothing moves while a pane waits.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("h-4 rounded-[var(--radius-dot)] bg-(--ink-6) dark:bg-(--ink-5)", className)}
      {...props}
    />
  );
}

/** How long each line is, so a stack of them reads as text rather than bars. */
const LINES = [92, 74, 84, 62, 88, 70];

/**
 * A loading pane's content: `rows` skeleton lines (up to six), each `row` tall, where a list or a block of text will
 * be. `label` is the pane's plain words for a screen reader; leave it out when the pane already says it (in words, or
 * with aria-busy under its title).
 */
function SkeletonRows({ label, rows = 3, row, className }: { label?: string; rows?: number; row?: string; className?: string }) {
  return (
    <div role={label ? "status" : undefined} className={cn("grid gap-2.5", className)}>
      {label ? <span className="sr-only">{label}</span> : null}
      {LINES.slice(0, rows).map((w) => (
        <Skeleton key={w} className={row} style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export { Skeleton, SkeletonRows };
