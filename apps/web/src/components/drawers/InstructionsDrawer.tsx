import { comboLabel, type InstructionFile, type ProjectInstructions } from "@overhand/contract";
import { ExternalLink } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Model } from "@/app/data";
import { useWords } from "@/app/theme";
import { Button, Choice } from "@/components/ui/button";
import { ago, fmt } from "@/lib/format";
import { checkText, names, summary } from "@/lib/instructions";
import { nth } from "@/lib/motion";
import { Dot, Muted } from "../Pane";
import { DrawerHead } from "./DrawerHost";

/** A rule as written, with its `code` spans and **bold** drawn as such; the words are never changed. */
function Verbatim({ text }: { text: string }) {
  const parts: ReactNode[] = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((s, i) =>
    s.startsWith("`") && s.endsWith("`") && s.length > 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one fixed string
      <code key={i} className="rounded bg-muted px-1 font-mono text-[max(11px,0.9em)]">
        {s.slice(1, -1)}
      </code>
    ) : s.startsWith("**") && s.endsWith("**") && s.length > 4 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one fixed string
      <strong key={i} className="font-semibold">
        {s.slice(2, -2)}
      </strong>
    ) : (
      s
    ),
  );
  return <>{parts}</>;
}

/** One instruction file: who reads it, then its sections and rules as written. */
function FileCard({ f, showRepo }: { f: InstructionFile; showRepo: boolean }) {
  const w = useWords();
  const readBy = f.readers.length ? fmt(w.instReadBy, { names: names(f.readers) }) : w.instReadByNone;
  const meta = [
    readBy,
    f.also ? fmt(w.instAlso, { names: f.also }) : "",
    f.tracked ? fmt(w.instChanged, { ago: ago(f.changedAt) }) : w.instNotCommitted,
  ];
  return (
    <details open className="group rounded-lg border border-border bg-background/40 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-foreground">{showRepo ? `${f.repo}/${f.path}` : f.path}</p>
          <p className="text-xs text-muted-foreground">{meta.filter(Boolean).join(" · ")}</p>
        </div>
        {f.url ? (
          <Button asChild variant="ghost" size="xs" className="shrink-0 text-muted-foreground">
            <a href={f.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
              {w.instOpen}
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        ) : null}
      </summary>
      <div className="mt-2 grid gap-3">
        {f.sections.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: sections in file order; headings may repeat
          <section key={i}>
            {s.heading ? <h4 className="mb-1 text-sm font-medium">{s.heading}</h4> : null}
            {s.items.length ? (
              <ul className="grid gap-1 text-sm leading-relaxed">
                {s.items.map((r, j) =>
                  r.rule ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: lines in file order; the same words may repeat
                    <li key={j} className="flex gap-2" style={{ paddingLeft: `${r.depth * 16}px` }}>
                      <span aria-hidden="true" className="text-muted-foreground">
                        –
                      </span>
                      <span className="min-w-0 break-words">
                        <Verbatim text={r.text} />
                      </span>
                    </li>
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: lines in file order; the same words may repeat
                    <li key={j} className="text-xs break-words text-muted-foreground">
                      <Verbatim text={r.text} />
                    </li>
                  ),
                )}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </details>
  );
}

/** One project: its line, what's worth a look, and each file. */
function ProjectBlock({ p, color }: { p: ProjectInstructions; color: string }) {
  const w = useWords();
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="font-display text-base" style={{ color }}>
          {p.project}
        </h3>
        <p className="text-sm text-muted-foreground">{p.repos.length ? (p.files.length ? summary(w, p) : w.instEmpty) : w.instNoRepos}</p>
      </div>
      {p.checks.length ? (
        <div className="grid gap-2">
          <h4 className="text-sm font-medium">{w.instChecks}</h4>
          <ul className="grid gap-2 text-sm">
            {p.checks.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: checks in a fixed order
              <li key={i} className="grid grid-cols-[auto_1fr] items-baseline gap-2">
                <Dot color={c.kind === "stale" ? "var(--muted-foreground)" : "var(--warn)"} />
                <div className="min-w-0">
                  <p>{checkText(w, c)}</p>
                  {c.kind === "conflict" ? (
                    <div className="mt-1 grid gap-1 text-xs text-muted-foreground">
                      {[c.a, c.b].map((s) => (
                        <p key={s.path} className="break-words">
                          <span className="font-mono">{s.path}</span>: “<Verbatim text={s.rule} />”
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {c.kind === "unread" && c.suggest ? (
                    <p className="mt-1 text-xs text-primary">
                      {fmt(w.instSuggest, { from: c.suggest.from, to: c.suggest.to, runtime: comboLabel(c.runtime) })}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid gap-2">
        {p.files.map((f) => (
          <FileCard key={`${f.repo}/${f.path}`} f={f} showRepo={p.repos.length > 1} />
        ))}
      </div>
    </section>
  );
}

/** Each project's agent instruction files, rules shown exactly as written, with deterministic checks. Read-only. */
export function InstructionsDrawer({ m, project }: { m: Model; project?: string }) {
  const w = useWords();
  const list = m.s.instructions;
  const [only, setOnly] = useState(project ?? "");
  const shown = list.filter((p) => !only || p.project === only);
  return (
    <>
      <DrawerHead kicker={w.brand} named="instTitle" />
      {list.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {[{ id: "", label: w.instAllProjects }, ...list.map((p) => ({ id: p.project, label: p.project }))].map((c) => (
            <Choice key={c.id} on={only === c.id} onClick={() => setOnly(c.id)}>
              {c.label}
            </Choice>
          ))}
        </div>
      ) : null}
      <Muted className="mt-2 text-xs">{w.instVerbatim}</Muted>
      {shown.length ? (
        <div className="m-stagger mt-4 grid gap-6">
          {shown.map((p, i) => (
            <div key={p.project} style={nth(Math.min(i, 12))}>
              <ProjectBlock p={p} color={m.hue(p.project)} />
            </div>
          ))}
        </div>
      ) : (
        <Muted className="mt-4">{w.instNone}</Muted>
      )}
    </>
  );
}
