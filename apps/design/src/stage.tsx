/**
 * How a catalog state renders the dashboard: inside its own query cache seeded with a sample (fixtures.ts), so a
 * component reads its data exactly as it does in the dashboard (`useModel`), and a whole screen is the real `App`.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, type ReactNode, useEffect, useRef, useState } from "react";
import { App } from "@/App";
import { type Model, STATE_KEY, useModel } from "@/app/data";
import { type Drawer, useUi } from "@/app/ui";
import { pinDemoClock } from "@/demo/demo";
import { MORNING, morning, type Seed } from "./fixtures";

/** This page is one state on its own, in a frame of the catalog (`#/frame/…`). */
export const FRAMED = typeof location !== "undefined" && location.hash.startsWith("#/frame/");

/** A query cache holding the sample: no fetching, so it stays what it is (loading, the data, or the daemon gone). */
function seeded(seed: Seed): QueryClient {
  const qc = new QueryClient();
  qc.setQueryDefaults(STATE_KEY, {
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    retryOnMount: false,
    enabled: seed.state !== null,
  });
  if (seed.state) qc.setQueryData(STATE_KEY, seed.state);
  const q = qc.getQueryCache().find({ queryKey: STATE_KEY });
  // the last state the daemon sent stays, with the error the dashboard shows when it stops answering
  if (seed.down && q) q.setState({ ...q.state, status: "error", error: new Error("unreachable"), errorUpdatedAt: q.state.dataUpdatedAt });
  return qc;
}

/**
 * Provides a sample to everything inside. The demo's clock is one per page, so it's pinned to the sample's minute;
 * on a page of several states every sample shares the morning, and one at another minute needs a frame of its own.
 */
export function Seeded({ seed, children }: { seed: Seed; children: ReactNode }) {
  if (!FRAMED && seed.at !== MORNING) throw new Error(`a sample at minute ${seed.at} moves the whole page's clock: give it a frame`);
  const [qc] = useState(() => {
    pinDemoClock(seed.at);
    return seeded(seed);
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function WithModel({ render }: { render: (m: Model) => ReactNode }) {
  const m = useModel();
  return m ? render(m) : null;
}

/** A component that takes the dashboard model, on a sample (the morning after, unless told otherwise). */
export function Live({ seed, children }: { seed?: Seed; children: (m: Model) => ReactNode }) {
  const [s] = useState(() => seed ?? morning());
  return (
    <Seeded seed={s}>
      <WithModel render={children} />
    </Seeded>
  );
}

/** What a screen opens once it's up: a drawer (or a place, on a phone), the command bar, or a control to press. */
export interface Opening {
  /** A drawer, or one worked out from the sample (the brief's text). */
  open?: Drawer | ((m: Model) => Drawer);
  /** The command bar, with this typed in. */
  palette?: string;
  /** A control on the screen to press, as a person would: a CSS selector. */
  press?: string;
}

/** Once the sample is in: does the opening, once. */
function Opener({ open, palette, press }: Opening) {
  const ui = useUi();
  const m = useModel();
  const once = useRef(false);
  useEffect(() => {
    if (once.current || !m) return;
    once.current = true;
    if (open) ui.openDrawer(typeof open === "function" ? open(m) : open);
    if (palette !== undefined) ui.openPalette(palette);
    if (!press) return;
    // the control appears with the screen's first paint after the sample
    let tries = 0;
    const find = () => {
      const el = document.querySelector(press);
      if (el instanceof HTMLElement) el.click();
      else if (tries++ < 60) requestAnimationFrame(find);
    };
    find();
  }, [ui, m, open, palette, press]);
  return null;
}

/** The whole dashboard (`App`) on a sample, opened on a drawer, the command bar or a control. Only ever in a frame. */
export function Screen({ seed, ...opening }: { seed: Seed } & Opening) {
  return (
    <Seeded seed={seed}>
      <App />
      <Opener {...opening} />
    </Seeded>
  );
}

/** Keeps one broken state from taking the catalog down with it, and says what broke. */
export class Contained extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    return this.state.error ? <p className="text-sm text-bad">This state didn't render: {this.state.error}</p> : this.props.children;
  }
}
