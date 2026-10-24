import { beforeEach, expect, test } from "bun:test";
import { plainWords as w } from "@overhand/themes";
import { render, withDom } from "./render.test-util";

/**
 * Focus, rendered for real on the demo night at 08:00: what needs you, what finished and what broke stay; what agents
 * are saying, subagents and the day's in-between beats fold behind "Show steps", which opens them. Its default: on for
 * a new install, off for one already in use, whatever this browser chose first.
 */
withDom();

const KEY = "overhand-focus";
/** The demo's own session: what it says, a step Focus folds. */
const SAYS = "The balance is on the order, not the card";

beforeEach(() => localStorage.clear());

/** Needs you, the crew and the day so far, side by side, as the bridge shows them. */
async function bridge(): Promise<HTMLElement> {
  const { NeedsYou } = await import("./now/Alerts");
  const { Cast } = await import("./now/Cast");
  const { Activity } = await import("./now/Activity");
  return render((m) => (
    <>
      <div data-test="needs">
        <NeedsYou m={m} />
      </div>
      <Cast m={m} />
      <Activity m={m} />
    </>
  ));
}

const stepButtons = (el: HTMLElement) => [...el.querySelectorAll("button")].filter((b) => b.textContent?.includes(w.showSteps));

test("Focus keeps what needs you, what finished and what broke, and folds the steps", async () => {
  localStorage.setItem(KEY, "0");
  const off = await bridge();
  const needsOff = off.querySelector('[data-test="needs"]')?.textContent;
  expect(off.textContent).toContain(SAYS);
  expect(off.querySelector(`[aria-label="${w.subagents}"]`)).not.toBeNull();
  expect(off.textContent).toContain("woke up");
  expect(stepButtons(off)).toEqual([]);

  localStorage.setItem(KEY, "1");
  const on = await bridge();
  const text = on.textContent ?? "";
  // kept: needs you, unchanged; results; anything broken; a restart loop
  expect(on.querySelector('[data-test="needs"]')?.textContent).toBe(needsOff);
  expect(text).toContain("SHOP-142 shipped a pull request");
  expect(text).toContain("checks went red");
  expect(text).toContain("keeps restarting");
  // folded: what agents say, subagents, wake-ups and quiet finishes
  expect(text).not.toContain(SAYS);
  expect(on.querySelector(`[aria-label="${w.subagents}"]`)).toBeNull();
  expect(text).not.toContain("woke up");

  // each fold is a real button that says whether it's open, and opens its full trail
  const folds = stepButtons(on);
  expect(folds.length).toBeGreaterThan(1);
  for (const b of folds) expect(b.getAttribute("aria-expanded")).toBe("false");
  const { act } = await import("react");
  await act(async () => {
    for (const b of folds) b.click();
  });
  for (const b of folds) expect(b.getAttribute("aria-expanded")).toBe("true");
  expect(on.textContent).toContain(SAYS);
  expect(on.querySelector(`[aria-label="${w.subagents}"]`)).not.toBeNull();
  expect(on.textContent).toContain("woke up");
});

test("Focus starts on for a new install and off for one in use, then keeps what this browser chose", async () => {
  const { focusOn, settleFocus, setFocus } = await import("@/app/focus");
  expect(focusOn(null, true, false)).toBe(true);
  expect(focusOn(null, false, false)).toBe(false);
  expect(focusOn(null, false, true)).toBe(true); // the demo
  expect(focusOn("0", true, true)).toBe(false);
  expect(focusOn("1", false, false)).toBe(true);

  // the first state pins the default, so a new install stays in Focus after its first day
  settleFocus(true);
  expect(localStorage.getItem(KEY)).toBe("1");
  settleFocus(false);
  expect(localStorage.getItem(KEY)).toBe("1");
  localStorage.clear();
  settleFocus(false);
  expect(localStorage.getItem(KEY)).toBe("0");
  // the switch and the F key: everything showing Focus (the bridge rendered above, still mounted) follows at once
  const { act } = await import("react");
  await act(async () => setFocus(true));
  expect(localStorage.getItem(KEY)).toBe("1");
});
