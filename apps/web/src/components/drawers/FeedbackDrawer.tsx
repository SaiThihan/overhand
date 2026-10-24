import type { FeedbackKind, FeedbackPreview, FeedbackRequest } from "@overhand/contract";
import { useId, useState } from "react";
import { useActions } from "@/app/actions";
import { useWords } from "@/app/theme";
import { Marked } from "@/components/Outward";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fmt } from "@/lib/format";
import { DrawerHead } from "./DrawerHost";

/**
 * Suggest or report: write it, then Preview shows the exact public issue (title and body, both editable) with anything
 * private marked. Send, and only Send, posts it; while the firewall marks something, Send waits for an edit.
 */
export function FeedbackDrawer() {
  const w = useWords();
  const id = useId();
  const { feedbackPreview, feedbackSend } = useActions();
  const [req, setReq] = useState<FeedbackRequest>({ kind: "idea", title: "", details: "", diagnostics: false });
  const [draft, setDraft] = useState<FeedbackPreview | null>(null);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const kinds: [FeedbackKind, string][] = [
    ["idea", w.feedbackIdea],
    ["bug", w.feedbackBug],
  ];

  if (!draft)
    return (
      <>
        <DrawerHead kicker={w.feedbackKicker} named="feedback" />
        <form
          className="mt-4 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void feedbackPreview(req).then((p) => {
              setBusy(false);
              setEdited(false);
              setDraft(p);
            });
          }}
        >
          <div className="flex gap-1.5">
            {kinds.map(([k, label]) => (
              <Button
                key={k}
                type="button"
                variant={req.kind === k ? "primary" : "outline"}
                size="sm"
                aria-pressed={req.kind === k}
                onClick={() => setReq({ ...req, kind: k })}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-t`}>{w.feedbackTitle}</Label>
            <Input id={`${id}-t`} maxLength={200} value={req.title} onChange={(e) => setReq({ ...req, title: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-d`}>{w.feedbackDetails}</Label>
            <Textarea
              id={`${id}-d`}
              maxLength={5000}
              className="min-h-28"
              value={req.details}
              onChange={(e) => setReq({ ...req, details: e.target.value })}
            />
          </div>
          <div className="flex items-start gap-3">
            <Switch
              id={`${id}-x`}
              checked={req.diagnostics}
              onCheckedChange={(on) => setReq({ ...req, diagnostics: on })}
              aria-describedby={`${id}-xh`}
            />
            <div className="grid gap-0.5">
              <Label htmlFor={`${id}-x`}>{w.feedbackDiagnostics}</Label>
              <p id={`${id}-xh`} className="text-xs text-muted-foreground">
                {w.feedbackDiagnosticsHint}
              </p>
            </div>
          </div>
          <Button type="submit" variant="primary" className="justify-self-end" disabled={busy || !req.title.trim()}>
            {w.feedbackPreview}
          </Button>
        </form>
      </>
    );

  const marked = [...draft.hits.title, ...draft.hits.body];
  const edit = (d: Partial<FeedbackPreview>) => {
    setDraft({ ...draft, ...d });
    setEdited(true);
  };
  return (
    <>
      <DrawerHead kicker={w.feedbackKicker} named="feedback" />
      <div className="mt-4 grid gap-4">
        <p className="text-sm">{w.feedbackPublic}</p>
        {marked.length ? (
          <div className="grid gap-1.5" role="alert">
            <p className="text-sm text-bad">{fmt(w.feedbackPrivate, { terms: [...new Set(marked.map((h) => h.term))].join(", ") })}</p>
            {draft.hits.title.length ? <Marked text={draft.title} hits={draft.hits.title} /> : null}
            {draft.hits.body.length ? <Marked text={draft.body} hits={draft.hits.body} /> : null}
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-it`}>{w.feedbackIssueTitle}</Label>
          <Input id={`${id}-it`} maxLength={200} value={draft.title} onChange={(e) => edit({ title: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-ib`}>{w.feedbackIssueBody}</Label>
          <Textarea
            id={`${id}-ib`}
            className="min-h-56 font-mono text-xs"
            value={draft.body}
            onChange={(e) => edit({ body: e.target.value })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {draft.via === "gh" ? fmt(w.feedbackViaGh, { login: draft.login }) : w.feedbackViaBrowser}
        </p>
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" onClick={() => setDraft(null)}>
            {w.feedbackBack}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !draft.title.trim() || (marked.length > 0 && !edited)}
            onClick={() => {
              setBusy(true);
              void feedbackSend(draft, draft.via).then((left) => {
                setBusy(false);
                if (!left) return;
                setDraft({ ...draft, hits: left });
                setEdited(false);
              });
            }}
          >
            {w.feedbackSend}
          </Button>
        </div>
      </div>
    </>
  );
}
