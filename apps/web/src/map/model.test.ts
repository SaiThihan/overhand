import { expect, test } from "bun:test";
import type { DashboardState } from "@overhand/contract";
import { NOW, state } from "@overhand/contract/fixtures/state";
import type { Alert } from "@/lib/alerts";
import { CAP, type LabelItem, mapFrom, placeLabels, polar, R } from "./model";

const run = (name: string): DashboardState["running"][number] => ({
  name,
  account: "a",
  cwd: "/x",
  startedAt: NOW - 600_000,
  pid: name.length * 7 + Number(name.split("-")[1]),
});
const ask = (key: string): Alert => ({ sev: 2, title: `Review ${key}`, sub: "", target: { kind: "review", key } });
const dist = (a: { x: number; y: number }) => Math.hypot(a.x, a.y);

test("rings: what needs you is innermost, working in the middle, done outside", () => {
  const s = state({
    running: [run("HONEY-1"), run("HONEY-2")],
    prs: [{ key: "HONEY-3", url: "u", fixes: 0, branch: "b", draft: false, corners: [], preview: "", reviewRound: 0 }],
  });
  const m = mapFrom(s, [ask("HONEY-2")], 1, NOW);
  const by = (id: string) => m.agents.find((a) => a.id === id);
  expect(by("HONEY-2")?.state).toBe("waiting");
  expect(by("HONEY-1")?.state).toBe("working");
  expect(by("HONEY-3")?.state).toBe("done");
  const [w, k, d] = ["HONEY-2", "HONEY-1", "HONEY-3"].map((id) => dist(by(id) ?? { x: 0, y: 0 }));
  expect(w).toBeLessThan(R.r1);
  expect(k).toBeGreaterThan(R.r1);
  expect(k).toBeLessThan(R.r2);
  expect(d).toBeGreaterThan(R.r2);
  // one agent per ticket: the run that asks is the one drawn, not a second dot
  expect(m.agents.filter((a) => a.id === "HONEY-2")).toHaveLength(1);
});

test("past CAP the quiet gather into a crew, and what waits on you never does", () => {
  const keys = Array.from({ length: 12 }, (_, i) => `HONEY-${i + 1}`);
  const asks = keys.slice(0, 3).map(ask);
  const m = mapFrom(state({ running: keys.map(run) }), asks, 3, NOW);
  expect(m.agents.filter((a) => a.state === "waiting")).toHaveLength(3);
  expect(m.agents.length).toBeLessThanOrEqual(CAP);
  expect(m.crews).toHaveLength(1);
  expect((m.crews[0]?.count ?? 0) + m.agents.length).toBe(12);
});

test("each project owns its sector, and its agents stay inside it", () => {
  const s = state({
    clients: [
      { name: "Honeycrust", prefix: "HONEY", host: "github", autonomy: "act", assignedAutonomy: "act" },
      { name: "Fernway", prefix: "FERN", host: "github", autonomy: "act", assignedAutonomy: "act" },
    ],
    running: [run("HONEY-1"), run("FERN-1"), run("FERN-2")],
  });
  const m = mapFrom(s, [], 0, NOW);
  for (const a of m.agents) {
    const sec = m.sectors[a.sector];
    expect(a.angle).toBeGreaterThan(sec?.a0 ?? 0);
    expect(a.angle).toBeLessThan((sec?.a0 ?? 0) + (sec?.span ?? 0));
  }
  expect(m.agents.find((a) => a.id === "FERN-2")?.sector).toBe(1);
});

test("names that must show never overlap each other or any object, crowded or not", () => {
  // the owner's crowd: five asks packed into one sector of the inner ring, working objects just outside them
  const k = 1000 / 700;
  const names = ["Honeycrust lead", "HONEY-1693", "HONEY-1155", "HONEY-1201", "Potluck lead"];
  const items: LabelItem[] = [
    ...names.map((text, i) => {
      const [x, y] = polar(138, 20 + i * 14);
      return { id: text, x, y, text, named: true };
    }),
    ...Array.from({ length: 6 }, (_, i) => {
      const [x, y] = polar(269, 10 + i * 13);
      return { id: `w${i}`, x, y, text: `HONEY-${i}`, named: false };
    }),
  ];
  const spots = placeLabels(items, k);
  const boxes = names.flatMap((n) => {
    const s = spots.get(n);
    if (!s) return [];
    const w = n.length * 0.6 * 12 * k;
    const x0 = s.anchor === "start" ? s.x : s.anchor === "end" ? s.x - w : s.x - w / 2;
    return [[x0, s.y - 7.8 * k, x0 + w, s.y + 7.8 * k] as const];
  });
  // most still get a name on the map; any left over show on hover
  expect(boxes.length).toBeGreaterThanOrEqual(4);
  for (const a of boxes) for (const b of boxes) if (a !== b) expect(a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]).toBe(false);
  for (const b of boxes)
    for (const o of items) {
      const nx = Math.max(b[0], Math.min(o.x, b[2]));
      const ny = Math.max(b[1], Math.min(o.y, b[3]));
      expect(Math.hypot(nx - o.x, ny - o.y)).toBeGreaterThanOrEqual(15 * k);
    }
});
