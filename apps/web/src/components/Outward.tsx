import { type Finding, type LeakHit, seededTerms } from "@overhand/contract";
import { useState } from "react";
import { useActions } from "@/app/actions";
import { useWords } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Text with the outward firewall's spans marked. */
export function Marked({ text, hits }: { text: string; hits: readonly LeakHit[] }) {
  const parts: { s: string; hit: boolean }[] = [];
  let at = 0;
  for (const h of [...hits].sort((a, b) => a.start - b.start)) {
    if (h.start < at) continue;
    parts.push({ s: text.slice(at, h.start), hit: false }, { s: text.slice(h.start, h.end), hit: true });
    at = h.end;
  }
  parts.push({ s: text.slice(at), hit: false });
  return (
    <p className="max-h-40 overflow-y-auto border-l-2 border-bad/70 bg-bad/5 px-3 py-1.5 text-xs whitespace-pre-wrap break-words">
      {parts.map((p, i) =>
        p.hit ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one text, in order
          <mark key={i} className="bg-bad/25 text-foreground">
            {p.s}
          </mark>
        ) : (
          p.s
        ),
      )}
    </p>
  );
}

/**
 * What you can do with something the outward firewall stopped: see the marked words, Edit and post (checked again),
 * Post anyway (asked once more), or Dismiss. An agent's own command has no Edit: the agent writes its text.
 */
export function LeakActions({ f }: { f: Finding }) {
  const w = useWords();
  const { heldDismiss, leakRelease } = useActions();
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [text, setText] = useState(f.text);
  const [hits, setHits] = useState<readonly LeakHit[]>(f.leak?.hits ?? []);
  const [busy, setBusy] = useState(false);
  const [edited, setEdited] = useState(false);
  const go = (body: string | null, force: boolean) => {
    setBusy(true);
    void leakRelease(f.id, body, force).then((left) => {
      setBusy(false);
      if (left.length) {
        setHits(left);
        setEdited(true);
        setMode("view");
      }
    });
  };
  return (
    <div className="grid gap-1.5">
      {mode === "edit" ? (
        <Textarea aria-label={w.leakEdit} value={text} onChange={(e) => setText(e.target.value)} className="min-h-24 text-xs" autoFocus />
      ) : (
        <Marked text={text} hits={hits} />
      )}
      <div className="flex flex-wrap justify-end gap-1">
        {mode === "confirm" ? (
          <>
            <span className="mr-auto self-center text-xs text-muted-foreground">{w.leakConfirm}</span>
            <Button variant="ghost" size="xs" onClick={() => setMode("view")}>
              {w.cancel}
            </Button>
            <Button variant="outline" size="xs" disabled={busy} onClick={() => go(edited ? text : null, true)}>
              {w.leakConfirmGo}
            </Button>
          </>
        ) : mode === "edit" ? (
          <>
            <Button variant="ghost" size="xs" onClick={() => setMode("view")}>
              {w.cancel}
            </Button>
            <Button
              variant="outline"
              size="xs"
              disabled={busy || !text.trim()}
              onClick={() => {
                setEdited(true);
                go(text, false);
              }}
            >
              {w.leakSend}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="xs" onClick={() => void heldDismiss(f.id)}>
              {w.heldDismiss}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setMode("confirm")}>
              {w.leakAnyway}
            </Button>
            {f.leak?.kind === "agent" ? null : (
              <Button variant="outline" size="xs" onClick={() => setMode("edit")}>
                {w.leakEdit}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The dashboard failed its own look: Report writes a diagnostic with nothing private in it; Reload tries again. */
export function SelfCheckActions() {
  const w = useWords();
  const { selfCheckReport, selfCheckReload } = useActions();
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button variant="ghost" size="xs" onClick={() => void selfCheckReport()}>
        {w.selfCheckReport}
      </Button>
      <Button variant="outline" size="xs" onClick={() => void selfCheckReload()}>
        {w.selfCheckReload}
      </Button>
    </div>
  );
}

/** Settings: the words a project covers without listing them (name, aliases, ticket keys), shown read-only. */
export function SeededWords({ name, prefix, aliases }: { name: string; prefix: string; aliases: readonly string[] }) {
  const words = seededTerms({ name, prefix, aliases });
  if (!words.length) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Never sent to another project's repo, tracker or channel, without listing them: {words.join(", ")}
    </p>
  );
}
