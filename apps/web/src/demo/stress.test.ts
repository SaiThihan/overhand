import { expect, test } from "bun:test";
import { pipeline } from "@/lib/pipeline";
import { parsePlan } from "@/lib/plan";
import { MORNING } from "./moments";
import { nightAt } from "./night";
import { stressed } from "./stress";

test("the stress night fills Planned, empties Running, and stretches names and numbers, still a valid state", () => {
  const s = stressed(nightAt(MORNING));
  const flow = pipeline(s, parsePlan(s.plan));
  expect(flow.planned.length).toBeGreaterThanOrEqual(20);
  expect(flow.running).toEqual([]);
  expect(Math.min(...s.clients.map((c) => c.name.length))).toBeGreaterThan(40);
  expect(flow.planned.some((c) => /[A-Za-z]{40}/.test(c.title))).toBe(true);
  expect(String(s.week.opened).length).toBeGreaterThanOrEqual(5);
});
