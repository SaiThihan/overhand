import { expect, test } from "bun:test";
import { DEMO, demoClock } from "./demo";

test("the clock store's snapshot is stable between reads outside the demo", async () => {
  expect(DEMO).toBe(false);
  const a = demoClock.get();
  await Bun.sleep(5);
  // a snapshot that changes on every read makes React re-render until it gives up (error #185)
  expect(demoClock.get()).toBe(a);
});
