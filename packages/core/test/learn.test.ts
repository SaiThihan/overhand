import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { OVERHAND_MARK, withMark } from "@overhand/contract";
import { notPerson } from "../src/agent";
import { CLIENTS, OPS } from "../src/env";
import { addRule, dismissRule, learnFrom, ruleOffers } from "../src/learn";

const DAY = 864e5;

test("guidance given on two PRs is offered once, then Not now and Add on watch take it away", async () => {
  const c = CLIENTS[0];
  if (!c) throw new Error("the example config has projects");
  rmSync(join(OPS, "rules.json"), { force: true });
  const now = Date.now();
  learnFrom(c.name, "web", `${c.prefix}-1`, ["Nit: please log errors with the request id", "Looks good otherwise"], now - 2 * DAY);
  learnFrom(c.name, "web", `${c.prefix}-1`, ["Please log errors with the request id"], now - DAY); // same PR: still once
  expect(ruleOffers(now)).toEqual([]);
  learnFrom(c.name, "web", `${c.prefix}-2`, ["Bob (review): Log errors with the request ID."], now);
  const [offer] = ruleOffers(now);
  expect(offer).toMatchObject({ project: c.name, repo: "web", rule: "Log errors with the request id", times: 2 });

  dismissRule(offer?.id ?? "", "later", now);
  expect(ruleOffers(now)).toEqual([]);
  expect(ruleOffers(now + 31 * DAY + 1)).toEqual([]); // and by then the PRs it came from are past the window too

  learnFrom(c.name, "web", `${c.prefix}-3`, ["Add a changelog entry for user-facing changes"], now);
  learnFrom(c.name, "web", `${c.prefix}-4`, ["Please add a changelog entry for user-facing changes"], now);
  const watch = ruleOffers(now).find((o) => o.rule.startsWith("Add a changelog"));
  const before = c.autonomy;
  c.autonomy = "watch";
  try {
    // watch writes nothing anywhere: Add hands back the line for the file
    expect(await addRule(watch?.id ?? "", now)).toEqual({
      suggest: "- Add a changelog entry for user-facing changes",
      file: watch?.file ?? "",
    });
  } finally {
    c.autonomy = before;
  }
  expect(ruleOffers(now)).toEqual([]);
  expect(() => dismissRule("gone", "never", now)).toThrow("gone");
});

test("marked text, Overhand's own words and bots never count as a person's feedback", () => {
  expect(notPerson("sam", "Use bun, not npm")).toBe(false);
  expect(notPerson("sam", withMark("Use bun, not npm"))).toBe(true); // an agent or lead posting as sam
  expect(notPerson("sam", "Overhand read this diff for corners an agent might cut")).toBe(true); // before the marker
  expect(notPerson("sam", "x\n<!-- overhand-corners abc -->")).toBe(true);
  expect(notPerson("dependabot[bot]", "Bump x")).toBe(true);
  expect(withMark(withMark("a"))).toBe(`a\n\n${OVERHAND_MARK}`);
});
