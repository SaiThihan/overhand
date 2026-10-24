import { useActions } from "@/app/actions";
import { useModel } from "@/app/data";
import { Named, useWords } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { type AssignOffer, canAssign, projectOfKey } from "@/lib/assign";

/**
 * Assign an agent, the one name for it everywhere. On a project on act it hands the ticket straight to an agent; on
 * watch or propose an agent builds this one thing on the next pass, at the project's assigned level. The project is
 * the offer's, else the ticket key's. Shows "Assigned" once it is.
 */
export function AssignButton({
  offer,
  assigned = false,
  variant = "ghost",
}: {
  offer: AssignOffer;
  assigned?: boolean;
  variant?: "primary" | "ghost" | "outline";
}) {
  const w = useWords();
  const { assign, run } = useActions();
  const m = useModel();
  if (assigned) return <span className="shrink-0 text-xs text-muted-foreground">{w.assignedTag}</span>;
  const { key } = offer;
  const project = offer.project || (m && key ? projectOfKey(m.s, key) : "");
  const act = !m || !canAssign(m.s, project);
  // primary is a drawer's next step: full size, the theme word with the plain word in sight
  const primary = variant === "primary";
  return (
    <Button
      variant={variant}
      size={primary ? "default" : "xs"}
      className="shrink-0"
      onClick={() => void (act && key ? run({ name: "queue", key }) : assign({ ...offer, project }))}
    >
      {primary ? <Named k="assignAgent" inline /> : w.assignAgent}
    </Button>
  );
}
