import { expect, test } from "bun:test";
import { hourLight } from "./hour";

const at = (h: number, m = 0) => new Date(2026, 9, 20, h, m).getTime();
const rgb = (s: string) => s.slice(4, -1).split(" ").map(Number);

test("the map's light follows the hour: dark at night, day at noon, warm at dawn", () => {
  expect(hourLight(at(2)).night).toBeGreaterThan(0.9);
  expect(hourLight(at(13)).night).toBe(0);
  const [r = 0, , b = 0] = rgb(hourLight(at(6, 40)).tint);
  expect(r).toBeGreaterThan(b);
  // eased to the quarter hour: two polls a minute apart give the same light
  expect(hourLight(at(6, 31))).toEqual(hourLight(at(6, 44)));
});
