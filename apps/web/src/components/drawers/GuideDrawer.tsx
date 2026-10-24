import { GUIDE_FILE } from "@overhand/contract";
import { ExternalLink, RefreshCw, Share2 } from "lucide-react";
import { useMemo } from "react";
import { useActions } from "@/app/actions";
import type { Model } from "@/app/data";
import { useWords } from "@/app/theme";
import { useUi } from "@/app/ui";
import { Button } from "@/components/ui/button";
import { ago, fmt } from "@/lib/format";
import { driftLine, guideStatus } from "@/lib/guide";
import { parseMarkdown, sectionCount } from "@/lib/markdown";
import { InlineMd, Markdown } from "../Markdown";
import { Dot, Muted } from "../Pane";
import { DrawerHead } from "./DrawerHost";

/**
 * A project's onboarding guide, verbatim and read-only: from the default branch, or the open guide PR's branch while
 * there is one (it says which), or a watch run's report. Only the frame speaks in the theme's voice.
 */
export function GuideDrawer({ m, project }: { m: Model; project: string }) {
  const w = useWords();
  const ui = useUi();
  const { guideRun, guideShare } = useActions();
  const g = m.s.guides.find((x) => x.project === project);
  // relative links in the guide resolve against its folder on the code host
  const base = g?.source === "default" && g.share.endsWith(`/${GUIDE_FILE}`) ? g.share.slice(0, -GUIDE_FILE.length) : "";
  const blocks = useMemo(() => parseMarkdown(g?.text ?? "", base), [g?.text, base]);
  const busy = g?.run === "queued" || g?.run === "running";
  const from =
    g?.source === "default"
      ? fmt(w.guideFromDefault, { branch: g.branch })
      : g?.source === "pr"
        ? fmt(w.guideFromPr, { branch: g.branch })
        : g?.source === "report"
          ? w.guideFromReport
          : "";
  return (
    <>
      <DrawerHead kicker={project} named="guideTitle" color={m.hue(project)} />
      {g?.text ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {[g.repo ? `${g.repo}/${GUIDE_FILE}` : GUIDE_FILE, fmt(w.guideSummary, { sections: sectionCount(blocks), ago: ago(g.at) })].join(
            " · ",
          )}
        </p>
      ) : null}
      {from ? <p className="mt-1 text-xs text-muted-foreground">{from}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {g?.prKey ? (
          <Button variant="primary" size="sm" onClick={() => ui.openDrawer({ kind: "review", key: g.prKey })}>
            {w.guideReview}
          </Button>
        ) : (
          <Button variant={g?.text ? "outline" : "primary"} size="sm" disabled={busy || !g?.repo} onClick={() => guideRun(project)}>
            <RefreshCw aria-hidden="true" />
            {g?.text ? w.guideRefresh : w.guideWrite}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={!g?.share}
          title={g?.share ? g.share : w.guideShareNone}
          onClick={() => g?.share && guideShare(g.share)}
        >
          <Share2 aria-hidden="true" />
          {w.guideShare}
        </Button>
        {g?.share ? (
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <a href={g.share} target="_blank" rel="noopener noreferrer">
              {w.guideOpen}
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        ) : null}
      </div>
      {g?.text && !g.share ? <Muted className="mt-2 text-xs">{w.guideShareNone}</Muted> : null}
      {g && (busy || g.run === "failed") ? (
        <p className="mt-3 flex items-baseline gap-2 text-sm" role="status">
          <Dot color={g.run === "failed" ? "var(--bad)" : "var(--primary)"} />
          {guideStatus(w, g)}
        </p>
      ) : null}
      {g?.drift.length ? (
        <div className="mt-3 grid gap-1 rounded-lg border border-border bg-background/40 px-3 py-2 text-sm" role="status">
          <p className="flex items-baseline gap-2">
            <Dot color="var(--warn)" />
            <span>{w.guideStaleHead}</span>
          </p>
          <ul className="ml-4 grid gap-0.5 text-muted-foreground">
            {g.drift.map((d) => (
              <li key={`${d.kind}${d.said}`} className="break-words">
                <InlineMd text={driftLine(w, d)} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-4">
        {blocks.length ? (
          <article className="rounded-lg border border-border bg-background/40 p-4">
            <Markdown blocks={blocks} />
          </article>
        ) : (
          <Muted>{g?.repo === "" ? w.instNoRepos : w.guideEmpty}</Muted>
        )}
      </div>
      {blocks.length ? <Muted className="mt-2 text-xs">{w.guideVerbatim}</Muted> : null}
    </>
  );
}
