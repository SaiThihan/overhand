import { type Worktree, WorktreesSchema, workId } from "@overhand/contract";
import type { WordKey } from "@overhand/themes";
import { useQuery } from "@tanstack/react-query";
import type { Model } from "@/app/data";
import { useWords } from "@/app/theme";
import { useUi } from "@/app/ui";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { get } from "@/lib/api";
import { ago, fmt, size } from "@/lib/format";
import { byUse, placeName, worktreeFallback } from "@/lib/leads";
import { leadName } from "@/lib/sessions";
import { Dot, Muted, Pane } from "../Pane";
import { Rename } from "../Rename";

const WHO_WORDS = { you: "kindYou", agent: "kindAgent", lead: "kindLead", subagent: "kindSubagent" } as const satisfies Record<
  Worktree["who"][number]["kind"],
  WordKey
>;
const PR_WORDS: Record<string, WordKey> = {
  OPEN: "prStateOpen",
  DRAFT: "prStateDraft",
  MERGED: "prStateMerged",
  CLOSED: "prStateClosed",
};

/** One worktree: its name (yours first), branch and repo, who's in it, its PR, last change, size, and Cleanup's offer. */
function Row({ m, project, wt }: { m: Model; project: string; wt: Worktree }) {
  const w = useWords();
  const ui = useUi();
  const name = placeName(m.s, { project, branch: wt.branch, vocab: wt.words, fallback: worktreeFallback(wt, w) });
  const pr = PR_WORDS[wt.prState];
  const facts = [
    wt.branch || w.worktreeDetached,
    wt.repo,
    fmt(w.worktreeChanged, { t: ago(wt.usedAt) }),
    wt.kb >= 0 ? size(wt.kb) : "",
  ].filter(Boolean);
  return (
    <li className="grid min-w-0 gap-0.5 border-b border-border py-2 text-sm last:border-0">
      <div className="flex min-w-0 items-center gap-2">
        <Dot color={wt.who.length ? "var(--ok)" : "var(--muted-foreground)"} on={wt.who.length > 0} />
        {wt.branch && !wt.main ? (
          <Rename id={workId(project, wt.branch)} name={name}>
            <span className="truncate font-medium">{name}</span>
          </Rename>
        ) : (
          <span className="truncate font-medium">{name}</span>
        )}
        {pr && wt.pr ? (
          <a className="hit-area relative shrink-0 text-xs text-primary hover:underline" href={wt.pr} target="_blank" rel="noreferrer">
            {w[pr]}
          </a>
        ) : null}
      </div>
      <p className="truncate pl-4 text-xs text-muted-foreground">{facts.join(" · ")}</p>
      <p className="pl-4 text-xs [overflow-wrap:anywhere]">
        {wt.who.length ? (
          wt.who
            .map((x) => {
              // a lead goes by the name Crew gives it, yours first
              const g = x.kind === "lead" ? m.s.godmode.find((l) => l.label === x.label) : undefined;
              return [w[WHO_WORDS[x.kind]], g ? leadName(g, m.s.names) : x.label].filter(Boolean).join(": ");
            })
            .join(", ")
        ) : (
          <span className="text-muted-foreground">{w.worktreeNobody}</span>
        )}
      </p>
      {wt.cleanup ? (
        <p className="flex flex-wrap items-center gap-x-2 pl-4 text-xs text-muted-foreground">
          {fmt(w.worktreeCleanup, { why: wt.cleanup })}
          <Button variant="ghost" size="xs" onClick={() => ui.openDrawer({ kind: "sweep" })}>
            {w.sweep}
          </Button>
        </p>
      ) : null}
    </li>
  );
}

/** A project's worktrees, yours and the agents', the main checkout first, then the ones someone works in. */
export function Worktrees({ m, project }: { m: Model; project: string }) {
  const w = useWords();
  const { data, isPending } = useQuery({
    queryKey: ["worktrees"],
    queryFn: () => get("/api/worktrees", WorktreesSchema),
    refetchInterval: 120_000,
  });
  const list = byUse(data?.projects[project] ?? []);
  return (
    <Pane title="paneWorktrees" subtitle={w.worktreesHint} count={list.length}>
      {isPending ? (
        <SkeletonRows rows={3} />
      ) : list.length ? (
        <ul className="grid">
          {list.map((wt) => (
            <Row key={wt.path} m={m} project={project} wt={wt} />
          ))}
        </ul>
      ) : (
        <Muted>{w.worktreesNone}</Muted>
      )}
    </Pane>
  );
}
