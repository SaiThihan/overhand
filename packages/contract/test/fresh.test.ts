import { expect, test } from "bun:test";
import { askGate, FRESH_MIN, isStale } from "../src/index";

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 23, 9, 0);

test("a read is stale past FRESH_MIN; never read is stale", () => {
  expect(isStale(NOW - (FRESH_MIN + 1) * MIN, NOW)).toBe(true);
  expect(isStale(NOW - (FRESH_MIN - 1) * MIN, NOW)).toBe(false);
  expect(isStale(0, NOW)).toBe(true);
});

test("the gate asks once per FRESH_MIN, and only when the read itself is old", () => {
  const gate = askGate();
  const old = NOW - 30 * MIN;
  expect(gate(NOW - 2 * MIN, NOW)).toBe(false); // read two minutes ago: nothing to ask
  expect(gate(old, NOW)).toBe(true);
  expect(gate(old, NOW + MIN)).toBe(false); // a second tab, a minute later
  expect(gate(old, NOW + 9 * MIN)).toBe(false);
  expect(gate(old, NOW + (FRESH_MIN + 1) * MIN)).toBe(true);
});
