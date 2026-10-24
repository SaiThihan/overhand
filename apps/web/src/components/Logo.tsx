import { markParts } from "@overhand/themes";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Overhand's mark, Hand over (packages/themes/src/brand.ts): the work, an outline square in ink 12, and you, the
 * signal-orange square lifted over it. Drawn in whole pixels from `markParts`, in the page's own ink, so it follows
 * light and dark. `moving` is the loader: your square slides over the work and back (index.css, `.m-handover`).
 */
export function BrandMark({ size = 20, moving = false, className }: { size?: number; moving?: boolean; className?: string }) {
  const p = markParts(size);
  const h = p.stroke / 2;
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0 overflow-visible", className)}
      style={{ "--lift": `${p.lift}px` } as CSSProperties}
    >
      <rect
        x={h}
        y={p.lift + h}
        width={p.side - p.stroke}
        height={p.side - p.stroke}
        strokeWidth={p.stroke}
        style={{ fill: "none", stroke: "var(--ink-12)" }}
      />
      <rect
        x={p.lift}
        y={0}
        width={p.side}
        height={p.side}
        className={moving ? "m-handover" : undefined}
        style={{ fill: "var(--you-fill)" }}
      />
    </svg>
  );
}

/**
 * The lockup: the mark, then "Overhand" in Atkinson Hyperlegible Next Bold at -0.02em. The work square is one cap
 * height and stands on the baseline (a 19px mark, squares of 13, beside 19px type, cap height 12.7), so you rise above
 * the letters; the gap is one lift.
 * Fixed colour and face in every world, so the brand reads the same everywhere.
 */
export function Logo({ wordmark = true, size = 19 }: { wordmark?: boolean; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-baseline" style={{ gap: markParts(size).lift }}>
      <BrandMark size={size} />
      {wordmark ? (
        <span
          data-brand=""
          className="hidden leading-none font-bold tracking-[-0.02em] text-foreground sm:inline"
          style={{ fontSize: size }}
        >
          Overhand
        </span>
      ) : null}
    </span>
  );
}
