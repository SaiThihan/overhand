import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { OPS, SRC } from "../src/env";

test("tests never resolve OPS to the checkout, whose state a dev daemon serves", () => {
  expect(process.env.OVERHAND_HOME).toBeTruthy();
  expect(resolve(OPS)).not.toBe(resolve(SRC));
  expect(resolve(OPS).startsWith(`${resolve(SRC)}/`)).toBe(false);
});
