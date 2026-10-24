import { expect, test } from "bun:test";
import { rng, type Sample, verdict } from "./soak";

/** A flat, quiet run: every tenth sample idle. */
const flat = (n = 40): Sample[] =>
  Array.from({ length: n }, (_, i) => ({
    t: i * 30,
    idle: i % 10 === 9,
    heapMb: 16 + (i % 3) * 0.2,
    nodes: 2000 + (i % 5) * 20,
    listeners: 600,
    tabCpu: i % 10 === 9 ? 1.5 : 30,
    netKbMin: i % 10 === 9 ? 100 : 2000,
    daemonRssMb: 120 + (i % 4),
    daemonCpu: 0.8,
    lines: i * 50,
  }));
const failing = (s: Sample[]) =>
  verdict(s, 120)
    .filter((c) => !c.ok)
    .map((c) => c.name);

test("a flat run passes every budget; busy intervals don't count against idle", () => {
  expect(failing(flat())).toEqual([]);
});

test("growth after warm-up fails, however it's spread", () => {
  const leaky = flat().map((s, i) => ({ ...s, heapMb: s.heapMb + i * 0.5, nodes: s.nodes + i * 60 }));
  expect(failing(leaky)).toEqual(["tab heap", "tab DOM nodes"]);
  // growth inside the warm-up is the page settling, not a leak
  const settling = flat().map((s) => ({ ...s, listeners: s.t < 120 ? 100 + s.t : 600 }));
  expect(failing(settling)).toEqual([]);
});

test("a daemon that balloons, or an idle tab that costs, fails", () => {
  expect(failing(flat().map((s, i) => ({ ...s, daemonRssMb: i === 35 ? 400 : s.daemonRssMb })))).toEqual(["daemon RSS"]);
  // memory given back early isn't growth: high, then released, then steady passes
  expect(failing(flat().map((s, i) => ({ ...s, daemonRssMb: i < 8 ? 133 : 60 + (i % 4) })))).toEqual([]);
  expect(failing(flat().map((s) => ({ ...s, tabCpu: s.idle ? 9 : s.tabCpu })))).toEqual(["tab idle CPU"]);
  // a run with no idle stretch can't say what idle costs: that's a failure, not a pass
  expect(failing(flat().map((s) => ({ ...s, idle: false })))).toContain("tab idle CPU");
  expect(failing(flat(5))).toEqual(["samples"]);
});

test("the day replays the same for the same seed", () => {
  const a = rng(7);
  const b = rng(7);
  expect(Array.from({ length: 5 }, a)).toEqual(Array.from({ length: 5 }, b));
});
