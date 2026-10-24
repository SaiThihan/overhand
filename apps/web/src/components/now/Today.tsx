import { useActions } from "@/app/actions";
import type { Model } from "@/app/data";
import { Named, Term } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { Muted, Pane } from "../Pane";

/** The planner's top three for today; the first one stands out. Before there's a plan, the button that makes one. */
export function Today({ m }: { m: Model }) {
  const { run } = useActions();
  const top = m.plan.top;
  return (
    <Pane title="paneToday">
      {top.length ? (
        <ol className="grid gap-2">
          {top.map((t, i) => (
            <li key={t} className="flex gap-2.5 text-sm first:text-base first:text-foreground">
              <span className="font-mono text-primary" aria-hidden="true">
                {i + 1}
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{t}</span>
            </li>
          ))}
        </ol>
      ) : (
        // the empty state names its one next step, so it carries the button for it
        <div className="grid justify-items-start gap-2">
          <Muted>
            <Term k="emptyToday" />
          </Muted>
          <Button variant="outline" size="sm" onClick={() => void run({ name: "plan" })}>
            <Named k="planDay" inline />
          </Button>
        </div>
      )}
    </Pane>
  );
}
