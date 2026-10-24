import { expect, test } from "bun:test";
import { clock, money } from "./format";

test("money keeps cents under $1,000 and groups a big figure without them", () => {
  expect(money(3.5)).toBe("$3.50");
  expect(money(999.99)).toBe("$999.99");
  expect(money(259120.4)).toBe("$259,120");
});

test("a run's stopwatch splits hours out instead of counting minutes past 59", () => {
  expect(clock(0)).toBe("0:00");
  expect(clock(245)).toBe("4:05");
  expect(clock(3599)).toBe("59:59");
  expect(clock(3600)).toBe("1:00:00");
  expect(clock(916 * 60 + 6)).toBe("15:16:06");
});
