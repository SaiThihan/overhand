import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blankConfig } from "../src/config";
import { quietUntil } from "../src/governor";
import { act, type CardContext, detectCards } from "../src/room";
import {
  attribute,
  blankStrain,
  causeOf,
  gauges,
  parseCosts,
  parseMeminfo,
  type Reading,
  RING,
  sustained,
  takeSample,
  whoLabel,
  worst,
} from "../src/strain";

const G = blankConfig("t").governor; // maxLoadPerCore 1.5, minBattery 30, pauseHeavy 8 GB, warn 15 GB
const NOW = new Date(2026, 9, 20, 16, 0).getTime();
const reading = (over: Partial<Reading> = {}): Reading => ({
  at: NOW,
  loadPerCore: 0.3,
  battery: null,
  throttled: false,
  freeGb: 100,
  mem: 0.5,
  ...over,
});
const level = (r: Reading, what: string) => gauges(r, G).find((g) => g.what === what)?.level;

test("thresholds: processor, memory and disk green, amber and red; battery and heat only when they matter", () => {
  expect(gauges(reading(), G).map((g) => [g.what, g.level])).toEqual([
    ["cpu", "ok"],
    ["mem", "ok"],
    ["disk", "ok"],
  ]);
  expect(level(reading({ loadPerCore: 0.8 }), "cpu")).toBe("warn");
  expect(level(reading({ loadPerCore: 9 }), "cpu")).toBe("bad"); // today's 9× capacity
  expect(level(reading({ mem: 0.85 }), "mem")).toBe("warn");
  expect(level(reading({ mem: 0.95 }), "mem")).toBe("bad");
  expect(level(reading({ freeGb: 12 }), "disk")).toBe("warn");
  expect(level(reading({ freeGb: 5 }), "disk")).toBe("bad");
  expect(level(reading({ battery: { pct: 80, charging: true } }), "battery")).toBeUndefined();
  expect(level(reading({ battery: { pct: 40, charging: false } }), "battery")).toBe("warn");
  expect(level(reading({ battery: { pct: 20, charging: false } }), "battery")).toBe("bad");
  expect(level(reading({ throttled: true }), "heat")).toBe("bad");
  expect(worst(["ok", "warn", "ok"])).toBe("warn");
  expect(parseMeminfo("MemTotal:  16000000 kB\nMemFree: 1000 kB\nMemAvailable:  4000000 kB\n")).toBe(0.75);
  expect(parseMeminfo("nothing")).toBeNull();
});

/** ps rows: your orchard session (200) with a lane of browsers, an agent (100), and your own apps (900, 901). */
const PS = `
  100     1   100  50.0  400000
  101   100   101  30.0  100000
  200    50   200   5.0  300000
  201   200   201 300.0 2000000
  202   201   201 250.0 1500000
  900     1   900  80.0  800000
  901     1   901  20.0  200000
`;

test("attribution: CPU and memory by session tree, largest first; everything else is one unnamed total", () => {
  const table = parseCosts(PS);
  expect(table).toHaveLength(7);
  const sessions = [
    { pid: 100, project: "Honey", branch: "HC-1", name: "", browsers: 0, heavy: [{ kind: "suite" }] },
    { pid: 200, project: "orchard", branch: "spring-sale", name: "", browsers: 19, heavy: [{ kind: "browser" }] },
  ];
  const a = attribute(sessions, table, 10);
  expect(a.groups.map((g) => g.label)).toEqual([
    "orchard · spring-sale · browser jobs · 19 headless browsers",
    "Honey · HC-1 · suite jobs",
  ]);
  expect(a.groups[0]?.cpu).toBeCloseTo(0.555);
  expect(a.groups[0]?.memMb).toBe(Math.round(3800000 / 1024));
  expect(a.groups[1]?.cpu).toBeCloseTo(0.08);
  expect(a.other.cpu).toBeCloseTo(0.1);
  expect(a.other.memMb).toBe(Math.round(1000000 / 1024)); // your apps: a total, never a name
  expect(causeOf(a)).toBe("orchard · spring-sale · browser jobs · 19 headless browsers");
  expect(causeOf({ groups: [{ label: "x", cpu: 0.1, memMb: 1 }], other: { cpu: 2, memMb: 1 } })).toBe("other apps");
  expect(whoLabel({ pid: 1, project: "p", branch: "", name: "design checks", browsers: 0, heavy: [] })).toBe("p · design checks");
});

