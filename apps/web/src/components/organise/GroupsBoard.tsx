import type { GroupView } from "@overhand/contract";
import { type ReactNode, useState } from "react";
import { useWords } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { fmt } from "@/lib/format";
import { LEVEL_WORDS } from "@/lib/leads";
import { useOrganise, useOrganiseActions } from "@/lib/organise";
import { cn } from "@/lib/utils";
import { GroupRulesForm, LeadScopePicker } from "./GroupControls";

type Member = GroupView["members"][number];

/** The drag payload's type, so only project chips drop on a group. */
const DRAG = "application/x-overhand-project";

/**
 * Settings → Projects: every group as a column of its projects, dragged between groups (or into "Not in a group"), with
 * the group's rules and lead scope under it. Each chip also has a Move to menu, so nothing needs a mouse.
 */
export function GroupsBoard() {
  const w = useWords();
  const q = useOrganise();
  const act = useOrganiseActions();
  const [fresh, setFresh] = useState("");
  if (!q.data)
    // the board's shape: two columns of groups
    return <SkeletonRows label={w.orgLoading} rows={4} row="h-24 rounded-[var(--radius-tile)]" className="gap-3 md:grid-cols-2" />;
  const { groups, loose } = q.data;
  const names = groups.map((g) => g.name);
  return (
    <section className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((g) => (
          <Column key={g.name} title={g.name} target={g.name} members={g.members} names={names} onMove={act.move}>
            <GroupRulesForm group={g} />
            <LeadScopePicker group={g} />
          </Column>
        ))}
        <Column title={w.orgLoose} target="" members={loose} names={names} onMove={act.move} />
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const first = loose[0];
          // a group exists through its members: the new one starts with the first loose project, or stays a name to drop on
          if (fresh.trim() && first) void act.move(first.name, fresh.trim());
          setFresh("");
        }}
      >
        <Input
          aria-label={w.orgNewGroupName}
          placeholder={w.orgNewGroupName}
          value={fresh}
          onChange={(e) => setFresh(e.target.value)}
          className="max-w-60"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!loose.length}>
          {w.orgNewGroup}
        </Button>
      </form>
    </section>
  );
}

function Column({
  title,
  target,
  members,
  names,
  onMove,
  children,
}: {
  title: string;
  target: string;
  members: readonly Member[];
  names: readonly string[];
  onMove: (project: string, to: string) => unknown;
  children?: ReactNode;
}) {
  const w = useWords();
  const [over, setOver] = useState(false);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target for the mouse; each chip's Move to menu is the keyboard way
    <div
      className={cn("grid content-start gap-3 rounded-lg border border-border p-3", over && "border-primary")}
      data-group={target}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const project = e.dataTransfer.getData(DRAG);
        if (project && !members.some((m) => m.name === project)) void onMove(project, target);
      }}
    >
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="flex min-h-8 flex-wrap gap-1.5" aria-label={title}>
        {members.length ? null : <li className="text-xs text-muted-foreground">{w.orgDropHere}</li>}
        {members.map((m) => (
          <li
            key={m.name}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG, m.name);
              e.dataTransfer.effectAllowed = "move";
            }}
            className="flex cursor-grab items-center gap-1.5 rounded-sm border border-border px-2 py-1 text-xs active:cursor-grabbing"
          >
            <span className="font-medium">{m.name}</span>
            <span className="text-muted-foreground">
              {m.own.autonomy ? fmt(w.orgOwn, { value: w[LEVEL_WORDS[m.own.autonomy]] }) : w[LEVEL_WORDS[m.effective.autonomy]]}
            </span>
            <select
              aria-label={fmt(w.orgMoveTo, { project: m.name })}
              className="h-6 border border-input bg-transparent text-xs pointer-coarse:h-11"
              value={target}
              onChange={(e) => void onMove(m.name, e.target.value)}
            >
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              <option value="">{w.orgNoGroup}</option>
            </select>
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}
