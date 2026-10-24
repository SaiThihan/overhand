import { expect, test } from "bun:test";
import { clip, plainLine, plainSentences } from "../src/plain";

/** A lead question as agents write them: a table with bold status codes, hashes and a long URL, then the question. */
const TABLE = [
  "## Release check for the Acme storefront",
  "| PR | Status | Checks | Note |",
  "|----|--------|--------|------|",
  "| #123 | **CHANGES_REQUESTED** | `a1b2c3d4e5f6a7b8` passing | Split the migration from the UI change |",
  "| #124 | APPROVED | `0f9e8d7c6b5a4f3e` failing | Flaky test on https://example.com/checkout?step=payment |",
  "```",
  "git log --oneline | head",
  "```",
  "Should I split #123 into two pull requests now, or wait for the reviewer to reply?",
].join("\n");

/** No Markdown, table or code marks. */
const MARKS = /[|`*#>]|\*\*|^\s*-/;

test("plainSentences leaves tables and code out and strips the marks", () => {
  const said = plainSentences(TABLE);
  expect(said).toEqual([
    "Release check for the Acme storefront",
    "Should I split #123 into two pull requests now, or wait for the reviewer to reply?",
  ]);
});

test("plainLine never emits Markdown, pipes or backticks, and never cuts mid-word", () => {
  const inputs = [
    TABLE,
    "**Blocked**: the `deploy` step returned CHANGES_REQUESTED on [the PR](https://example.com/pr/123). Retry?",
    "| only | a | table |\n|---|---|---|\n| a | b | c |",
    `${"A very long sentence about the Acme checkout that keeps going ".repeat(6)}until it ends.`,
    "- a list item with `code` and __bold__ words",
  ];
  for (const md of inputs)
    for (const n of [40, 80, 120]) {
      const line = plainLine(md, n);
      expect(line.length).toBeLessThanOrEqual(n);
      expect(line.replace(/#\d+/g, "")).not.toMatch(MARKS);
      // every word it keeps is whole: it is a prefix of the plain text, ending at a word's end
      const words = line.replace(/…$/, "").split(" ");
      const last = words.at(-1) ?? "";
      if (line.endsWith("…")) expect(plainSentences(md)[0]?.split(/\s+/)).toContain(last);
    }
  expect(plainLine("**Blocked**: CHANGES_REQUESTED on `abcdef1234567`.")).toBe("Blocked: changes requested on.");
  expect(plainLine("| a | b |\n|---|---|")).toBe("");
});

test("clip cuts at a word boundary", () => {
  expect(clip("Should we split the migration now", 20)).toBe("Should we split the…");
  expect(clip("short", 20)).toBe("short");
});