test("sampler: a 3-hour ring; who's causing it is worked out only while strained, and red points name the cause", () => {
  const st = blankStrain();
  let asked = 0;
  const who = () => {
    asked++;
    return { groups: [{ label: "orchard · 19 headless browsers", cpu: 5, memMb: 3000 }], other: { cpu: 1, memMb: 900 } };
  };
  expect(takeSample(st, reading(), G, who)).toEqual({ at: NOW, cpu: 0.3, mem: 0.5, level: "ok", cause: "" });
  expect(asked).toBe(0); // a calm machine costs one loadavg and one memory read
  const spike = takeSample(st, reading({ at: NOW + 60_000, loadPerCore: 9 }), G, who);
  expect(spike).toMatchObject({ level: "bad", cause: "orchard · 19 headless browsers" });
  expect(asked).toBe(1);
  expect(st.groups).toHaveLength(1);
  expect(takeSample(st, reading({ at: NOW + 120_000, loadPerCore: 0.9 }), G, who)).toMatchObject({ level: "warn", cause: "" });
  takeSample(st, reading({ at: NOW + 180_000 }), G, who);
  expect(st.groups).toEqual([]); // calm again: nothing attributed
  for (let i = 0; i < RING + 20; i++) takeSample(st, reading({ at: NOW + i * 60_000 }), G, who);
  expect(st.history).toHaveLength(RING);
  expect(sustained(st)).toBe(false);
  for (let i = 0; i < 3; i++) takeSample(st, reading({ loadPerCore: 9 }), G, who);
  expect(sustained(st)).toBe(true);
});

test("the strain card: only when overload is sustained, named by its cause; its buttons slow heavy jobs or turn quiet on", async () => {
  const ctx: CardContext = {
    rows: [],
    quietUntil: 0,
    load1: 90,
    loadPerCore: 9,
    maxLoadPerCore: 1.5,
    silentMin: 10,
    requests: [],
    approvals: [],
    snoozed: {},
    exempt: () => false,
    extended: () => false,
    now: NOW,
  };
  expect(detectCards(ctx).some((c) => c.kind === "strain")).toBe(false);
  const [card] = detectCards({ ...ctx, strain: { cpu: 9.04, cause: "orchard · 19 headless browsers" } });
  expect(card).toMatchObject({
    id: "strain",
    kind: "strain",
    facts: { cause: "orchard · 19 headless browsers", x: 9 },
    buttons: ["one-at-a-time", "quiet"],
  });
  if (!card) throw new Error("no card");
  const ops = mkdtempSync(join(tmpdir(), "overhand-strain-"));
  const saved: (typeof cfg)[] = [];
  const cfg = blankConfig("t");
  const env = {
    ops,
    cfg,
    save: (c: typeof cfg) => saved.push(c),
    table: () => [],
    isProtected: () => null,
    kill: async () => 0,
    run: () => ({ ok: true, out: "", err: "" }),
    now: NOW,
  };
  expect((await act(card, "one-at-a-time", [], env)).result).toBe("heavy jobs run one at a time from now");
  expect(saved[0]?.governor.slots.browser).toBe(1);
  expect((await act(card, "quiet", [], env)).result).toBe("quiet mode until 18:00: no new heavy jobs start");
  expect(quietUntil(ops, NOW)).toBe(NOW + 2 * 3_600_000);
  // answered: it doesn't ask again for half an hour
  expect(JSON.parse(readFileSync(join(ops, "control", "snooze.json"), "utf8")).strain).toBe(NOW + 30 * 60_000);
});
