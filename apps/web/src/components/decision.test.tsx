import { expect, test } from "bun:test";
import { factsBrief } from "@overhand/contract";
import { plainWords as w } from "@overhand/themes";
import { MORNING } from "@/demo/moments";
import { nightAt } from "@/demo/night";
import { stressed } from "@/demo/stress";
import { render, withDom } from "./render.test-util";

/**
 * A lead's question written as a Markdown table, on its full decision card: one plain sentence leads, the buttons
 * follow, and the table waits under Details, whole and drawn as a table.
 */
withDom();

const ID = "lead:release-check";

test("a table question's card leads with one plain sentence and keeps the table, whole, under Details", async () => {
  const b = factsBrief(stressed(nightAt(MORNING)), ID, {}, Date.now(), w);
  expect(b).not.toBeNull();
  if (!b) return;
  expect(b.what).toContain("into two pull requests now, or wait");
  expect(b.what).not.toMatch(/[|`*]/);
  const { DecisionCard } = await import("./DecisionCard");
  const el = await render((m) => <DecisionCard m={m} item={ID} />, false, false, [[["brief", ID], b]]);
  const primary = el.querySelector("[data-decision-primary]");
  const details = el.querySelector<HTMLDetailsElement>("details[data-decision-details]");
  expect(primary?.textContent ?? "").not.toMatch(/[|`]|CHANGES_REQUESTED|a1b2c3d4/);
  expect((primary?.textContent ?? "").length).toBeLessThan(600);
  expect(details?.open).toBe(false);
  // the table drawn as one, every cell whole
  expect(details?.querySelectorAll("table tr").length).toBe(3);
  expect(details?.textContent).toContain("The reviewer asks to split the database migration from the UI change before it can merge");
  expect(details?.textContent).toContain("https://example.com/checkout?step=payment&retry=3&locale=en-GB");
});
