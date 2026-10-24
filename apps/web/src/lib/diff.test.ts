import { expect, test } from "bun:test";
import { collapsed, LARGE_FILE, parseDiff } from "./diff";

const DIFF = [
  "diff --git a/src/pay.ts b/src/pay.ts",
  "index 1111111..2222222 100644",
  "--- a/src/pay.ts",
  "+++ b/src/pay.ts",
  "@@ -10,4 +10,5 @@ export function pay() {",
  "   const card = read();",
  "-  return charge(card);",
  "+  const r = charge(card);",
  "+  return r.ok ? r : charge(card);",
  " }",
  "\\ No newline at end of file",
  "diff --git a/old.md b/docs/new.md",
  "similarity index 90%",
  "rename from old.md",
  "rename to docs/new.md",
  "diff --git a/bun.lock b/bun.lock",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/bun.lock",
  "@@ -0,0 +1,2 @@",
  "+--- not a header",
  "+x",
  "diff --git a/logo.png b/logo.png",
  "deleted file mode 100644",
  "Binary files a/logo.png and /dev/null differ",
].join("\n");

test("a unified diff splits into files with numbered, counted lines", () => {
  const [pay, moved, lock, logo] = parseDiff(DIFF);
  expect(pay).toMatchObject({ path: "src/pay.ts", status: "modified", additions: 2, deletions: 1, binary: false });
  expect(pay?.lines.map((l) => [l.kind, l.old, l.new])).toEqual([
    ["hunk", undefined, undefined],
    ["ctx", 10, 10],
    ["del", 11, undefined],
    ["add", undefined, 11],
    ["add", undefined, 12],
    ["ctx", 12, 13],
    ["note", undefined, undefined],
  ]);
  expect(moved).toMatchObject({ path: "docs/new.md", from: "old.md", status: "renamed", lines: [] });
  // a line that looks like a header inside a hunk is content
  expect(lock).toMatchObject({ path: "bun.lock", status: "added", additions: 2 });
  expect(lock?.lines[1]?.text).toBe("--- not a header");
  expect(logo).toMatchObject({ status: "deleted", binary: true });
});

test("big files, lockfiles, deletions and binaries start collapsed", () => {
  const [pay, , lock, logo] = parseDiff(DIFF);
  expect(pay && collapsed(pay)).toBe(false);
  expect(lock && collapsed(lock)).toBe(true);
  expect(logo && collapsed(logo)).toBe(true);
  const big = ["diff --git a/a.ts b/a.ts", "@@ -1,0 +1,400 @@", ...Array.from({ length: LARGE_FILE + 1 }, (_, i) => `+${i}`)];
  const [a] = parseDiff(big.join("\n"));
  expect(a && collapsed(a)).toBe(true);
});

test("an empty or junk diff has no files", () => {
  expect(parseDiff("")).toEqual([]);
  expect(parseDiff("not a diff\n+ nope")).toEqual([]);
});
