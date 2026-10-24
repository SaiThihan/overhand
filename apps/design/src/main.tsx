/**
 * The design catalog's page: a sidebar of every entry, the Foundations page, and each entry with its states. A state
 * renders inline, or in a frame of the catalog itself (`#/frame/<group>/<id>?state=…`) when it's an overlay, a whole
 * screen or needs a clock of its own. Addresses: `#/<group>/<id>?state=<name>&look=light|dark`.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, StrictMode, useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, useTheme } from "@/app/theme";
import { UiProvider } from "@/app/ui";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CATALOG, type Entry, framed, SKIP } from "./catalog";
import { forceStates } from "./force";
import { Foundations } from "./pages/foundations";
import { Contained } from "./stage";
import "./design.css";

type Look = "light" | "dark";
interface Route {
  frame: boolean;
  group: string;
  id: string;
  state: string | null;
  look: Look | null;
}

/** Reads `#/[frame/]<group>/<id>?state=…&look=…`. */
function parse(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const frame = parts[0] === "frame";
  const [group = "foundations", id = ""] = frame ? parts.slice(1) : parts;
  const q = new URLSearchParams(query);
  const look = q.get("look");
  return { frame, group, id, state: q.get("state"), look: look === "light" || look === "dark" ? look : null };
}

/** The address of a page, keeping the look. */
function href(r: Omit<Route, "frame"> & { frame?: boolean }): string {
  const q = new URLSearchParams();
  if (r.state) q.set("state", r.state);
  if (r.look) q.set("look", r.look);
  const path = [r.frame ? "frame" : "", r.group, r.id].filter(Boolean).map(encodeURIComponent).join("/");
  return `#/${path}${q.size ? `?${q}` : ""}`;
}

const onHash = (f: () => void) => {
  addEventListener("hashchange", f);
  return () => removeEventListener("hashchange", f);
};
const useRoute = () => parse(useSyncExternalStore(onHash, () => location.hash));

const GROUPS = [
  ["components", "Components"],
  ["patterns", "Patterns"],
  ["screens", "Screens"],
] as const;
const find = (r: Route): Entry | undefined => CATALOG.find((e) => e.group === r.group && e.id === r.id);

/** One state, rendered as a component so its hooks are its own. */
const Render = ({ e, state }: { e: Entry; state: string }) => {
  const fn = e.states[state];
  return fn ? <Contained>{createElement(fn)}</Contained> : <p className="text-sm text-bad">No state called {state}.</p>;
};

/** A state in a frame of the catalog: a phone's width for the phone state, the stage's width otherwise. */
function Frame({ e, state, look }: { e: Entry; state: string; look: Look }) {
  const phone = state === "phone";
  const src = `./?demo${href({ frame: true, group: e.group, id: e.id, state, look })}`;
  return (
    <iframe
      title={`${e.title}, ${state}`}
      src={src}
      className="stage-frame"
      style={{ height: phone ? 844 : (e.frame?.height ?? 480), maxWidth: phone ? 390 : undefined }}
    />
  );
}

