import { XIcon } from "lucide-react";
import { useWords } from "@/app/theme";
import { useTip } from "@/app/tips";
import { Button } from "@/components/ui/button";

/** A quiet line about a new feature, beside its control (`at`, the registry's tip `where`); nothing when none shows. */
export function FeatureTip({ at, className = "" }: { at: string; className?: string }) {
  const w = useWords();
  const tip = useTip(at);
  if (!tip?.feature.tip) return null;
  return (
    <p data-tip={at} className={`m-enter flex items-start gap-1 text-xs text-pretty text-muted-foreground ${className}`}>
      <span className="min-w-0 flex-1 pt-0.5">{tip.feature.tip.text}</span>
      <Button variant="ghost" size="icon-xs" aria-label={w.tipClose} className="-my-0.5 shrink-0 text-muted-foreground" onClick={tip.close}>
        <XIcon />
      </Button>
    </p>
  );
}
