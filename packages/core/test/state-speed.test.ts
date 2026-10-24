/**
 * /api/state is asked every few seconds by every open tab: building it must only read memory and small files. On
 * 2026-10-23 it ran ps, lsof, git, find and the key store inline (0.2 s every call, 2-5 s whenever a cache expired);
 * those reads now run on the dashboard's background timer (`refreshState`). A process spawned here fails this test.
 */
import { afterEach, expect, spyOn, test } from "bun:test";
import { dashboardState } from "../src/dashboard";

const spies = [spyOn(Bun, "spawnSync"), spyOn(Bun, "spawn")];
afterEach(() => {
  for (const s of spies) s.mockClear();
});

test("building the dashboard state spawns no process and answers in well under 50 ms", async () => {
  await dashboardState(); // the first call loads modules' lazy bits; it must not spawn either
  const t = performance.now();
  for (let i = 0; i < 5; i++) await dashboardState();
  const each = (performance.now() - t) / 5;
  expect(spies.flatMap((s) => s.mock.calls.map((c) => String(c[0])))).toEqual([]);
  expect(each).toBeLessThan(50);
});
