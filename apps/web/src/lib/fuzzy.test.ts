import { expect, test } from "bun:test";
import { distance, fuzzyScore } from "./fuzzy";

const LINES = [
  "theme Theme…",
  "share Show off",
  "sweep Tidy up…",
  "shutdown Turn off Overhand",
  "health Open Health (H)",
  "brief Brief me",
];
const rank = (q: string) =>
  LINES.map((v) => [v, fuzzyScore(v, q)] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([v]) => v.split(" ")[0]);

test("edits count insertions, deletions, substitutions and swapped neighbours", () => {
  expect(distance("theme", "theme")).toBe(0);
  expect(distance("thehe", "theme")).toBe(1);
  expect(distance("thmee", "theme")).toBe(1);
  expect(distance("them", "theme")).toBe(1);
  expect(distance("abc", "xyz", 1)).toBe(2);
});

test("typos still find the command: thehe, thmee and theem all find Theme", () => {
  for (const q of ["thehe", "thmee", "theem", "tehme"]) expect(rank(q)[0], q).toBe("theme");
  expect(rank("shrae")[0]).toBe("share");
  expect(rank("helth")[0]).toBe("health");
});

test("exact keywords rank first, then prefixes, then typos; nonsense finds nothing", () => {
  expect(fuzzyScore("theme Theme…", "theme")).toBe(1);
  expect(rank("sh")).toEqual(["share", "shutdown"]);
  expect(fuzzyScore("share Show off", "share")).toBeGreaterThan(fuzzyScore("shutdown Turn off Overhand", "share"));
  expect(fuzzyScore("theme Theme…", "th")).toBeGreaterThan(fuzzyScore("theme Theme…", "thehe"));
  expect(rank("zzzz")).toEqual([]);
  // a typo's letters strung across a whole line don't count: "thehe" finds Theme alone
  expect(rank("thehe")).toEqual(["theme"]);
  expect(rank("hlth")).toEqual(["health"]);
  expect(fuzzyScore("brief Brief me", "")).toBe(1);
});

test("the command bar's guessed project outscores the others, so it's the first way to start an agent", () => {
  const typed = "make the invite page friendlier on Potluck";
  // Palette.tsx: the guessed project's value is what was typed; the others put their place first
  expect(fuzzyScore(typed, typed)).toBeGreaterThan(fuzzyScore(`1 ${typed}`, typed));
});
