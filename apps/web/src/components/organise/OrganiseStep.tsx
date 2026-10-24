import type { ProposedGroup } from "@overhand/contract";
import { useState } from "react";
import { useWords } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { fmt } from "@/lib/format";
import { useOrganise, useOrganiseActions } from "@/lib/organise";
import { GroupRulesForm, LeadScopePicker } from "./GroupControls";

/** A proposal with one project moved to another group (made when new); groups left empty go. */
function moveIn(groups: readonly ProposedGroup[], project: string, to: string): ProposedGroup[] {
  const out = groups.map((g) => ({ ...g, members: g.members.filter((m) => m !== project) }));
  const at = out.find((g) => g.name === to);
  if (at) at.members = [...at.members, project];
  else out.push({ name: to, members: [project], reason: "", confidence: 1, signals: [] });
  return out.filter((g) => g.members.length);
}

/**
 * Onboarding's "Here's how we'd organise your work": the proposed groups with why and how sure; Accept all keeps them,
 * Adjust lets you move projects between groups (or into a new one) first, Skip leaves every project on its own. Once
 * kept, each group's rules and lead scope can be set right here.
 */
export function OrganiseStep({ onDone }: { onDone: () => void }) {
  const w = useWords();
  const q = useOrganise();
  const act = useOrganiseActions();
  const [draft, setDraft] = useState<ProposedGroup[] | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [fresh, setFresh] = useState("");
  const [kept, setKept] = useState(false);
  if (q.isPending) return <SkeletonRows label={w.orgLoading} rows={3} row="h-20 rounded-[var(--radius-tile)]" />;
  const data = q.data;
  const groups = draft ?? data?.proposal ?? [];
  if (!data || !groups.length) {
    return (
      <section className="grid gap-3">
        <p className="text-sm text-muted-foreground">{w.orgEmpty}</p>
        <Button className="justify-self-start" onClick={onDone}>
          {w.orgSkip}
        </Button>
      </section>
    );
  }
  const accept = async () => {
    if ((await act.accept(groups.map((g) => ({ name: g.name, members: g.members })))) !== null) setKept(true);
  };
  return (
    <section className="grid gap-4" aria-labelledby="organise-title">
      <header className="grid gap-1">
        <h2 id="organise-title" className="font-display text-lg">
          {w.orgTitle}
        </h2>
        <p className="text-sm text-muted-foreground">{w.orgIntro}</p>
      </header>
      {kept ? (
        <ul className="grid gap-3">
          {data.groups.map((g) => (
            <li key={g.name} className="grid gap-3 rounded-lg border border-border p-3">
              <h3 className="text-sm font-medium">{g.name}</h3>
              <p className="text-xs text-muted-foreground">{g.members.map((m) => m.name).join(", ")}</p>
              <GroupRulesForm group={g} />
              <LeadScopePicker group={g} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid gap-2">
          {groups.map((g) => (
            <li key={g.name} className="grid gap-1 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">{g.name}</h3>
                {g.reason ? (
                  <span className="font-mono text-xs text-muted-foreground">{fmt(w.orgSure, { n: Math.round(g.confidence * 100) })}</span>
                ) : null}
              </div>
              {g.reason ? <p className="text-xs text-muted-foreground">{g.reason}</p> : null}
              <ul className="flex flex-wrap gap-1.5">
                {g.members.map((m) => (
                  <li key={m} className="flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-xs">
                    <span>{m}</span>
                    {adjusting ? (
                      <select
                        aria-label={fmt(w.orgMoveTo, { project: m })}
                        className="h-6 border border-input bg-transparent text-xs pointer-coarse:h-11"
                        value={g.name}
                        onChange={(e) => setDraft(moveIn(groups, m, e.target.value || m))}
                      >
                        {groups.map((o) => (
                          <option key={o.name} value={o.name}>
                            {o.name}
                          </option>
                        ))}
                        <option value="">{w.orgNoGroup}</option>
                      </select>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {adjusting && !kept ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (fresh.trim()) setDraft([...groups, { name: fresh.trim(), members: [], reason: "", confidence: 1, signals: [] }]);
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
          <Button type="submit" size="sm" variant="outline">
            {w.orgNewGroup}
          </Button>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {kept ? (
          <Button onClick={onDone}>{w.orgDone}</Button>
        ) : (
          <>
            <Button onClick={() => void accept()}>{w.orgAcceptAll}</Button>
            <Button variant="outline" aria-pressed={adjusting} onClick={() => setAdjusting(!adjusting)}>
              {adjusting ? w.orgDone : w.orgAdjust}
            </Button>
            <Button variant="ghost" onClick={onDone}>
              {w.orgSkip}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
