import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { proofMarkdown } from "@overhand/contract";
import { areaOf, assembleProof, checkKind, checksOf, commandsRun, diffFacts, parseNumstat, summaryOf } from "../src/proof";
import { loadPlaywright, NO_BROWSER } from "../src/shots";

const fixture = (f: string) => readFileSync(join(import.meta.dir, "fixtures", "proof", f), "utf8");
const NUMSTAT = [
  "12\t3\tapps/web/src/components/Cart.tsx",
  "40\t0\tpackages/core/src/cart.ts",
  "300\t250\tbun.lock",
  "5\t0\tREADME.md",
].join("\n");

test("a Claude Code transcript gives each check command as its last run ended", () => {
  const checks = checksOf(commandsRun(fixture("claude-stream.jsonl")));
  expect(checks.map((c) => [c.kind, c.command, c.ok])).toEqual([
    ["test", "bun test", true], // failed first, then passed after the fix: the rerun counts
    ["typecheck", "bunx tsc --noEmit", true],
    ["lint", "bunx biome check .", true],
    ["build", "bun run build", true],
  ]);
  expect(checks[0]).toMatchObject({ summary: "43 pass, 0 fail, 1 skip", skipped: 1 });
});

test("a Codex transcript: commands unwrapped from their login shell, exit codes kept", () => {
  const checks = checksOf(commandsRun(fixture("codex.jsonl")));
  expect(checks).toEqual([
    { kind: "test", command: "pnpm vitest run", ok: true, summary: "Tests  3 passed | 2 skipped (5)", skipped: 2 },
    { kind: "lint", command: "pnpm lint", ok: false, summary: "✖ 3 problems (3 errors, 0 warnings)", skipped: 0 },
  ]);
});

test("only commands that start with a known runner are checks", () => {
  expect(checkKind("grep -rn test src")).toBeNull();
  expect(checkKind("cat jest.config.js")).toBeNull();
  expect(checkKind("CI=1 npm test -- --watch=false")).toBe("test");
  expect(checkKind("nice -n 10 bunx tsc --noEmit")).toBe("typecheck");
  expect(checkKind("pnpm run lint:fix")).toBe("lint");
  expect(checkKind("python -m pytest -q")).toBe("test");
  expect(checkKind("cargo test")).toBe("test");
  expect(checkKind("npm run build")).toBe("build");
  expect(checkKind("bun install")).toBeNull();
});

test("summaries: jest, pytest, tsc", () => {
  expect(summaryOf("PASS a\nTests:       1 failed, 4 passed, 5 total\n").summary).toBe("Tests:       1 failed, 4 passed, 5 total");
  expect(summaryOf("..\n===== 3 passed, 1 skipped in 0.12s =====").summary).toBe("3 passed, 1 skipped in 0.12s");
  expect(summaryOf("a.ts(1,1): error TS2322: x\nb.ts(2,2): error TS2345: y").summary).toBe("2 type errors");
  expect(summaryOf("Found 2 errors in 1 file.").summary).toBe("Found 2 errors in 1 file.");
});

test("the diff: lock files left out of line counts, areas biggest first, UI and docs detected", () => {
  expect(parseNumstat("1\t2\tsrc/{old => new}/a.ts\n-\t-\tlogo.png")).toEqual([
    { path: "src/new/a.ts", added: 1, removed: 2 },
    { path: "logo.png", added: 0, removed: 0 },
  ]);
  expect(areaOf("packages/core/src/x.ts")).toBe("packages/core");
  expect(areaOf("src/x.ts")).toBe("src");
  expect(areaOf("README.md")).toBe("(root)");
  const d = diffFacts(parseNumstat(NUMSTAT));
  expect(d).toMatchObject({ files: 4, added: 57, removed: 3, ui: true, docsOnly: false });
  expect(d.areas[0]).toBe("(root)"); // bun.lock's churn still says where the change is
  expect(diffFacts(parseNumstat("3\t1\tsrc/Cart.test.tsx")).ui).toBe(false);
  expect(diffFacts(parseNumstat("3\t1\tdocs/setup.md\n1\t0\tREADME.md")).docsOnly).toBe(true);
});

test("gaps are said plainly: no tests, failed checks, skipped tests, UI with no screenshots", () => {
  const none = assembleProof({ transcript: "", numstat: NUMSTAT, verified: "", now: 1 });
  expect(none.transcript).toBe(false);
  expect(none.gaps).toEqual(["no run log Overhand can read: which checks ran is unknown", "UI changed, no screenshots"]);
  const codex = assembleProof({
    transcript: fixture("codex.jsonl"),
    numstat: NUMSTAT,
    verified: "",
    shots: { before: false, after: false, note: "no preview configured for this project" },
  });
  expect(codex.gaps).toEqual([
    "tests skipped: 2 (pnpm vitest run)",
    "lint failed: pnpm lint",
    "UI changed, no screenshots: no preview configured for this project",
  ]);
  const noTests = assembleProof({
    transcript: '{"type":"assistant","message":{"content":[]}}',
    numstat: "1\t1\tsrc/a.ts",
    verified: "",
  });
  expect(noTests.gaps).toEqual(["no tests ran"]);
  // a docs-only change isn't held to tests
  expect(
    assembleProof({ transcript: '{"type":"assistant","message":{"content":[]}}', numstat: "1\t1\tREADME.md", verified: "" }).gaps,
  ).toEqual([]);
});

test("no browser: the shots skip with a plain gap, never an error", async () => {
  expect(await loadPlaywright("overhand-no-such-module")).toBeNull();
  const p = assembleProof({
    transcript: "",
    numstat: "1\t1\tsrc/App.tsx",
    verified: "",
    shots: { before: false, after: false, note: NO_BROWSER },
  });
  expect(p.gaps).toContain("UI changed, no screenshots: browser not available");
});

test("the PR body section: checks, changes, the agent's words, screenshots, gaps; no agent named without attribution", () => {
  const p = assembleProof({
    transcript: fixture("claude-stream.jsonl"),
    numstat: NUMSTAT,
    verified: "Ran the cart tests and opened the cart page.",
    shots: { before: true, after: true, note: "" },
    now: 1,
  });
  const md = proofMarkdown(p, true);
  expect(md).toContain("### Proof");
  expect(md).toContain("- ✅ `bun test` — 43 pass, 0 fail, 1 skip");
  expect(md).toContain("**Changed:** 4 files, +57 −3 in `(root)`, `packages/core`, `apps/web`");
  expect(md).toContain("**The agent says it verified:** Ran the cart tests and opened the cart page.");
  expect(md).toContain("**Screenshots:** before and after taken (in Overhand's review)");
  expect(md).toContain("- tests skipped: 1 (bun test)");
  const plain = proofMarkdown(p, false);
  expect(plain).not.toMatch(/agent|Overhand/i);
  expect(plain).toContain("**Checks run**");
});
