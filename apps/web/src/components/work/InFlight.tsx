import type { Model } from "@/app/data";
import { Term, useWords } from "@/app/theme";
import { useUi } from "@/app/ui";
import { explainPr } from "@/lib/explain";
import { fmt } from "@/lib/format";
import { readyItems } from "@/lib/plan";
import { InsightLine } from "../DecisionCard";
import { PreviewLink } from "../drawers/ReviewDrawer";
import { Explain } from "../Explain";
import { Dot, Muted, Pane } from "../Pane";
import { ShipNote } from "../ShipNote";

/** CI state of an agent PR, as a state colour and its words. */
export function checks(m: Model, url: string) {
  const gh = m.s.status.myPrs.find((x) => x.url === url);
  const c = gh?.checks ?? "";
  if (/FAILURE|ERROR/.test(c)) return { gh, color: "var(--bad)", word: "checksFailing" } as const;
  if (/PENDING|EXPECTED/.test(c)) return { gh, color: "var(--primary)", word: "checksRunning" } as const;
  if (c) return { gh, color: "var(--ok)", word: "checksPass" } as const;
  return { gh, color: "var(--muted-foreground)", word: null } as const;
}

/**
 * The bridge's view of the work: agent PRs with their checks and fix rounds, and what the agents' next pass will start.
 * The full queue, your list and every PR are in the Work view.
 */
export function InFlight({ m }: { m: Model }) {
  const w = useWords();
  const ui = useUi();
  const prs = m.s.prs.slice(0, 4);
  const armed = readyItems(m.plan, m.s);
  // onboarding guides being written: local runs with no ticket, so they'd show nowhere else until their PR opens
  const guides = m.s.guides.filter((g) => g.run === "queued" || g.run === "running");
  return (
    <Pane title="paneInFlight" count={m.s.prs.length + m.armed + guides.length} countTone="var(--primary)" view="work">
      {!prs.length && !armed.length && !guides.length ? (
        <InsightLine
          m={m}
          surface="work"
          fallback={
            <Muted>
              <Term k="emptyInFlight" />
            </Muted>
          }
        />
      ) : null}
      {prs.length ? (
        <ul className="grid gap-1.5">
          {prs.map((p) => {
            const { gh, color, word } = checks(m, p.url);
            return (
              <li key={p.url} data-id={p.key} className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 text-sm">
                <Dot color={color} label={word ? w[word] : undefined} />
                {/* opens the Review drawer: the diff, checks, and ready / request changes / close */}
                <button
                  type="button"
                  className="truncate py-0.5 text-left hover:underline"
                  title={w.review}
                  onClick={() => ui.openDrawer({ kind: "review", key: p.key })}
                >
                  <span className="mr-1.5 font-mono text-xs text-muted-foreground">{p.key}</span>
                  {gh?.title || p.branch || p.url}
                </button>
                <p className="col-start-2 text-xs text-muted-foreground">
                  {p.draft ? <span className="text-warn">{w.reviewDraft} · </span> : null}
                  <ShipNote ship={p.ship} />
                  {word ? <span style={{ color }}>{w[word]} · </span> : null}
                  {p.fixes === 1 ? w.fixRoundsOne : p.fixes ? fmt(w.fixRounds, { n: p.fixes }) : w.noFixRounds}
                  {gh?.review === "CHANGES_REQUESTED" ? ` · ${w.changesRequested}` : ""}
                  <Explain x={explainPr(m.s, p, w)} about={p.key} className="ml-1.5" />
                  {p.preview ? (
                    <>
                      {" · "}
                      <PreviewLink url={p.preview} className="whitespace-nowrap text-primary hover:underline">
                        {w.reviewPreview} ↗
                      </PreviewLink>
                    </>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}
      {guides.length ? (
        <ul className={prs.length ? "mt-3 grid gap-1.5 border-t border-border pt-3" : "grid gap-1.5"}>
          {guides.map((g) => (
            <li key={g.project} className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 text-sm">
              <Dot color="var(--primary)" />
              <button
                type="button"
                className="truncate py-0.5 text-left hover:underline"
                onClick={() => ui.openDrawer({ kind: "guide", project: g.project })}
              >
                {fmt(w.guideInFlight, { project: g.project })}
              </button>
              <p className="col-start-2 text-xs text-muted-foreground">{g.run === "running" ? w.guideRunning : w.guideQueued}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {armed.length ? (
        <div className={prs.length || guides.length ? "mt-3 border-t border-border pt-3" : undefined}>
          <p className="text-xs text-muted-foreground">{fmt(w.armedCount, { n: armed.length })}</p>
          <ul className="mt-1 grid gap-1 text-sm">
            {armed.slice(0, 3).map((a) => (
              <li key={a.i} className="truncate">
                <span className="mr-1.5 font-mono text-xs text-primary">{a.key}</span>
                {a.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Pane>
  );
}
