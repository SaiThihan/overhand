import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { SkeletonRows } from "./ui/skeleton";

/**
 * A pane that loads shows skeleton blocks in the shape of its content (components/ui/skeleton.tsx), never a spinner;
 * the one loader (Boot) is for the whole app starting or connecting. This reads every component: one that waits on a
 * query (isPending, aria-busy, a "…Loading" word) must draw a Skeleton, and none may spin, pulse a "loading" dot or
 * sweep a scan line.
 */
const DIR = import.meta.dir;
const files = [
  ...[...new Bun.Glob("**/*.tsx").scanSync({ cwd: DIR })].filter((f) => !f.includes(".test.") && !f.startsWith("ui/")).sort(),
  "../App.tsx",
];
const src = (f: string) => readFileSync(join(DIR, f), "utf8");

/** What a pane waiting on its data looks like in code. */
const WAITS =
  /\buseQuery\(|\.isPending\b|isLoading\b|aria-busy=|\bw\.(?:loading|reviewLoading|reportsLoading|orgLoading|setupPickLoading|setupLooking)\b/;
/** What a spinner looks like in code. */
const SPINS = /animate-spin|animate-pulse|Loader2|LoaderCircle|Spinner|m-scan|m-pulse[^\n]*Looking/;

test("every pane that loads draws a skeleton", () => {
  // the header's status line says "Connecting to Overhand…" in words: a status, not a pane
  const loading = files.filter((f) => f !== "Header.tsx" && WAITS.test(src(f)));
  expect(loading.length).toBeGreaterThan(8);
  expect(loading.filter((f) => !/<Skeleton\b|<SkeletonRows\b|<Boot\b|<Loader\b/.test(src(f)))).toEqual([]);
});

test("no spinner in a loading pane", () => {
  const found = files.flatMap((f) =>
    src(f)
      .split("\n")
      .flatMap((line, i) => (SPINS.test(line) ? [`${f}:${i + 1}  ${line.trim()}`] : [])),
  );
  expect(found).toEqual([]);
});

test("a pane's loading words still reach a screen reader; the blocks hold still", () => {
  const html = renderToStaticMarkup(<SkeletonRows label="Building the report…" rows={2} />);
  expect(html).toContain('role="status"');
  expect(html).toContain('<span class="sr-only">Building the report…</span>');
  expect(html.match(/data-slot="skeleton"/g)).toHaveLength(2);
  expect(html).toContain("bg-(--ink-6) dark:bg-(--ink-5)");
  expect(html).not.toMatch(/animate|m-pulse/);
});
