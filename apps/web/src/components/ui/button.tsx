import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex max-w-full shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // the button hierarchy (docs/design-system.md); index.css draws each level per theme
        /** The one next step on a surface. */
        primary: "hud-btn hud-btn-primary focus-visible:ring-0",
        /** Secondary: anything else that acts. */
        outline: "hud-btn focus-visible:ring-0",
        /** The reply to something that waits on you: the one control in the `you` colour. */
        answer: "hud-btn hud-btn-answer focus-visible:ring-0",
        /** Pause and resume only: `you` means it changes the agents' state. */
        state: "hud-btn hud-btn-state focus-visible:ring-0",
        /** Stopping or removing, always behind a confirm (or a Save). */
        danger: "hud-btn hud-btn-danger focus-visible:ring-0",
        /** Quiet: navigation and reveal, never a change to data. */
        ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "hit-area relative h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "hit-area relative h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "hit-area relative size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "hit-area relative size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

/** A button at one level of the hierarchy: primary, secondary (outline), answer, state, danger, or quiet (ghost, link). */
function Button({
  className,
  variant = "primary",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

/**
 * A small toggle among a few choices (a span, a size, a project): pressed when `on`. A long choice, a project's name,
 * ends in "…" rather than leaving its box, its whole name the title.
 */
function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-pressed={on}
      title={children}
      className="font-sans text-muted-foreground aria-pressed:bg-primary/15 aria-pressed:text-foreground"
      onClick={onClick}
    >
      <span className="truncate">{children}</span>
    </Button>
  );
}

export { Button, Choice };
