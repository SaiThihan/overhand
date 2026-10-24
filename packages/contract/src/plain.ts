/**
 * Agent-written Markdown as the plain words a card leads with. Agents write tables, `code`, **bold**, hashes and status
 * codes; a card shows one plain sentence and keeps the rest for its Details.
 */

/** At most `n` characters, cut at a word boundary with "…" (a single word longer than `n` is the one exception). */
export function clip(t: string, n: number): string {
  if (t.length <= n) return t;
  const head = t.slice(0, n - 1);
  const space = /\s/.test(t[n - 1] ?? "") ? head.length : head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[\s,;:(\-–—]+$/, "")}…`;
}

/** Markdown as one line of plain text: links as their words, no **, `, # or > marks, whitespace collapsed. */
export function plainText(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([0-9a-f]{7,40})`/gi, "") // a commit hash in code marks says nothing to a person
    .replace(/(\*\*|__|`)/g, "")
    .replace(/^\s*(#+|>|[-*•]|\d+[.)])\s+/gm, "")
    .replace(/\b[A-Z]+(?:_[A-Z]+)+\b/g, (c) => c.toLowerCase().replace(/_/g, " ")) // CHANGES_REQUESTED → changes requested
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/** A table row or its rule line, or a line of nothing but marks. */
const notProse = (line: string) => /^\s*\|/.test(line) || /^\s*:?-{3,}/.test(line) || !/[\p{L}\p{N}]/u.test(line);

/** The real sentences of agent-written Markdown, in order, plain: tables and code blocks left out. */
export function plainSentences(md: string): string[] {
  return md
    .replace(/```[\s\S]*?(```|$)/g, "\n")
    .split("\n")
    .filter((l) => l.trim() && !notProse(l))
    .flatMap((l) => plainText(l).split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"'(#])/u))
    .map((s) => s.trim())
    .filter((s) => /[\p{L}]/u.test(s));
}

/** The first real sentence of agent-written Markdown, plain, in at most `n` characters; "" when it holds none. */
export const plainLine = (md: string, n = 120): string => clip(plainSentences(md)[0] ?? "", n);

/**
 * What a question asks, as one plain sentence: its first that ends in "?", else its first outside headings, else its
 * heading. A lead's `Options:` and `If there's no answer:` lines are its answers, not its question.
 */
export function questionLine(md: string, n = 120): string {
  const text = md.replace(/^\s*(options?|if there's no answer):.*$/gim, "");
  const body = plainSentences(text.replace(/^\s*#.*$/gm, ""));
  return clip(body.find((s) => s.endsWith("?")) ?? body[0] ?? plainSentences(text)[0] ?? "", n);
}
