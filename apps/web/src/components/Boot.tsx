import { useState } from "react";
import { reduced } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { BrandMark } from "./Logo";

/**
 * The one loader, only while the whole app is starting or connecting: before the first state arrives, while the phone
 * reaches your computer, during Setup's scan. Your square slides over the work and back, a cycle of
 * `SYSTEM.motion.handover` on the arrive curve; under reduced motion it's the still mark with `label` written out.
 * A pane that loads draws skeletons instead (components/ui/skeleton.tsx).
 */
export function Boot({ ready, label, className }: { ready: boolean; label: string; className?: string }) {
  const [still] = useState(reduced);
  if (ready) return null;
  return (
    <div role="status" data-loader="" className={cn("grid min-h-[50dvh] place-items-center", className)}>
      <div className="grid justify-items-center gap-4">
        <BrandMark size={48} moving={!still} />
        <p className={still ? "text-sm text-muted-foreground" : "sr-only"}>{label}</p>
      </div>
    </div>
  );
}
