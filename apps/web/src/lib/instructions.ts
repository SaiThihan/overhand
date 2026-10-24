/** The words around a project's agent instructions: its summary line and its checks, from counts only. */
import { comboLabel, type InstructionCheck, type ProjectInstructions, ruleCount } from "@overhand/contract";
import type { Words } from "@overhand/themes";
import { fmt } from "./format";

/** "Claude Code", "Claude Code and Codex", "A, B and C". */
export function names(ids: readonly string[]): string {
  const n = ids.map((id) => comboLabel(id));
  return n.length < 2 ? (n[0] ?? "") : [n.slice(0, -1).join(", "), n.at(-1)].join(" and ");
}

const count = (n: number, one: string, many: string) => (n === 1 ? one : fmt(many, { n }));

/** A project's rules across all its files. */
export const projectRules = (p: ProjectInstructions): number => p.files.reduce((n, f) => n + ruleCount(f.sections), 0);

/** Checks worth a person's look: everything but a stale file counts toward the badge. */
export const flagged = (p: ProjectInstructions): number => p.checks.filter((c) => c.kind !== "stale").length;

/** "14 rules across 2 files; Claude Code and Codex read them; 1 in conflict", in the theme's voice. */
export function summary(w: Words, p: ProjectInstructions): string {
  const readers = p.runtimes.filter((rt) => p.files.some((f) => f.readers.includes(rt)));
  const line = fmt(w.instSummary, {
    rules: count(projectRules(p), w.instRulesOne, w.instRulesMany),
    files: count(p.files.length, w.instFilesOne, w.instFilesMany),
    readers: readers.length ? fmt(readers.length === 1 ? w.instReadersOne : w.instReaders, { names: names(readers) }) : w.instReadersNone,
  });
  const conflicts = p.checks.filter((c) => c.kind === "conflict").length;
  return conflicts ? [line, fmt(w.instConflicts, { n: conflicts })].join("") : line;
}

/** One check as a sentence. */
export function checkText(w: Words, c: InstructionCheck): string {
  switch (c.kind) {
    case "missing":
      return fmt(w.instMissing, { runtime: comboLabel(c.runtime), repo: c.repo });
    case "unread":
      return fmt(w.instUnread, { runtime: comboLabel(c.runtime), repo: c.repo, files: c.files.join(", ") });
    case "conflict": {
      const topic =
        c.topic === "package-manager"
          ? w.instTopicPm
          : c.topic === "test-command"
            ? w.instTopicTest
            : fmt(w.instTopicNever, { action: c.action });
      return fmt(w.instConflict, { a: c.a.path, b: c.b.path, topic });
    }
    case "stale":
      return fmt(w.instStale, { path: c.path, repo: c.repo, n: c.months });
    case "untracked":
      return fmt(w.instUntracked, { path: c.path, repo: c.repo });
  }
}
