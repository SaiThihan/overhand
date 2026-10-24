import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import overhand from "../src/overhand";
import { SYSTEM, systemCss } from "../src/system";

test("system.css is what systemCss() writes", () => {
  expect(readFileSync(join(import.meta.dir, "../system.css"), "utf8")).toBe(systemCss());
});

test("the house theme reads the system", () => {
  expect(overhand.ink).toEqual(SYSTEM.ink.night);
  expect(overhand.lightInk).toEqual(SYSTEM.ink.day);
  expect(overhand.tokens["radius-control"]).toBe(SYSTEM.radius.control);
  expect(overhand.tokens.ok).toBe(SYSTEM.state.night.ok);
  expect(overhand.light?.ok).toBe(SYSTEM.state.day.ok);
});

test("motion keeps its values", () => {
  expect(SYSTEM.motion).toMatchObject({ instant: 120, base: 240, slow: 480, stagger: 50, loop: 1600, rise: 6 });
});
