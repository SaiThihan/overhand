import { Check } from "lucide-react";
import type { Model } from "@/app/data";
import { useWords } from "@/app/theme";
import { useUi } from "@/app/ui";
import { Button } from "@/components/ui/button";
import { nth } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The Now view before there is a story to tell: what ops does, and the three steps to the first agent run, the next one
 * lit. It disappears once a project exists.
 */
export function FirstRun({ m }: { m: Model }) {
  const w = useWords();
  const ui = useUi();
  // a step counts as done only once the steps before it are: a plan without a project isn't progress
  const facts = [m.s.clients.length > 0, m.s.accounts.length > 0, m.s.plan.length > 0];
  const steps = [w.firstProject, w.firstAccount, w.firstPlan].map((text, i) => ({ text, done: facts.slice(0, i + 1).every(Boolean) }));
  const next = steps.findIndex((s) => !s.done);
  return (
    <section aria-labelledby="first" className="mx-auto grid max-w-2xl gap-6 py-10 lg:py-16">
      <h1 id="first" className="m-enter hud-glow font-display text-3xl font-semibold tracking-wide lg:text-4xl" style={nth(0)}>
        {w.firstTitle}
      </h1>
      <p className="m-enter text-lg text-foreground/85" style={nth(1)}>
        {w.firstBody}
      </p>
      <ol className="grid gap-(--space-gap)">
        {steps.map((s, i) => (
          <li
            key={s.text}
            className={cn("m-enter hud-pane flex-row! items-center gap-4", i !== next && !s.done && "opacity-60")}
            style={nth(i + 2)}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-full border font-mono",
                s.done ? "m-lockon border-ok/60 bg-ok/10 text-ok" : i === next ? "border-primary text-primary" : "border-border",
              )}
            >
              {s.done ? <Check className="m-tick size-4" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn(s.done && "text-muted-foreground line-through decoration-ok/60")}>{s.text}</span>
          </li>
        ))}
      </ol>
      <div className="m-enter" style={nth(5)}>
        <Button variant="outline" size="lg" onClick={() => ui.openDrawer({ kind: "settings" })}>
          {w.firstGo}
        </Button>
      </div>
    </section>
  );
}
