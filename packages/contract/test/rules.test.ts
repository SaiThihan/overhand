import { expect, test } from "bun:test";
import {
  addRuleToText,
  candidateRules,
  clusterRules,
  coveredBy,
  fromOverhand,
  LEARNED_HEADING,
  projectInstructions,
  type RuleSeen,
  ruleFile,
  ruleSuggestions,
  similarRules,
  standingRules,
} from "../src/index";

const DAY = 864e5;
const NOW = Date.UTC(2026, 9, 20);

test("candidateRules turns review remarks into short imperative rules", () => {
  const remark = [
    "Nice work overall!",
    "Nit: could you please use `bun` instead of npm here?",
    "> Use yarn (quoting the old docs)",
    "Why is this async?",
    "- Don't commit `.env` files.",
    "```ts",
    "always use any",
    "```",
    "Remove this.",
    "You should always add a JSDoc comment to exported functions, thanks!",
    `Use ${"very ".repeat(30)}long words`,
  ].join("\n");
  expect(candidateRules(remark)).toEqual([
    "Use `bun` instead of npm here",
    "Don't commit `.env` files",
    "Add a JSDoc comment to exported functions",
  ]);
  expect(candidateRules("LGTM 🚀")).toEqual([]);
});

test("similarRules matches rewordings, not opposites or different asks", () => {
  expect(similarRules("Use bun instead of npm", "Please use bun, not npm")).toBe(true);
  expect(similarRules("Add a JSDoc comment to exported functions", "Add JSDoc on every exported function")).toBe(true);
  expect(similarRules("Use npm", "Don't use npm")).toBe(false);
  expect(similarRules("Add tests for the parser", "Run the linter before pushing")).toBe(false);
});

test("clusterRules groups near-duplicates per project and counts PRs, within 30 days", () => {
  const seen: RuleSeen[] = [
    { project: "Acme", repo: "web", key: "AC-1", rule: "Use bun instead of npm here", at: NOW - 3 * DAY },
    { project: "Acme", repo: "web", key: "AC-1", rule: "Use bun, not npm", at: NOW - 3 * DAY },
    { project: "Acme", repo: "api", key: "AC-4", rule: "Use bun not npm", at: NOW - DAY },
    { project: "Other", repo: "site", key: "OT-2", rule: "Use bun not npm", at: NOW - DAY },
    { project: "Acme", repo: "web", key: "AC-9", rule: "Add JSDoc to exported functions", at: NOW - 40 * DAY },
    { project: "Acme", repo: "web", key: "AC-7", rule: "Add JSDoc to exported functions", at: NOW - DAY },
  ];
  const c = clusterRules(seen, NOW);
  expect(c.map((x) => [x.project, x.rule, x.keys, x.repo])).toEqual([
    ["Acme", "Use bun not npm", ["AC-1", "AC-4"], "api"],
    ["Other", "Use bun not npm", ["OT-2"], "site"],
    ["Acme", "Add JSDoc to exported functions", ["AC-7"], "web"],
  ]);
});

test("coveredBy finds the instruction that already says it", () => {
  const rules = ["Package manager: `bun` (not npm or yarn)", "Never force push"];
  expect(coveredBy("Use bun instead of npm", rules)).toBe(rules[0] ?? "");
  expect(coveredBy("Add JSDoc to exported functions", rules)).toBeNull();
  expect(coveredBy("Force push after a rebase", rules)).toBeNull(); // the opposite isn't coverage
});

test("ruleFile picks the file the project's agents read, AGENTS.md when several do", () => {
  const f = (path: string, readers: string[]) => ({ path, readers });
  // Claude Code reads CLAUDE.md and skips AGENTS.md when both exist
  expect(ruleFile([f("CLAUDE.md", ["claude-code", "cursor"]), f("AGENTS.md", ["codex", "cursor", "opencode"])], ["claude-code"])).toBe(
    "CLAUDE.md",
  );
  expect(ruleFile([f("CLAUDE.md", ["claude-code", "cursor"]), f("AGENTS.md", ["codex", "cursor", "opencode"])], ["codex"])).toBe(
    "AGENTS.md",
  );
  expect(ruleFile([f("CLAUDE.md", ["claude-code"]), f("AGENTS.md", ["codex"])], ["claude-code", "codex"])).toBe("AGENTS.md");
  expect(ruleFile([f(".cursor/rules/x.mdc", ["cursor"])], ["claude-code"])).toBe("CLAUDE.md");
  expect(ruleFile([], ["gemini"])).toBe("GEMINI.md");
  expect(ruleFile([], ["claude-code", "codex"])).toBe("AGENTS.md");
});

