import { expect, test } from "bun:test";
import { bridgeLayout, dockWidth } from "./layout";

// the bridge's width is the viewport less main's 48px of padding
const at = (viewport: number) => bridgeLayout(viewport - 48);

test("the bridge: two columns at lg, three from xl, four from 3xl, five from 4xl", () => {
  expect(at(1024).name).toBe("two");
  expect(at(1279).name).toBe("two");
  expect(at(1280).name).toBe("three");
  expect(at(1440).columns).toBe("21rem minmax(0,1fr) 22rem");
  expect(at(1536).columns).toBe("24rem minmax(0,1fr) 26rem");
  expect(at(2199).name).toBe("three");
  expect(at(2200).name).toBe("four");
  expect(at(2560).tracks).toEqual([["needs", "today", "activity"], ["window"], ["crew"], ["work", "health"]]);
  expect(at(3200).name).toBe("five");
  expect(at(3200).tracks).toEqual([["needs"], ["today", "activity"], ["window"], ["crew"], ["work", "health"]]);
});

test("every layout has one window and every pane once", () => {
  for (const v of [1024, 1280, 1536, 2200, 3200]) {
    const slots = at(v).tracks.flat();
    expect(slots.filter((s) => s === "window").length).toBe(1);
    expect(new Set(slots).size).toBe(slots.length);
    expect(at(v).columns.split(/ (?![^(]*\))/).length).toBe(at(v).tracks.length);
  }
});

test("places dock beside the bridge from 3xl, and Work never leaves it less than 960px", () => {
  expect(dockWidth("crew", 2199)).toBe(0);
  expect(dockWidth("crew", 2560)).toBe(768);
  expect(dockWidth("work", 2200)).toBe(1240);
  expect(dockWidth("work", 5120)).toBe(1600);
  for (const v of [2200, 2560, 3440, 5120]) expect(v - dockWidth("work", v)).toBeGreaterThanOrEqual(960);
  // docked, the bridge falls back to fewer columns instead of squeezing them
  expect(bridgeLayout(2560 - 48 - dockWidth("work", 2560)).name).toBe("two");
});