function Nav({ r }: { r: Route }) {
  const link = (group: string, id: string, label: string) => {
    const on = r.group === group && r.id === id;
    return (
      <li key={`${group}/${id}`}>
        <a
          href={href({ group, id, state: null, look: r.look })}
          aria-current={on ? "page" : undefined}
          className={`block rounded-[var(--radius-control)] px-3 py-1.5 text-sm ${on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
        >
          {label}
        </a>
      </li>
    );
  };
  return (
    <nav aria-label="Catalog" className="grid gap-5">
      <ul className="grid gap-0.5">{link("foundations", "", "Foundations")}</ul>
      {GROUPS.map(([g, label]) => (
        <div key={g} className="grid gap-1">
          <h2 className="px-3 text-xs font-medium text-muted-foreground">{label}</h2>
          <ul className="grid gap-0.5">{CATALOG.filter((e) => e.group === g).map((e) => link(g, e.id, e.title))}</ul>
        </div>
      ))}
    </nav>
  );
}

/** On a phone the sidebar is a native picker. */
function Jump({ r }: { r: Route }) {
  const value = r.group === "foundations" ? "foundations/" : `${r.group}/${r.id}`;
  return (
    <label className="grid gap-1 text-sm lg:hidden">
      <span className="text-muted-foreground">Go to</span>
      <select
        value={value}
        onChange={(ev) => {
          const [group = "", id = ""] = ev.target.value.split("/");
          location.hash = href({ group, id, state: null, look: r.look });
        }}
        className="h-11 rounded-[var(--radius-control)] border border-border bg-card px-4 text-foreground"
      >
        <option value="foundations/">Foundations</option>
        {GROUPS.map(([g, label]) => (
          <optgroup key={g} label={label}>
            {CATALOG.filter((e) => e.group === g).map((e) => (
              <option key={e.id} value={`${g}/${e.id}`}>
                {e.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function EntryPage({ e, r, look }: { e: Entry; r: Route; look: Look }) {
  const names = r.state ? [r.state] : Object.keys(e.states);
  const group = GROUPS.find(([g]) => g === e.group)?.[1];
  return (
    <article className="grid gap-2">
      <p className="text-sm text-muted-foreground">{group}</p>
      <h1 className="text-3xl font-bold tracking-tight">{e.title}</h1>
      {e.about ? <p className="max-w-[46em] text-muted-foreground">{e.about}</p> : null}
      {e.passive ? <p className="text-sm text-muted-foreground">No hover, focus or disabled state: {e.passive}.</p> : null}
      {r.state ? (
        <a className="text-sm underline underline-offset-4" href={href({ ...r, state: null })}>
          Every state of {e.title}
        </a>
      ) : null}
      {names.map((s) => (
        <section key={s} className="mt-8 grid gap-3" aria-labelledby={`state-${s}`}>
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id={`state-${s}`} className="text-lg font-semibold">
              {s}
            </h2>
            {e.notes?.[s] ? <p className="text-sm text-muted-foreground">{e.notes[s]}</p> : null}
            {r.state ? null : (
              <a className="text-sm text-muted-foreground underline underline-offset-4" href={href({ ...r, state: s })}>
                Open alone
              </a>
            )}
          </header>
          {framed(e, s) ? (
            <Frame e={e} state={s} look={look} />
          ) : (
            <div className="stage">
              <Render e={e} state={s} />
            </div>
          )}
        </section>
      ))}
    </article>
  );
}

function NotShown() {
  if (!Object.keys(SKIP).length) return null;
  return (
    <section className="mt-14 grid gap-2">
      <h2 className="text-lg font-semibold">Not shown, and why</h2>
      <ul className="grid gap-1 text-sm text-muted-foreground">
        {Object.entries(SKIP).map(([name, why]) => (
          <li key={name}>
            <code className="font-mono text-foreground">{name}</code>: {why}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Chrome({ r }: { r: Route }) {
  const { light } = useTheme();
  const look: Look = light ? "light" : "dark";
  const e = find(r);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-border px-4 py-6 lg:block">
        <div className="sticky top-6 grid max-h-[calc(100dvh-3rem)] gap-6 overflow-y-auto pb-6">
          <a href={href({ group: "foundations", id: "", state: null, look: r.look })} className="flex items-center gap-2 px-3">
            <Logo size={20} />
          </a>
          <Nav r={r} />
        </div>
      </aside>
      <main className="min-w-0 px-4 pt-6 pb-24 lg:px-10">
        <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <div className="grid gap-0.5">
            <span className="lg:hidden">
              <Logo size={20} />
            </span>
            <b>Design system</b>
            <span className="text-sm text-muted-foreground">Every part of Overhand, live, on sample data. Nothing here is real.</span>
          </div>
          <fieldset className="seg flex gap-1.5" aria-label="Light or dark">
            {(["light", "dark"] as const).map((l) => (
              <Button
                key={l}
                variant="outline"
                size="sm"
                aria-pressed={look === l}
                onClick={() => (location.hash = href({ ...r, look: l }))}
              >
                {l === "light" ? "Light" : "Dark"}
              </Button>
            ))}
          </fieldset>
          <div className="w-full lg:hidden">
            <Jump r={r} />
          </div>
        </header>
        {r.group === "foundations" ? (
          <>
            <Foundations />
            <NotShown />
          </>
        ) : e ? (
          <EntryPage e={e} r={r} look={look} />
        ) : (
          <p className="text-muted-foreground">Nothing at this address. Pick a page from the list.</p>
        )}
      </main>
    </div>
  );
}

function Catalog() {
  const r = useRoute();
  const { setAppearance } = useTheme();
  useEffect(() => {
    if (r.look) setAppearance(r.look);
  }, [r.look, setAppearance]);
  if (!r.frame) return <Chrome r={r} />;
  const e = find(r);
  const state = r.state ?? Object.keys(e?.states ?? {})[0] ?? "";
  return e ? <Render e={e} state={state} /> : <p className="p-4 text-muted-foreground">Nothing at this address.</p>;
}

forceStates();
addEventListener("load", () => forceStates());

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider>
        <TooltipProvider delayDuration={300}>
          <UiProvider>
            <Catalog />
            <Toaster />
          </UiProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
