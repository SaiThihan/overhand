import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MapAgent, MapModel } from "./model";
import type { WorldCtx } from "./world";
import { instrument } from "./worlds/instrument";

const agent = (state: MapAgent["state"]): MapAgent => ({
  id: "HONEY-1",
  label: "HONEY-1",
  note: "",
  state,
  lead: false,
  sector: 0,
  subs: 0,
  progress: 0.5,
  open: { kind: "ticket", key: "HONEY-1" },
  x: 0,
  y: 0,
  angle: 0,
});
const ctx = (light: boolean, waiting: number): WorldCtx => {
  const model: MapModel = { waiting, sectors: [], agents: [], crews: [] };
  return { model, k: 1, u: 40, lod: "full", light, id: "t", you: "You" };
};
const mark = (st: MapAgent["state"], light: boolean) => renderToStaticMarkup(<g>{instrument.character(agent(st), ctx(light, 1))}</g>);

test("Instrument keeps its art: a halo round each lit mark, and the soft halo on your count", () => {
  // in the dark every lit state glows; on paper a working light glows in the hour's sky colour (hour.ts)
  for (const st of ["waiting", "working", "done"] as const) expect(mark(st, false), st).toContain(`class="halo halo-${st}"`);
  expect(mark("working", true)).toContain("url(#th-hour)");
  expect(mark("idle", false)).not.toContain('class="halo');
  expect(renderToStaticMarkup(<g>{instrument.centre(ctx(false, 2))}</g>)).toContain("url(#tyouhalo)");
  expect(renderToStaticMarkup(<g>{instrument.centre(ctx(false, 0))}</g>)).not.toContain("youhalo");
});
