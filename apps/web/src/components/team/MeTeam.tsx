import { teamBrief } from "@overhand/contract";
import type { ReactNode } from "react";
import type { Model } from "@/app/data";
import { useWords } from "@/app/theme";
import { cn } from "@/lib/utils";
import { useTeamUi } from "./store";
import { TeamView } from "./TeamView";

/**
 * Now's centre with a team: a Me / Team switch above it, and either your own view (`mine`) or the Team view. Without a
 * team it's just `mine`, unchanged.
 */
export function MeTeam({ m, mine }: { m: Model; mine: ReactNode }) {
  const w = useWords();
  const ui = useTeamUi();
  const t = m.s.team;
  if (!t) return mine;
  const team = ui.view === "team";
  const tab = (on: boolean, label: string, to: "me" | "team") => (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => ui.setView(to)}
      className={cn(
        "hit-area relative h-7 px-3 text-[12.5px] font-medium",
        on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
  return (
    <>
      <fieldset
        aria-label={w.teamSwitch}
        className="team-switch flex w-fit self-center divide-x divide-border overflow-hidden rounded-md border border-foreground"
      >
        {tab(!team, w.teamMe, "me")}
        {tab(team, w.teamTitle, "team")}
      </fieldset>
      {team ? (
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <TeamView m={m} brief={teamBrief(t, m.s.now)} />
        </div>
      ) : (
        mine
      )}
    </>
  );
}
