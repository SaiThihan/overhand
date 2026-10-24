import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { callCounts, noteCalls } from "../src/calls";
import { OPS } from "../src/env";

const DAY = 864e5;
const NOW = 100 * DAY;
afterAll(() => rmSync(join(OPS, "calls.json"), { force: true }));

test("a call counts once, by when it first appeared, however many screens report it; two weeks are compared", () => {
  rmSync(join(OPS, "calls.json"), { force: true });
  expect(noteCalls(["lead:a", "review:x"], NOW - 10 * DAY)).toBe(2);
  expect(noteCalls(["lead:a", "review:x"], NOW - 9 * DAY)).toBe(0); // the same items, again
  expect(noteCalls(["lead:b", "lead:b", "", "held:1"], NOW - DAY)).toBe(2); // duplicates and blanks don't count
  expect(callCounts(NOW)).toEqual({ week: 2, last: 2 });
  // older than the two weeks: forgotten when the file is next written
  noteCalls(["pr:z"], NOW + 20 * DAY);
  expect(callCounts(NOW + 20 * DAY)).toEqual({ week: 1, last: 0 });
});

test("ids are clipped and capped at the trust boundary", () => {
  rmSync(join(OPS, "calls.json"), { force: true });
  const many = Array.from({ length: 500 }, (_, i) => `x:${i}`);
  expect(noteCalls(many, NOW)).toBe(200);
  expect(noteCalls(["y".repeat(5000)], NOW)).toBe(1);
  expect(callCounts(NOW).week).toBe(201);
});
