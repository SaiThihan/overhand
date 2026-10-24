import type { Corner } from "@overhand/contract";
import { useWords } from "@/app/theme";
import { cornerWord } from "@/lib/corners";
import { cn } from "@/lib/utils";
import { Dot } from "../Pane";

/**
 * "Check before merging": the corners the PR's diff may have cut, each quoting its line. Calm: amber marks only the
 * findings worth looking at before a merge; nothing when the diff is clean.
 */
export function Corners({ corners }: { corners: Corner[] }) {
  const w = useWords();
  if (!corners.length) return null;
  const blocking = corners.some((c) => c.severity === "block");
  return (
    <section
      className={cn("mt-4 rounded-lg border bg-background/40 p-3", blocking ? "border-warn/50" : "border-border")}
      aria-label={w.cornersTitle}
    >
      <h3 className="text-sm font-semibold">{w.cornersTitle}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{w.cornersIntro}</p>
      <ul className="mt-2 grid gap-2">
        {corners.map((c) => (
          <li key={`${c.kind}-${c.file}-${c.line}-${c.text}`} className="grid gap-1 text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2">
              <Dot
                color={c.severity === "block" ? "var(--warn)" : "var(--muted-foreground)"}
                label={c.severity === "block" ? w.cornersBlock : w.cornersWarn}
              />
              <span>{cornerWord(w, c.kind)}</span>
              <span className="min-w-0 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {c.line ? `${c.file}:${c.line}` : c.file}
              </span>
            </div>
            {c.text ? (
              <code
                className={cn(
                  "ml-4 grid grid-cols-[1rem_1fr] rounded px-2 py-1 font-mono text-xs",
                  c.sign === "+" ? "bg-ok/10" : "bg-bad/10",
                )}
              >
                <span aria-hidden="true" className={c.sign === "+" ? "text-ok" : "text-bad"}>
                  {c.sign === "+" ? "+" : "−"}
                </span>
                <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{c.text}</span>
              </code>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
