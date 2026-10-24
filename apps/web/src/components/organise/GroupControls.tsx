import { AUTONOMY_LEVELS, type GroupView, LEAD_SCOPES, type LeadScope } from "@overhand/contract";
import type { WordKey } from "@overhand/themes";
import { type ReactNode, useState } from "react";
import { useWords } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { fmt } from "@/lib/format";
import { LEVEL_WORDS } from "@/lib/leads";
import { csv, parseQuiet, quietText, useOrganiseActions } from "@/lib/organise";

/** The levels a group may set: Ship is a person's click on one project, never a group's (the config refuses it too). */
const GROUP_LEVELS = AUTONOMY_LEVELS.filter((l) => l !== "ship");
const SCOPE_WORDS = { group: "orgLeadGroup", repo: "orgLeadRepo", none: "orgLeadNone" } as const satisfies Record<LeadScope, WordKey>;

const SELECT = "h-8 w-full border border-input bg-transparent px-2 text-sm text-foreground";

/** A field, stacked: its name above, the control (which carries the same name as its aria-label) below. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 text-xs text-muted-foreground">
      <span aria-hidden="true">{label}</span>
      {children}
    </div>
  );
}

/**
 * A group's rules: how far agents go, assigned runs, accounts, private words, the leads' push branches and quiet hours.
 * Saved together; "apply to every project" also clears what members set themselves.
 */
export function GroupRulesForm({ group }: { group: GroupView }) {
  const w = useWords();
  const act = useOrganiseActions();
  const r = group.rules;
  const [autonomy, setAutonomy] = useState(r.autonomy ?? "");
  const [assigned, setAssigned] = useState(r.assignedAutonomy ?? "");
  const [accounts, setAccounts] = useState((r.accounts ?? []).join(", "));
  const [words, setWords] = useState((r.private ?? []).join(", "));
  const [push, setPush] = useState((r.pushBranches ?? []).join(", "));
  const [quiet, setQuiet] = useState(quietText(r.windows));
  const [reset, setReset] = useState(false);
  const level = GROUP_LEVELS.find((l) => l === autonomy);
  const assignedLevel = assigned === "act" || assigned === "propose" ? assigned : undefined;
  const save = () =>
    void act.rules(
      group.name,
      {
        autonomy: level,
        assignedAutonomy: assignedLevel,
        accounts: csv(accounts),
        private: csv(words),
        pushBranches: csv(push),
        windows: parseQuiet(quiet),
      },
      reset,
    );
  return (
    <fieldset className="grid gap-2" aria-label={w.orgRules}>
      <legend className="mb-1 font-display text-xs tracking-widest text-muted-foreground uppercase">{w.orgRules}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={w.orgRuleAutonomy}>
          <select aria-label={w.orgRuleAutonomy} className={SELECT} value={autonomy} onChange={(e) => setAutonomy(e.target.value)}>
            <option value="">{w.orgRuleInherit}</option>
            {[...GROUP_LEVELS].reverse().map((l) => (
              <option key={l} value={l}>
                {w[LEVEL_WORDS[l]]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={w.orgRuleAssigned}>
          <select aria-label={w.orgRuleAssigned} className={SELECT} value={assigned} onChange={(e) => setAssigned(e.target.value)}>
            <option value="">{w.orgRuleInherit}</option>
            <option value="act">{w.autonomyActName}</option>
            <option value="propose">{w.autonomyProposeName}</option>
          </select>
        </Field>
      </div>
      <Field label={w.orgRuleAccounts}>
        <Input aria-label={w.orgRuleAccounts} value={accounts} onChange={(e) => setAccounts(e.target.value)} />
      </Field>
      <Field label={w.orgRulePrivate}>
        <Input aria-label={w.orgRulePrivate} value={words} onChange={(e) => setWords(e.target.value)} />
      </Field>
      <Field label={w.orgRulePush}>
        <Input aria-label={w.orgRulePush} value={push} onChange={(e) => setPush(e.target.value)} />
      </Field>
      <Field label={w.orgRuleWindows}>
        <Input aria-label={w.orgRuleWindows} value={quiet} onChange={(e) => setQuiet(e.target.value)} placeholder="09:00-17:00" />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={reset} onCheckedChange={setReset} aria-label={w.orgRuleReset} />
          <span aria-hidden="true">{w.orgRuleReset}</span>
        </span>
        <Button size="sm" variant="outline" onClick={save}>
          {w.orgRuleSave}
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * The group's lead scope: the recommendation and its reason, the three choices, and Apply, which shows what it would add
 * and remove first and asks again before stopping a lead that runs.
 */
export function LeadScopePicker({ group }: { group: GroupView }) {
  const w = useWords();
  const act = useOrganiseActions();
  const [scope, setScope] = useState<LeadScope>(group.lead ?? group.advice.scope);
  const [note, setNote] = useState("");
  const [blocked, setBlocked] = useState<string[]>([]);
  const apply = async (confirm: boolean) => {
    const dry = confirm ? null : await act.lead(group.name, scope, { dryRun: true });
    if (dry?.blocked.length) {
      setBlocked(dry.blocked);
      return;
    }
    const r = await act.lead(group.name, scope, { confirm });
    setBlocked([]);
    if (r)
      setNote(
        r.added.length || r.removed.length
          ? fmt(w.orgLeadPreview, { added: r.added.join(", ") || "–", removed: r.removed.join(", ") || "–" })
          : w.orgLeadNothing,
      );
  };
  return (
    <fieldset className="grid gap-2" aria-label={w.orgLead}>
      <legend className="mb-1 font-display text-xs tracking-widest text-muted-foreground uppercase">{w.orgLead}</legend>
      <p className="text-xs text-muted-foreground">
        {fmt(w.orgLeadAdvice, { scope: w[SCOPE_WORDS[group.advice.scope]], reason: group.advice.reason })}
      </p>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={w.orgLead}>
        {LEAD_SCOPES.map((s) => (
          <Button
            key={s}
            size="sm"
            role="radio"
            aria-checked={scope === s}
            variant={scope === s ? "primary" : "outline"}
            onClick={() => {
              setScope(s);
              setBlocked([]);
              setNote("");
            }}
          >
            {w[SCOPE_WORDS[s]]}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => void apply(false)}>
          {w.orgLeadApply}
        </Button>
      </div>
      {blocked.length ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>{fmt(w.orgLeadRunning, { keys: blocked.join(", ") })}</span>
          <Button size="xs" variant="outline" onClick={() => void apply(true)}>
            {w.orgLeadConfirm}
          </Button>
        </div>
      ) : null}
      {note ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {note}
        </p>
      ) : null}
    </fieldset>
  );
}
