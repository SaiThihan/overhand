import { SummarySchema } from "@overhand/contract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTheme } from "@/app/theme";
import type { CardSpan } from "@/app/ui";
import { DrawerHead } from "@/components/drawers/DrawerHost";
import { Button, Choice } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { get } from "@/lib/api";
import { type CardPrivacy, cardContent, cardMarkdown, PRIVATE } from "@/lib/card";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CARD_SIZES, type CardSize, renderCard, toPng } from "./render";

function Toggle({ label, on, set }: { label: string; on: boolean; set: (on: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <Switch id={id} checked={on} onCheckedChange={set} />
    </div>
  );
}

const SPANS: [CardSpan, "shareSpanNight" | "shareSpanToday" | "shareSpanWeek"][] = [
  ["night", "shareSpanNight"],
  ["today", "shareSpanToday"],
  ["week", "shareSpanWeek"],
];

/**
 * The social card: pick the night, day or week and a size, see the card, then copy, download or share it. Nothing private
 * is on it until a switch here says so; the switches start off every time.
 */
export function ShareDrawer({ span: opening }: { span: CardSpan }) {
  const { theme, words: w } = useTheme();
  const [span, setSpan] = useState<CardSpan>(opening);
  const [size, setSize] = useState<CardSize>("wide");
  const [privacy, setPrivacy] = useState<CardPrivacy>(PRIVATE);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { data, error } = useQuery({
    queryKey: ["summary", span],
    queryFn: () => get(`/api/summary?span=${span}`, SummarySchema),
    staleTime: 30_000,
  });
  const content = useMemo(() => (data ? cardContent(data, w, privacy) : null), [data, w, privacy]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !content) return;
    setReady(false);
    let live = true;
    void renderCard(c, content, theme, size).then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [content, theme, size]);

  const file = async () => {
    const c = canvas.current;
    if (!c) throw new Error("no card yet");
    return new File([await toPng(c)], `overhand-${span}-${size}.png`, { type: "image/png" });
  };
  const copy = async () => {
    try {
      // a promise in the item keeps Safari's user-gesture window open while the PNG is made
      const c = canvas.current;
      if (!c) return;
      await navigator.clipboard.write([new ClipboardItem({ "image/png": toPng(c) })]);
      toast(w.shareCopied);
    } catch {
      toast(w.shareCopyFailed);
    }
  };
  const download = async () => {
    const f = await file();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };
  const canShare = typeof navigator.canShare === "function";
  const share = async () => {
    const f = await file();
    if (!navigator.canShare({ files: [f] })) return void download();
    await navigator.share({ files: [f] }).catch(() => undefined); // dismissing the sheet isn't an error
  };
  const markdown = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(cardMarkdown(content)).then(
      () => toast(w.shareMdCopied),
      (e: unknown) => toast(e instanceof Error ? e.message : String(e)),
    );
  };
  const [cw, ch] = CARD_SIZES[size];
  const set = (k: keyof CardPrivacy) => (on: boolean) => setPrivacy({ ...privacy, [k]: on });

  return (
    <>
      <DrawerHead kicker={w.shareKicker} named="shareTitle" />
      <div className="mt-4 grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <fieldset className="flex gap-1">
            <legend className="sr-only">{w.shareKicker}</legend>
            {SPANS.map(([s, k]) => (
              <Choice key={s} on={span === s} onClick={() => setSpan(s)}>
                {w[k]}
              </Choice>
            ))}
          </fieldset>
          <div className="flex gap-1">
            <Choice on={size === "wide"} onClick={() => setSize("wide")}>
              {w.shareWide}
            </Choice>
            <Choice on={size === "square"} onClick={() => setSize("square")}>
              {w.shareSquare}
            </Choice>
          </div>
        </div>
        <div className="relative">
          <canvas
            ref={canvas}
            width={cw}
            height={ch}
            role="img"
            aria-label={content ? fmt(w.shareAlt, { text: cardMarkdown(content).replace(/[*_]/g, "") }) : w.shareTitle}
            className={cn("w-full rounded-md border border-border bg-background", size === "square" && "mx-auto max-w-sm")}
            style={{ aspectRatio: `${cw} / ${ch}` }}
          />
          {/* the card's place, until the summary it draws arrives */}
          {!data && !error ? <Skeleton className="absolute inset-0 h-auto rounded-md" /> : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error instanceof Error ? error.message : String(error)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!ready} onClick={() => void copy()}>
            {w.shareCopy}
          </Button>
          <Button variant="outline" disabled={!ready} onClick={() => void download()}>
            {w.shareDownload}
          </Button>
          {canShare ? (
            <Button variant="outline" disabled={!ready} onClick={() => void share()}>
              {w.shareNative}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={!content} onClick={() => void markdown()}>
            {w.shareMarkdown}
          </Button>
        </div>
        <section className="grid gap-1 border-t border-border pt-3" aria-label={w.shareShow}>
          <h3 className="text-xs text-muted-foreground">{w.shareShow}</h3>
          <Toggle label={w.shareProjects} on={privacy.projects} set={set("projects")} />
          <Toggle label={w.shareTitles} on={privacy.titles} set={set("titles")} />
          <Toggle label={w.shareRepos} on={privacy.repos} set={set("repos")} />
          <Toggle label={w.shareMoney} on={privacy.money} set={set("money")} />
          <p className="pt-1 text-xs text-muted-foreground">{w.sharePrivate}</p>
        </section>
      </div>
    </>
  );
}
