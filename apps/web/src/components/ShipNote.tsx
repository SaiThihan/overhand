import type { AgentPr } from "@overhand/contract";
import { useWords } from "@/app/theme";

/** On a Ship project: GitHub merges this PR by itself once CI is green, or why it waits for your merge after all. */
export function ShipNote({ ship }: { ship: AgentPr["ship"] }) {
  const w = useWords();
  if (!ship) return null;
  return ship.on ? (
    <span className="text-ok">{w.shipOn} · </span>
  ) : ship.why ? (
    <span className="text-warn">{`${w.shipWaits}: ${ship.why} · `}</span>
  ) : null;
}
