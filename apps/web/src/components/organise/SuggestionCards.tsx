import { useModel } from "@/app/data";
import { useWords } from "@/app/theme";
import { DecisionCard } from "@/components/DecisionCard";
import { Button } from "@/components/ui/button";
import { useOrganiseActions, useSuggestions, useUndoLogs } from "@/lib/organise";

/**
 * The organising suggestions, each a decision card (what, why, the recommendation, its options, what happens if you do
 * nothing), and the recent disk changes with Undo and, for clones set aside, Free the space.
 */
export function SuggestionCards() {
  const w = useWords();
  const m = useModel();
  const q = useSuggestions();
  const undo = useUndoLogs();
  const act = useOrganiseActions();
  const cards = q.data?.suggestions ?? [];
  const logs = undo.data?.logs ?? [];
  return (
    <section className="grid gap-3" aria-labelledby="organise-suggestions">
      <h3 id="organise-suggestions" className="font-display text-xs tracking-widest text-muted-foreground uppercase">
        {w.orgSuggestions}
      </h3>
      {q.isSuccess && !cards.length ? <p className="text-sm text-muted-foreground">{w.orgNoSuggestions}</p> : null}
      {m === undefined ? null : cards.map((b) => <DecisionCard key={b.id} m={m} item={b.id} />)}
      {logs.length ? (
        <div className="grid gap-1.5">
          <h4 className="font-display text-xs tracking-widest text-muted-foreground uppercase">{w.orgUndoTitle}</h4>
          {logs.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{l.what}</span>
              <span className="flex gap-1">
                <Button size="xs" variant="outline" onClick={() => void act.undo(l.id)}>
                  {w.orgUndo}
                </Button>
                {l.id.startsWith("dedupe-") ? (
                  <Button size="xs" variant="ghost" onClick={() => void act.free(l.id)}>
                    {w.orgFree}
                  </Button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
