import type { Model } from "@/app/data";
import { useWords } from "@/app/theme";
import { ago, fmt } from "@/lib/format";
import { Dot, Pane } from "../Pane";

const KIND = { slack: "Slack", teams: "Teams", discord: "Discord" } as const;

/** Each status update channel's last send; a failure in red with its error (which never holds the webhook URL). */
export function Updates({ m }: { m: Model }) {
  const w = useWords();
  const list = m.s.updates;
  if (!list.length) return null;
  const failed = list.filter((u) => u.error).length;
  return (
    <Pane title="paneUpdates" count={failed} countTone="var(--bad)">
      <ul className="grid gap-2">
        {list.map((u) => (
          <li key={u.id} className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 text-sm">
            <Dot color={u.error ? "var(--bad)" : u.sentAt ? "var(--ok)" : "var(--muted-foreground)"} />
            <span className="min-w-0">
              <b className="font-medium">{u.name}</b> <span className="text-xs text-muted-foreground">{KIND[u.kind]}</span>
              <span className={`block text-xs [overflow-wrap:anywhere] ${u.error ? "text-bad" : "text-muted-foreground"}`}>
                {u.error
                  ? fmt(w.updatesFailed, { ago: ago(u.sentAt), error: u.error })
                  : u.sentAt
                    ? fmt(w.updatesSent, { ago: ago(u.sentAt) })
                    : w.updatesNever}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Pane>
  );
}
