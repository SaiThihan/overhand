import type { Model } from "@/app/data";
import { useWords } from "@/app/theme";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { hubs } from "./model";
import { useTeamUi } from "./store";

/**
 * Who's here, in the header from 1024px wide (on a phone the bar has no room for it): up to three teammates online as
 * initials and a count of the rest; click one to follow them (Now shows their map).
 */
export function Facepile({ m }: { m: Model }) {
  const w = useWords();
  const ui = useTeamUi();
  const t = m.s.team;
  if (!t) return null;
  const here = hubs(t).filter((h) => !h.me && h.online);
  if (!here.length) return null;
  // three faces and a count: enough to say who is here, and the bar still fits at 1024
  const shown = here.slice(0, 3);
  return (
    <ul aria-label={w.teamHere} className="hidden shrink-0 items-center gap-1 lg:flex">
      {shown.map((h) => {
        const following = ui.follow === h.user;
        return (
          <li key={h.user}>
            <button
              type="button"
              aria-pressed={following}
              title={fmt(following ? w.teamStopFollow : w.teamFollow, { name: h.name })}
              aria-label={fmt(following ? w.teamStopFollow : w.teamFollow, { name: h.name })}
              onClick={() => ui.setFollow(following ? null : h.user)}
              className={cn(
                "hit-area relative grid size-7 place-items-center rounded-full border-2 border-background bg-muted text-[11px] font-medium",
                following && "ring-2 ring-primary",
                h.quiet && "opacity-60",
              )}
            >
              {h.initials}
            </button>
          </li>
        );
      })}
      {here.length > shown.length ? <li className="pl-1 text-xs text-muted-foreground">+{here.length - shown.length}</li> : null}
    </ul>
  );
}
