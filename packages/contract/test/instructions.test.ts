import { expect, test } from "bun:test";
import {
  conflicts,
  isInstructionPath,
  opposite,
  packageManagers,
  parseInstructions,
  projectInstructions,
  type RepoInput,
  readersOf,
  ruleCount,
  testCommand,
} from "../src/index";

const DAY = 864e5;
const NOW = Date.UTC(2026, 9, 20);

test("parseInstructions keeps rules verbatim, grouped by heading", () => {
  const md = [
    "---",
    "description: API rules",
    "alwaysApply: true",
    "---",
    "This repo is the checkout service.",
    "",
    "# Style",
    "",
    "- Use `bun` for everything.",
    "- Prefer named exports;",
    "  default exports only for pages.",
    "  - Nested: keep it short",
    "1. Run `bun test` before pushing",
    "",
    "## Notes",
    "Always write tests first. The CI runs on Linux.",
    "",
    "```sh",
    "- not a rule",
    "```",
    "<!-- hidden -->",
    "| Command | What |",
    "| --- | --- |",
    "| `bun dev` | serve |",
  ].join("\n");
  const s = parseInstructions(md);
  expect(s.map((x) => [x.heading, x.level])).toEqual([
    ["", 0],
    ["Style", 1],
    ["Notes", 2],
  ]);
  expect(s[0]?.items).toEqual([{ text: "This repo is the checkout service.", depth: 0, rule: false }]);
  expect(s[1]?.items).toEqual([
    { text: "Use `bun` for everything.", depth: 0, rule: true },
    { text: "Prefer named exports; default exports only for pages.", depth: 0, rule: true },
    { text: "Nested: keep it short", depth: 1, rule: true },
    { text: "Run `bun test` before pushing", depth: 0, rule: true },
  ]);
  // file order kept: notes stay where they were
  expect(s[2]?.items.map((x) => [x.text, x.rule])).toEqual([
    ["Always write tests first.", true],
    ["The CI runs on Linux.", false],
    ["| Command | What |", false],
    ["| `bun dev` | serve |", false],
  ]);
  expect(ruleCount(s)).toBe(5);
});

test("parseInstructions reads a plain-text rules file", () => {
  const s = parseInstructions("You are a senior engineer.\nNever commit secrets.\n");
  expect(s[0]?.items).toEqual([
    { text: "You are a senior engineer.", depth: 0, rule: false },
    { text: "Never commit secrets.", depth: 0, rule: true },
  ]);
});

test("isInstructionPath keeps instruction files only", () => {
  expect(isInstructionPath("CLAUDE.md")).toBe(true);
  expect(isInstructionPath("packages/api/CLAUDE.md")).toBe(true);
  expect(isInstructionPath(".cursor/rules/api.mdc")).toBe(true);
  expect(isInstructionPath(".claude/rules/testing.md")).toBe(true);
  expect(isInstructionPath("MY_CLAUDE.md")).toBe(false);
  expect(isInstructionPath("node_modules/x/AGENTS.md")).toBe(false);
  expect(isInstructionPath(".cursor/rules/notes.txt")).toBe(false);
});

test("readersOf follows each CLI's documented files", () => {
  const r = (p: string, all: string[], aider = "") => readersOf(p, all, aider).readers;
  // Claude Code reads AGENTS.md only without a CLAUDE.md; OpenCode reads CLAUDE.md only without an AGENTS.md
  expect(r("AGENTS.md", ["AGENTS.md"])).toEqual(["claude-code", "codex", "cursor", "opencode"]);
  expect(r("AGENTS.md", ["AGENTS.md", "CLAUDE.md"])).toEqual(["codex", "cursor", "opencode"]);
  expect(r("CLAUDE.md", ["CLAUDE.md"])).toEqual(["claude-code", "cursor", "opencode"]);
  expect(r("CLAUDE.md", ["CLAUDE.md", "AGENTS.md"])).toEqual(["claude-code", "cursor"]);
  expect(r("AGENTS.md", ["AGENTS.md", "AGENTS.override.md", ".claude/CLAUDE.md"])).toEqual(["cursor", "opencode"]);
  expect(r("GEMINI.md", ["GEMINI.md"])).toEqual(["gemini"]);
  expect(r("web/CLAUDE.md", ["web/CLAUDE.md"])).toEqual(["claude-code"]);
  expect(r(".cursor/rules/a.mdc", [])).toEqual(["cursor"]);
  expect(r("CONVENTIONS.md", ["CONVENTIONS.md"])).toEqual([]);
  expect(r("CONVENTIONS.md", ["CONVENTIONS.md"], "read: CONVENTIONS.md\n")).toEqual(["aider"]);
  expect(readersOf(".github/copilot-instructions.md", [])).toEqual({ readers: [], also: "GitHub Copilot" });
});

test("packageManagers splits use from avoid by clause", () => {
  const pm = (s: string) => {
    const x = packageManagers(s);
    return { use: [...x.use], avoid: [...x.avoid] };
  };
  expect(pm("Use bun, not npm")).toEqual({ use: ["bun"], avoid: ["npm"] });
  expect(pm("Never use npm or yarn; use bun")).toEqual({ use: ["bun"], avoid: ["npm", "yarn"] });
  expect(pm("Install with `pnpm install`")).toEqual({ use: ["pnpm"], avoid: [] });
  expect(pm("Run `bunx biome check`")).toEqual({ use: ["bun"], avoid: [] });
});

