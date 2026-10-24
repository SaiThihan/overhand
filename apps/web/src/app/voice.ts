import { useRef } from "react";
import { toast } from "sonner";
import { parseVoice } from "@/lib/commands";
import { fmt } from "@/lib/format";
import { type Recognition, recognition } from "@/lib/voice";
import { useActions } from "./actions";
import { useWords } from "./theme";

/**
 * Speaking a command ("hand EW 123 to the agent", "brief me"): the returned function starts the browser's speech
 * recognition, which stops by itself after a phrase; null when the browser can't recognise speech. The command bar
 * offers it.
 */
export function useVoice(): (() => void) | null {
  const w = useWords();
  const { run } = useActions();
  const rec = useRef<Recognition | null | undefined>(undefined);
  if (rec.current === undefined) rec.current = typeof window === "undefined" ? null : recognition();
  const r = rec.current;
  if (!r) return null;
  return () => {
    r.lang = "en-US";
    r.interimResults = false;
    r.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript ?? "";
      toast(fmt(w.saidHeard, { text }));
      void run(parseVoice(text), true);
    };
    r.onend = null;
    r.onerror = (e) => toast(fmt(w.saidVoiceFailed, { error: e.error }));
    try {
      r.start();
      toast(`${w.cmdSpeak}…`);
    } catch {
      // already listening
    }
  };
}
