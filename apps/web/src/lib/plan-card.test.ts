import { expect, test } from "bun:test";
import { factsBrief, planPoints } from "@overhand/contract";
import { NOW, state } from "@overhand/contract/fixtures/state";
import { plainWords } from "@overhand/themes";
import { computeAlerts } from "./alerts";
import { parsePlan } from "./plan";

test("a plan reads into what changes and what you'll see, in the shape agents are asked for", () => {
  const text = [
    "What changes:",
    '- The invite headline reads "Sam would love you at dinner".',
    '* A bigger "I\'m in" button on phones.',
    "1. Faces of who's coming under the date.",
    "",
    "What you'll see:",
    "- A preview link to try it.",
  ].join("\n");
  expect(planPoints(text)).toEqual({
    changes: [
      'The invite headline reads "Sam would love you at dinner".',
      'A bigger "I\'m in" button on phones.',
      "Faces of who's coming under the date.",
    ],
    see: ["A preview link to try it."],
  });
  // headings with the point on the same line, bold, or "What I'd change"
  expect(planPoints("**What I'd change:** the header copy.\nWhat you will see: a preview link.")).toEqual({
    changes: ["the header copy."],
    see: ["a preview link."],
  });
  // free text: its first sentences are what changes
  expect(planPoints("I'd warm up the copy. Then make the button bigger! Nothing else.")).toEqual({
    changes: ["I'd warm up the copy.", "Then make the button bigger!", "Nothing else."],
    see: [],
  });
});

const plan = {
  id: "p1",
  project: "Honeycrust",
  key: "",
  title: "make the checkout friendlier",
  text: "What changes:\n- Warmer copy.\nWhat you'll see:\n- A preview link.",
  post: "",
  from: "agent" as const,
  at: NOW,
  task: "HONEY-900000001",
};

test("a plan waiting for Go ahead ranks with questions that block an agent, ahead of them", () => {
  const s = state({
    findings: [plan],
    tickets: {
      Honeycrust: [{ key: "HONEY-2", title: "Pick a colour", status: "Todo", priority: "", labels: ["needs-owner"], url: "" }],
    },
  });
  const a = computeAlerts(s, parsePlan([]), plainWords, NOW);
  expect(a.slice(0, 2).map((x) => [x.sev, x.title])).toEqual([
    [3, "Plan ready: make the checkout friendlier"],
    [3, "HONEY-2 needs your answer"],
  ]);
});

test("the plan's card carries the plan itself, and an old plan with only text still shows it", () => {
  const b = factsBrief(
    state({ findings: [{ ...plan, plan: { changes: ["Warmer copy."], see: ["A preview link."] } }] }),
    "held:p1",
    {},
    NOW,
  );
  expect(b?.plan).toEqual({ changes: ["Warmer copy."], see: ["A preview link."] });
  expect(b?.options.map((o) => o.id)).toEqual(["go", "replan", "drop"]);
  expect(factsBrief(state({ findings: [plan] }), "held:p1", {}, NOW)?.plan).toEqual({
    changes: ["Warmer copy."],
    see: ["A preview link."],
  });
});
