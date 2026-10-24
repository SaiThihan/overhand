import { beforeAll, beforeEach, expect, test } from "bun:test";
import { plainWords as w } from "@overhand/themes";
import { useState } from "react";
import { render, withDom } from "./render.test-util";

/**
 * Brief me, rendered for real on the demo night: the briefing drawer reads aloud, the header's button says Stop while it
 * does, and Stop, Escape or closing the drawer silence it at once.
 */
withDom();

/** What the page asked of the browser's voice. */
const calls: string[] = [];
let last: { onend: (() => void) | null } | null = null;

beforeAll(() => {
  class Utterance {
    voice: unknown = null;
    rate = 1;
    pitch = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { value: Utterance, configurable: true });
  const synth = {
    getVoices: () => [],
    speak(u: Utterance) {
      calls.push("speak");
      last = u;
    },
    cancel() {
      calls.push("cancel");
    },
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  Object.defineProperty(globalThis, "speechSynthesis", { value: synth, configurable: true });
});

beforeEach(() => {
  calls.length = 0;
});

/** The header and, while open, the briefing drawer, with a way to close it. */
async function page(): Promise<{ el: HTMLElement; close: () => Promise<void> }> {
  const { Header } = await import("./Header");
  const { BriefDrawer } = await import("./drawers/Simple");
  let shut: () => void = () => {};
  function Page({ m }: { m: import("@/app/data").Model }) {
    const [open, setOpen] = useState(true);
    shut = () => setOpen(false);
    return (
      <>
        <Header m={m} unreachable={false} />
        {open ? <BriefDrawer text="Two pull requests are ready." /> : null}
      </>
    );
  }
  const el = await render((m) => <Page m={m} />, false, true);
  const { act } = await import("react");
  return { el, close: () => act(async () => shut()) };
}

/** The button saying `label` in the header, or (with `inDrawer`) below it, in the briefing. */
const button = (el: HTMLElement, label: string, inDrawer = false) =>
  [...el.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label && (b.closest("header") === null) === inDrawer,
  );

test("the briefing's own Stop, beside Share, silences it and is gone once it's quiet", async () => {
  const { el } = await page();
  const stop = button(el, w.briefStop, true);
  expect(stop?.title).toBe(w.briefStopHint);
  const { act } = await import("react");
  calls.length = 0;
  await act(async () => stop?.click());
  expect(calls).toEqual(["cancel"]);
  expect(button(el, w.briefStop, true)).toBeUndefined();

  // read again, it ends by itself: the drawer's Stop goes with it
  const again = await page();
  expect(button(again.el, w.briefStop, true)).toBeDefined();
  await act(async () => last?.onend?.());
  expect(button(again.el, w.briefStop, true)).toBeUndefined();
});

test("while the brief is read aloud, the header's button is Stop, and Stop silences it at once", async () => {
  const { el } = await page();
  expect(calls).toContain("speak");
  const stop = button(el, w.briefStop);
  expect(stop).toBeDefined();
  const { act } = await import("react");
  calls.length = 0;
  await act(async () => stop?.click());
  expect(calls).toEqual(["cancel"]);
  expect(button(el, w.briefStop)).toBeUndefined();
});

test("Escape stops the voice", async () => {
  const { el } = await page();
  const { act } = await import("react");
  calls.length = 0;
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(calls).toEqual(["cancel"]);
  expect(button(el, w.briefStop)).toBeUndefined();
});

test("closing the drawer stops the voice; when it ends by itself the button is back", async () => {
  const first = await page();
  calls.length = 0;
  await first.close();
  expect(calls).toEqual(["cancel"]);
  expect(button(first.el, w.briefStop)).toBeUndefined();

  const { el } = await page();
  expect(button(el, w.briefStop)).toBeDefined();
  const { act } = await import("react");
  await act(async () => last?.onend?.());
  expect(button(el, w.briefStop)).toBeUndefined();
});
