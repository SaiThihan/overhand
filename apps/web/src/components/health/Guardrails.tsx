import type { Model } from "@/app/data";
import { useWords } from "@/app/theme";
import { fmt, hm } from "@/lib/format";
import { InsightLine } from "../DecisionCard";
import { Muted, Pane } from "../Pane";

/** What the guard blocked agents from doing in the last day: a calm count, then each attempt, its time and the rule. */
export function Guardrails({ m }: { m: Model }) {
  const w = useWords();
  const blocks = m.s.guardrails;
  return (
    <Pane title="paneGuardrails" count={blocks.length}>
      {!blocks.length ? (
        <>
          <Muted>{w.guardNone}</Muted>
          <InsightLine m={m} surface="health" />
        </>
      ) : (
        <>
          <p className="text-sm">{blocks.length === 1 ? w.guardOne : fmt(w.guardMany, { n: blocks.length })}</p>
          <ul className="mt-2 grid gap-2">
            {blocks.map((b) => (
              <li key={`${b.at}-${b.action}`} className="grid gap-0.5 border-t border-border pt-2 text-xs first:border-0 first:pt-0">
                <code className="line-clamp-2 font-mono text-foreground [overflow-wrap:anywhere]" title={b.action}>
                  {b.action}
                </code>
                <span className="text-muted-foreground">
                  {[fmt(w.guardBlockedAt, { at: hm(b.at) }), b.rule, b.run || b.project].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Pane>
  );
}
