/** A unified diff (`gh pr diff`, `git diff`) split into files and lines the Review drawer can show. Pure. */

export interface DiffLine {
  kind: "add" | "del" | "ctx" | "hunk" | "note";
  text: string;
  /** Line number in the old file (deletions and context). */
  old?: number;
  /** Line number in the new file (additions and context). */
  new?: number;
}

export interface DiffFile {
  path: string;
  /** The path before a rename; equal to `path` otherwise. */
  from: string;
  status: "added" | "deleted" | "renamed" | "modified";
  binary: boolean;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

/** Lockfiles and generated output: shown collapsed whatever their size. */
const NOISE =
  /(^|\/)(bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|go\.sum)$|\.min\.(js|css)$|(^|\/)dist\//;

/** Files with more changed lines than this start collapsed. */
export const LARGE_FILE = 300;

/** True when a file should start collapsed: big, deleted, binary or a lockfile. */
export const collapsed = (f: DiffFile): boolean =>
  f.binary || f.status === "deleted" || NOISE.test(f.path) || f.additions + f.deletions > LARGE_FILE;

const unquote = (p: string): string => p.replace(/^"(.*)"$/, "$1").replace(/^[ab]\//, "");

/** Splits a unified diff into files with numbered lines. Text before the first `diff --git` is ignored. */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let f: DiffFile | null = null;
  let oldN = 0;
  let newN = 0;
  let inHunk = false;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const m = raw.match(/^diff --git (\S+|"[^"]+") (\S+|"[^"]+")$/);
      const from = unquote(m?.[1] ?? "");
      const to = unquote(m?.[2] ?? from);
      f = { path: to, from, status: from === to ? "modified" : "renamed", binary: false, additions: 0, deletions: 0, lines: [] };
      files.push(f);
      inHunk = false;
      continue;
    }
    if (!f) continue;
    if (!inHunk) {
      if (raw.startsWith("new file mode")) f.status = "added";
      else if (raw.startsWith("deleted file mode")) f.status = "deleted";
      else if (raw.startsWith("rename from ")) {
        f.from = raw.slice("rename from ".length);
        f.status = "renamed";
      } else if (raw.startsWith("rename to ")) f.path = raw.slice("rename to ".length);
      else if (raw.startsWith("Binary files ") || raw === "GIT binary patch") f.binary = true;
    }
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldN = Number(hunk[1]);
      newN = Number(hunk[2]);
      inHunk = true;
      f.lines.push({ kind: "hunk", text: raw });
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith("+")) {
      f.lines.push({ kind: "add", text: raw.slice(1), new: newN++ });
      f.additions++;
    } else if (raw.startsWith("-")) {
      f.lines.push({ kind: "del", text: raw.slice(1), old: oldN++ });
      f.deletions++;
    } else if (raw.startsWith(" ")) f.lines.push({ kind: "ctx", text: raw.slice(1), old: oldN++, new: newN++ });
    else if (raw.startsWith("\\")) f.lines.push({ kind: "note", text: raw });
  }
  return files;
}
