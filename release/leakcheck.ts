/**
 * Refuses a commit or a CI run when a tracked file contains a word from the private deny-list (client and personal
 * names). This is the only repository, so anything committed is public: the list itself is never committed, it lives
 * in a gitignored file locally and in the PUBLIC_DENYLIST secret in CI.
 * Usage: bun release/leakcheck.ts [deny-list file]   (default .public-denylist; else the PUBLIC_DENYLIST variable)
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { safeCmd } from "../packages/core/src/runtimes/runtime";

const ROOT = resolve(import.meta.dir, "..");
const file = process.argv[2] ?? join(ROOT, ".public-denylist");
const list = existsSync(file) ? readFileSync(file, "utf8") : (process.env.PUBLIC_DENYLIST ?? "");
const deny = list
  .split("\n")
  .map((l) => l.trim().toLowerCase())
  .filter((l) => l && !l.startsWith("#"));
if (!deny.length) {
  // forks and fresh clones have no list; the maintainers' hook and CI do
  console.log("leakcheck: no deny-list, skipped");
  process.exit(0);
}

// staged content when run from the pre-commit hook, so what is checked is what gets committed
const staged = process.env.LEAKCHECK_STAGED === "1";
const files = Bun.spawnSync(safeCmd(["git", "ls-files", ...(staged ? ["--cached"] : [])]), { cwd: ROOT })
  .stdout.toString()
  .split("\n")
  .filter(Boolean);
const read = (f: string): Buffer =>
  staged ? Buffer.from(Bun.spawnSync(safeCmd(["git", "show", `:${f}`]), { cwd: ROOT }).stdout) : readFileSync(join(ROOT, f));

// The licence has to name its licensor, the copyright holder; only these files may carry that name.
const LEGAL = new Set(["LICENSE.md", "CLA.md"]);
const LICENSOR = new Set(
  (readFileSync(join(ROOT, "LICENSE.md"), "utf8").match(/^Copyright \d{4} (.+)$/m)?.[1] ?? "").toLowerCase().split(/\s+/),
);
const patterns = deny.map((w) => ({ w, re: new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) }));
const leaks: string[] = [];
for (const f of files) {
  if (!existsSync(join(ROOT, f)) && !staged) continue; // deleted in the working tree
  const text = read(f).toString("utf8");
  if (text.includes("\u0000")) continue; // binary
  const lower = text.toLowerCase();
  for (const { w, re } of patterns) if (!(LEGAL.has(f) && LICENSOR.has(w)) && re.test(lower)) leaks.push(`${f}: ${w}`);
}
if (leaks.length) {
  console.error(`leakcheck: private words found, this repository is public\n${leaks.join("\n")}`);
  process.exit(1);
}
console.log(`leakcheck: ${files.length} files, no private words`);
