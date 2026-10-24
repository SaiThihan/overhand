import { afterEach, expect, test } from "bun:test";
import { markParts } from "@overhand/themes";
import { renderToStaticMarkup } from "react-dom/server";
import { Boot } from "./Boot";
import { Logo } from "./Logo";

const real = globalThis.matchMedia;
/** Pretends the viewer asked for reduced motion (or didn't). */
const prefersReduced = (on: boolean) => {
  globalThis.matchMedia = ((q: string) => ({ matches: on && q.includes("reduce"), media: q })) as typeof matchMedia;
};
afterEach(() => {
  globalThis.matchMedia = real;
});

test("the loader shows only until the first state arrives", () => {
  prefersReduced(false);
  const waiting = renderToStaticMarkup(<Boot ready={false} label="Starting…" />);
  expect(waiting).toContain('role="status"');
  expect(waiting).toContain("data-loader");
  // your square moves; the work holds still
  expect(waiting).toContain("m-handover");
  // the words are always read out
  expect(waiting).toContain("Starting…");
  expect(renderToStaticMarkup(<Boot ready label="Starting…" />)).toBe("");
});

test("under reduced motion it's the still mark with a Starting… line", () => {
  prefersReduced(true);
  const still = renderToStaticMarkup(<Boot ready={false} label="Starting…" />);
  expect(still).not.toContain("m-handover");
  expect(still).toContain("Starting…");
  expect(still).not.toContain("sr-only");
});

test("the header's mark is the Hand over mark, drawn from brand.ts", () => {
  const html = renderToStaticMarkup(<Logo size={20} />);
  const p = markParts(20);
  expect(html).toContain(`stroke-width="${p.stroke}"`);
  expect(html).toContain(`width="${p.side}"`);
  expect(html).toContain("var(--you-fill)");
  expect(html).toContain("var(--ink-12)");
  expect(html).toContain("Overhand");
});
