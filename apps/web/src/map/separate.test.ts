import { expect, test } from "bun:test";
import { type Draft, type MapSector, place, R, separate } from "./model";

const sectors: MapSector[] = ["Potluck", "Honeycrust", "Bluekite", "Fernway"].map((name, i) => ({
  name,
  a0: i * 90,
  span: 90,
  merged: 0,
  broken: false,
}));
const draft = (id: string, sector: number, state: Draft["state"], lead = false): Draft => ({
  id,
  label: id,
  note: "",
  state,
  lead,
  sector,
  subs: 0,
  progress: 0,
  open: { kind: "ticket", key: id },
});
const gaps = (agents: { x: number; y: number }[]) =>
  agents.flatMap((a, i) => agents.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y)));

test("an idle lead and a done PR in one project never stack (the outer band spreads them as one row)", () => {
  const { agents } = place(sectors, [draft("lead:honey", 1, "idle", true), draft("HONEY-142", 1, "done")]);
  expect(Math.min(...gaps(agents))).toBeGreaterThan(40);
});

test("separate: agents end at least `min` apart, each in its own ring band and project sector", () => {
  // the sample morning's crowded corner: two asking in one project, plus a done and an idle beside them
  const drafts = [
    draft("KITE-31", 2, "waiting"),
    draft("lead:kite", 2, "waiting", true),
    draft("FERN-88", 3, "waiting"),
    draft("lead:fern", 3, "idle", true),
    draft("POT-12", 0, "done"),
    draft("lead:pot", 0, "waiting", true),
  ];
  const placed = { waiting: 4, sectors, ...place(sectors, drafts) };
  const min = 110;
  const out = separate(placed, min, 20);
  expect(Math.min(...gaps(out.agents))).toBeGreaterThanOrEqual(min - 0.5);
  for (const a of out.agents) {
    const r = Math.hypot(a.x, a.y);
    const [lo, hi] = a.state === "waiting" ? [R.r0, R.r1] : [R.r2, R.r3];
    expect(r).toBeGreaterThanOrEqual(lo);
    expect(r).toBeLessThanOrEqual(hi);
    const sec = sectors[a.sector];
    expect(a.angle).toBeGreaterThanOrEqual(sec?.a0 ?? 0);
    expect(a.angle).toBeLessThanOrEqual((sec?.a0 ?? 0) + (sec?.span ?? 0));
  }
});