test("testCommand finds the command in a rule about tests", () => {
  expect(testCommand("Run `npm run test` before you push")).toBe("npm test");
  expect(testCommand("Tests: `bun test`")).toBe("bun test");
  expect(testCommand("Run `bun dev` to serve")).toBe("");
  expect(testCommand("Don't run `jest` for tests")).toBe("");
});

test("opposite matches a prohibition against an instruction to do the same", () => {
  expect(opposite("Never force push", "Force push your branch after a rebase")).toBe("force push");
  expect(opposite("Don't use default exports", "Use default exports for pages")).toBe("use default exports");
  // a generic verb needs three words: "use any" is too thin to call
  expect(opposite("Don't use any", "Use any free port")).toBe("");
  expect(opposite("Never force push", "Never force push")).toBe("");
  expect(opposite("Never commit to main", "Commit small and often")).toBe("");
});

test("conflicts: package managers, test commands, never-vs-do; nested files left out", () => {
  const pm = conflicts("web", [
    { path: "CLAUDE.md", rules: ["Use bun for everything", "Never use npm"] },
    { path: "AGENTS.md", rules: ["Install with `npm install`"] },
  ]);
  expect(pm).toEqual([
    {
      kind: "conflict",
      repo: "web",
      topic: "package-manager",
      action: "",
      a: { path: "AGENTS.md", rule: "Install with `npm install`" },
      b: { path: "CLAUDE.md", rule: "Never use npm" },
    },
  ]);
  const both = conflicts("web", [
    { path: "CLAUDE.md", rules: ["Install with `pnpm install`"] },
    { path: "AGENTS.md", rules: ["Install with `yarn`"] },
  ]);
  expect(both[0]?.topic).toBe("package-manager");
  const tests = conflicts("web", [
    { path: "CLAUDE.md", rules: ["Run tests with `vitest run`"] },
    { path: "AGENTS.md", rules: ["Tests: `jest --ci`"] },
  ]);
  expect(tests[0]?.topic).toBe("test-command");
  const never = conflicts("web", [
    { path: "CLAUDE.md", rules: ["Never force push"] },
    { path: ".cursor/rules/git.mdc", rules: ["Force push after rebasing"] },
  ]);
  expect(never[0]).toMatchObject({ topic: "never", action: "force push" });
  expect(
    conflicts("web", [
      { path: "CLAUDE.md", rules: ["Use bun"] },
      { path: "legacy/CLAUDE.md", rules: ["Use yarn here"] },
    ]),
  ).toEqual([]);
  expect(
    conflicts("web", [
      { path: "CLAUDE.md", rules: ["Use bun", "Run `bun test`"] },
      { path: "AGENTS.md", rules: ["Use bun", "Run tests with `bun test`"] },
    ]),
  ).toEqual([]);
});

const repo = (files: { path: string; text: string; changedAt?: number; tracked?: boolean }[], lastCommit = NOW - DAY): RepoInput => ({
  name: "web",
  lastCommit,
  aiderConf: "",
  files: files.map((f) => ({ url: "", changedAt: NOW - DAY, tracked: true, ...f })),
});

test("projectInstructions: missing, unread with a suggestion, stale, untracked", () => {
  expect(projectInstructions("Honeycrust", ["codex"], [repo([])], NOW).checks).toEqual([
    { kind: "missing", repo: "web", runtime: "codex" },
  ]);
  const unread = projectInstructions("Honeycrust", ["codex"], [repo([{ path: "CLAUDE.md", text: "- Use bun" }])], NOW);
  expect(unread.checks).toEqual([
    { kind: "unread", repo: "web", runtime: "codex", files: ["CLAUDE.md"], suggest: { from: "CLAUDE.md", to: "AGENTS.md" } },
  ]);
  expect(projectInstructions("Honeycrust", ["claude-code"], [repo([{ path: "CLAUDE.md", text: "- Use bun" }])], NOW).checks).toEqual([]);
  const stale = projectInstructions(
    "Honeycrust",
    ["claude-code"],
    [repo([{ path: "CLAUDE.md", text: "- x", changedAt: NOW - 200 * DAY }])],
    NOW,
  );
  expect(stale.checks).toEqual([{ kind: "stale", repo: "web", path: "CLAUDE.md", months: 6 }]);
  // a quiet repo isn't held against its file
  const quiet = projectInstructions(
    "Honeycrust",
    ["claude-code"],
    [repo([{ path: "CLAUDE.md", text: "- x", changedAt: NOW - 200 * DAY }], NOW - 90 * DAY)],
    NOW,
  );
  expect(quiet.checks).toEqual([]);
  const loose = projectInstructions("Honeycrust", ["claude-code"], [repo([{ path: "CLAUDE.md", text: "- x", tracked: false }])], NOW);
  expect(loose.checks).toEqual([{ kind: "untracked", repo: "web", path: "CLAUDE.md" }]);
});
