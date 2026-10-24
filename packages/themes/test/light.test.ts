import { expect, test } from "bun:test";
import { lightAt } from "../src/light";

test("the light glides: no jump between neighbouring minutes, and midnight joins itself", () => {
  for (let h = 0; h < 24; h += 1 / 60) {
    const a = lightAt(h).skyTop;
    const b = lightAt(h + 1 / 60).skyTop;
    expect(Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? 0))))).toBeLessThan(6);
  }
  expect(lightAt(0)).toEqual(lightAt(24));
  expect(lightAt(0).day).toBe(0);
  expect(lightAt(2).day).toBeLessThan(0.1);
  expect(lightAt(12).day).toBe(1);
});
