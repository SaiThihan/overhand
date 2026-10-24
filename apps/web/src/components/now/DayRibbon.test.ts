import { expect, test } from "bun:test";
import { dayTicks, runBars } from "./DayRibbon";

const line = (min: number, text: string) =>
  `- ${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")} ${text}`;

test("a busy day's ticks stay bounded: one per five minutes, however many lines", () => {
  // three days' worth of lines in one log: the ribbon must not grow a mark per line (the open-all-day soak caught it)
  const reports = Array.from({ length: 5000 }, (_, i) => line(i % 1440, `SHOP-${i} started headless (pid 1)`));
  const ticks = dayTicks(reports);
  expect(ticks.length).toBe(1440 / 5);
  expect(new Set(ticks.map((t) => t.at)).size).toBe(ticks.length); // the key is unique
});

test("a shared tick takes the most severe line's colour and names what it holds", () => {
  const [t] = dayTicks([line(600, "inbox: 0 items"), line(601, "✗ SHOP-1 exited (code 1) after 3 min"), line(602, "✅ SHOP-2 done")]);
  expect(t?.line).toContain("✗");
  expect(t?.text.split("\n")).toHaveLength(3);
  const many = dayTicks(Array.from({ length: 7 }, (_, i) => line(600, `line ${i}`)));
  expect(many[0]?.text.split("\n").at(-1)).toBe("and 4 more");
});

test("runs that touch and ended alike share one bar; a failure or a live run stands apart", () => {
  const MIN = 60_000;
  const run = (start: number, end: number, ok = true, live = false) => ({
    name: `r${start}`,
    start: start * MIN,
    end: end * MIN,
    cost: 1,
    ok,
    live,
  });
  const bars = runBars([run(0, 10), run(12, 20), run(14, 30, false), run(40, 50), run(51, 60, true, true)]);
  expect(bars.map((b) => [b.count, b.ok, b.live])).toEqual([
    [2, true, false],
    [1, false, false],
    [1, true, false],
    [1, true, true],
  ]);
  expect(bars[0]?.cost).toBe(2);
  // a day of back-to-back runs is a handful of bars, not hundreds
  expect(runBars(Array.from({ length: 500 }, (_, i) => run(i * 2, i * 2 + 1))).length).toBe(1);
});
