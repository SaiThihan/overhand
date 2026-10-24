import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SYSTEM } from "@overhand/themes";

/**
 * A live piece's one focus (focusOnce): the rest dims, the card lifts, then it all settles; never under reduced motion.
 * It runs as Web Animations only, so a card's own CSS animation (its entrance) is never replaced or replayed.
 */
let reduce = false;
type Motion = typeof import("./motion");
let motion: Motion;
beforeAll(async () => {
  GlobalRegistrator.register();
  globalThis.matchMedia = ((q: string) => ({ matches: reduce && q.includes("reduce"), media: q })) as typeof matchMedia;
  motion = await import("./motion");
});
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => {
  reduce = false;
  // the cards as Needs you draws them: each with its entrance (.m-enter, a CSS animation) already on
  document.body.innerHTML = `<div id="piece"><h2>Needs you</h2><ul>
    <li id="new" class="m-enter"><span class="dot"></span><button data-variant="answer">Go with the default</button></li>
    <li id="old" class="m-enter"><button data-variant="answer">Answer</button></li></ul></div>`;
});
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Every Web Animation running in the piece, by the element it moves. */
const running = () =>
  [...document.querySelectorAll("#piece, #piece *")].flatMap((x) => x.getAnimations().map(() => x.id || x.tagName.toLowerCase()));
/** What's on every element's class list and style: focusOnce must leave both as it found them, but for the ring. */
const marks = () =>
  [...document.querySelectorAll("#piece *")].map((x) => `${x.id || x.tagName}:${x.className}:${(x as HTMLElement).style.cssText}`);

test("the card lifts, the rest dims and its answer pulses, as Web Animations; after the hold they're gone", async () => {
  const before = marks();
  motion.focusOnce($("new"), $("piece"), 30);
  const on = running();
  // the card (its lift and its ring's fade), its answer, the other card and the pane's title; never the list around it
  expect(on.filter((x) => x === "new")).toHaveLength(2);
  expect(on).toContain("button");
  expect(on).toContain("old");
  expect(on).toContain("h2");
  expect(on).not.toContain("ul");
  expect($("old").querySelector("button")?.getAnimations()).toHaveLength(0);
  // its mark locks on and it wears the ring; nothing else is added
  expect($("new").classList.contains("m-ring")).toBe(true);
  expect($("new").querySelector(".dot")?.classList.contains("m-lockon")).toBe(true);
  await wait(60);
  expect(running()).toEqual([]);
  // settled: every card's class list (its entrance included) and style are as they were, so no entrance replays
  expect(marks()).toEqual(before);
});

test("settling at once cancels every animation and takes the ring away", () => {
  const before = marks();
  const settle = motion.focusOnce($("new"), $("piece"), 10_000);
  expect(running().length).toBeGreaterThan(0);
  settle();
  expect(running()).toEqual([]);
  expect(marks()).toEqual(before);
});

test("under reduced motion nothing moves and nothing is marked", () => {
  reduce = true;
  const before = marks();
  motion.focusOnce($("new"), $("piece"), 20);
  expect(running()).toEqual([]);
  expect(marks()).toEqual(before);
});

test("its hold and look are the system's own, and the ring stays inside a pane's padding", () => {
  expect(motion.MOTION.hold).toBeGreaterThan(motion.MOTION.slow * 2);
  expect(motion.MOTION.lift).toBeLessThanOrEqual(1.02);
  expect(motion.MOTION.dim).toBe(0.5);
  // how far the ring's shadow reaches past the card: the ring's inset (a sixth of the gap) and its lowest shadow
  const reach = Math.max(
    ...SYSTEM.liftRing.split(/,\s*(?![^()]*\))/).map((sh) => {
      const [x = 0, y = 0, blur = 0, spread = 0] = (sh.match(/-?\d+(?=px)|(?<=\s|^)0(?=\s)/g) ?? []).map(Number);
      return Math.max(Math.abs(x), Math.abs(y)) + blur + spread;
    }),
  );
  expect(reach + SYSTEM.space.gap / 6).toBeLessThanOrEqual(SYSTEM.space.panePhone);
});