test("addRuleToText appends under the learned heading, making it once", () => {
  const once = addRuleToText("# Repo\n\n- Use bun\n", "Add JSDoc to exported functions");
  expect(once).toBe(`# Repo\n\n- Use bun\n\n${LEARNED_HEADING}\n\n- Add JSDoc to exported functions\n`);
  const twice = addRuleToText(`${once}\n## Later\n\n- x\n`, "Never force push");
  expect(twice).toContain(`${LEARNED_HEADING}\n\n- Add JSDoc to exported functions\n- Never force push\n\n## Later`);
  expect(addRuleToText("", "Use bun")).toBe(`# Agent instructions\n\n${LEARNED_HEADING}\n\n- Use bun\n`);
});

test("ruleSuggestions offers guidance from two PRs that no file says and you haven't dismissed", () => {
  const p = projectInstructions(
    "Acme",
    ["claude-code"],
    [
      {
        name: "web",
        lastCommit: NOW,
        aiderConf: "",
        files: [{ path: "CLAUDE.md", text: "- Package manager: bun, never npm\n", url: "", changedAt: NOW, tracked: true }],
      },
    ],
    NOW,
  );
  const seen: RuleSeen[] = [
    { project: "Acme", repo: "web", key: "AC-1", rule: "Use bun instead of npm", at: NOW - DAY },
    { project: "Acme", repo: "web", key: "AC-2", rule: "Use bun, not npm", at: NOW - DAY },
    { project: "Acme", repo: "web", key: "AC-1", rule: "Add JSDoc to exported functions", at: NOW - DAY },
    { project: "Acme", repo: "web", key: "AC-3", rule: "Add JSDoc on exported functions", at: NOW },
    { project: "Acme", repo: "web", key: "AC-3", rule: "Log errors with context", at: NOW },
  ];
  const offers = ruleSuggestions(seen, [p], [], NOW);
  expect(offers.map((o) => [o.rule, o.times, o.file])).toEqual([["Add JSDoc to exported functions", 2, "CLAUDE.md"]]);
  const id = offers[0]?.id ?? "";
  expect(id).toStartWith("Acme:");
  expect(ruleSuggestions(seen, [p], [{ project: "Acme", rule: "Add JSDoc to exported functions", until: NOW + DAY }], NOW)).toEqual([]);
  expect(ruleSuggestions(seen, [p], [{ project: "Acme", rule: "Add JSDoc to exported functions", until: NOW - 1 }], NOW)).toHaveLength(1);
});

test("a lead answer that sets a standing rule is offered at once; a one-off answer isn't a rule", () => {
  expect(standingRules("From now on, use bun instead of npm in this repo.")).toEqual(["Use bun instead of npm in this repo"]);
  expect(standingRules("Always run the migrations before tests")).toEqual(["Always run the migrations before tests"]);
  expect(standingRules("Use bun for this one")).toEqual([]);
  const seen: RuleSeen[] = [{ project: "Acme", repo: "web", key: "lead-a-1", rule: "Use bun instead of npm", at: NOW, standing: true }];
  expect(ruleSuggestions(seen, [], [], NOW).map((o) => [o.rule, o.standing])).toEqual([["Use bun instead of npm", true]]);
});

test("fromOverhand knows its own comments", () => {
  expect(fromOverhand("Looks good\n\n<!-- overhand -->")).toBe(true);
  expect(fromOverhand("<!-- overhand-corners abc -->")).toBe(true);
  expect(fromOverhand("Overhand read this diff")).toBe(true);
  expect(fromOverhand("Please rename this helper")).toBe(false);
});
