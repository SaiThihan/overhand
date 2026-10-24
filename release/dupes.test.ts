/**
 * One source for every sentence people read: a sentence of 8 or more words written word for word in two places
 * (site pages, the interface's words, the contract's and the relay's messages, the README and docs) fails here.
 * Repeat it from its one source (a slot, a words key, a constant) instead.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";

const ROOT = join(import.meta.dir, "..");
const SOURCES = [
  "site/pages/**/*.{html,md}",
  "site/site.ts",
  "packages/themes/src/words.ts",
  "packages/contract/src/*.ts",
  "relay/src/*.ts",
  "README.md",
  "AGENTS.md",
  "docs/*.md",
  "skills/**/*.md",
];
/** What a reader sees of a file: string literals in code, text outside tags, scripts and styles in pages. */
function prose(file: string, src: string): string {
  if (file.endsWith(".ts")) return [...src.matchAll(/"((?:[^"\\\n]|\\.)*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? "").join("\n");
  return src
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
}

/** Every sentence of 8+ words, lower-cased with spaces collapsed, and the files it's in (a file twice if it repeats). */
function sentences(files: readonly { file: string; src: string }[]): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  for (const { file, src } of files)
    for (const raw of prose(file, src).split(/(?<=[.!?])\s+|\n\s*\n/)) {
      const s = raw
        .replace(/&[a-z]+;/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (s.split(" ").filter((w) => /[a-z]/.test(w)).length < 8) continue;
      seen.set(s, [...(seen.get(s) ?? []), file]);
    }
  return seen;
}

test("no sentence of 8+ words is written twice", () => {
  const files = SOURCES.flatMap((g) =>
    [...new Glob(g).scanSync(ROOT)].map((file) => ({ file, src: readFileSync(join(ROOT, file), "utf8") })),
  );
  expect(files.length).toBeGreaterThan(20);
  const twice = [...sentences(files)].filter(([, where]) => where.length > 1).map(([s, where]) => `${where.join(", ")}: ${s}`);
  expect(twice).toEqual([]);
});

test("the check catches a repeat across a page and the words", () => {
  const line = "Overhand keeps the agents you already use working on every project.";
  const found = sentences([
    { file: "a.html", src: `<p>${line}</p>` },
    { file: "words.ts", src: `x: "${line}",` },
  ]);
  expect(found.get(line.toLowerCase())).toEqual(["a.html", "words.ts"]);
});
