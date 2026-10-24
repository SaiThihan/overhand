import { useActions } from "@/app/actions";
import type { Model } from "@/app/data";
import { Named, useWords } from "@/app/theme";
import { useUi } from "@/app/ui";
import { Button } from "@/components/ui/button";
import { fmt } from "@/lib/format";
import { DrawerHead } from "./DrawerHost";

function Section({ title, items, none }: { title: string; items: string[]; none: string }) {
  return (
    <section className="mt-4">
      <h3 className="font-display text-xs tracking-widest text-primary uppercase">{title}</h3>
      {items.length ? (
        <ul className="mt-1 list-disc pl-5 text-sm">
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">{none}</p>
      )}
    </section>
  );
}

/** Overdrive's pre-flight: exactly what Launch arms and starts, before it does. */
export function OverdriveDrawer({ m }: { m: Model }) {
  const w = useWords();
  const ui = useUi();
  const { launch } = useActions();
  const ready: string[] = [];
  const armed: string[] = [];
  for (const [client, c] of Object.entries(m.plan.clients)) for (const a of c.agent) (a.on ? armed : ready).push(`${a.key} · ${client}`);
  const free = m.s.accounts.filter((a) => a.coolUntil <= m.s.now).map((a) => a.name);
  const leads = m.s.godmode.filter((g) => g.supervised && g.stopped).map((g) => g.label);
  return (
    <>
      <DrawerHead kicker={w.preflight} named="overdrive" />
      <Section title={fmt(w.willArm, { n: ready.length })} items={ready} none={w.nothingWaiting} />
      <Section title={fmt(w.alreadyArmed, { n: armed.length })} items={armed} none={w.none} />
      <Section title={fmt(w.leadsRestarted, { n: leads.length })} items={leads} none={w.allLeadsRunning} />
      <section className="mt-4">
        <h3 className="font-display text-xs tracking-widest text-primary uppercase">{w.accountsFree}</h3>
        <p className="mt-1 text-sm">{free.length ? free.join(", ") : w.allCooling}</p>
      </section>
      {m.s.paused ? <p className="mt-4 text-sm text-warn">{w.pausedResumes}</p> : null}
      <div className="mt-5 flex gap-2">
        <Button onClick={() => void launch()}>
          <Named k="launch" inline />
        </Button>
        <Button variant="outline" onClick={ui.closeDrawer}>
          {w.cancel}
        </Button>
      </div>
    </>
  );
}
