import { Pencil } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useActions } from "@/app/actions";
import { useWords } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * A name a person can change in one click: `children` shows it, the pencil turns it into a field, and Enter (or leaving
 * the field) keeps your name under `id` for good; an empty field goes back to Overhand's.
 */
export function Rename({ id, name, children }: { id: string; name: string; children: ReactNode }) {
  const w = useWords();
  const { rename } = useActions();
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  if (!editing)
    return (
      <span className="flex min-w-0 items-baseline gap-1">
        {children}
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 self-center text-muted-foreground"
          aria-label={w.rename}
          title={w.rename}
          onClick={() => setEditing(true)}
        >
          <Pencil aria-hidden="true" />
        </Button>
      </span>
    );
  // the one place a name is kept: leaving the field (Enter blurs it; Escape blurs it without keeping)
  const done = (value: string) => {
    setEditing(false);
    if (!cancelled.current && value.trim() !== name) void rename(id, value.trim());
    cancelled.current = false;
  };
  return (
    <Input
      autoFocus
      aria-label={w.rename}
      title={w.renameHint}
      maxLength={60}
      defaultValue={name}
      className="h-7 max-w-64 px-2 text-sm"
      onBlur={(e) => done(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          cancelled.current = true;
          e.stopPropagation(); // closes the field, not the drawer around it
        }
        if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
      }}
    />
  );
}
