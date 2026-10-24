import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectInstructions } from "@overhand/contract";
import { fileUrl, repoInput } from "../src/instructions";

const git = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, stderr: "ignore" });

/** A fixture repo: a committed CLAUDE.md, a nested one, Cursor rules, an uncommitted AGENTS.md, an ignored GEMINI.md. */
function fixture(): string {
  const repo = mkdtempSync(join(tmpdir(), "instructions-"));
  git(repo, "init", "-q");
  mkdirSync(join(repo, "web"));
  mkdirSync(join(repo, ".cursor", "rules"), { recursive: true });
  mkdirSync(join(repo, "node_modules", "x"), { recursive: true });
  writeFileSync(join(repo, "CLAUDE.md"), "# Tooling\n\n- Use bun, not npm\n");
  writeFileSync(join(repo, "web", "CLAUDE.md"), "- Use yarn in this folder\n");
  writeFileSync(join(repo, ".cursor", "rules", "api.mdc"), "---\nalwaysApply: true\n---\n- Never force push\n");
  writeFileSync(join(repo, "node_modules", "x", "AGENTS.md"), "- vendored\n");
  writeFileSync(join(repo, ".gitignore"), "node_modules\nGEMINI.md\n");
  writeFileSync(join(repo, "GEMINI.md"), "- ignored\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  git(repo, "remote", "add", "origin", "git@github.com:honeycrust/web.git");
  writeFileSync(join(repo, "AGENTS.md"), "- Install with `npm install`\n");
  return repo;
}

test("repoInput finds instruction files with git, read-only", async () => {
  const repo = fixture();
  const before = readFileSync(join(repo, "CLAUDE.md"), "utf8");
  const r = await repoInput(repo);
  expect(r.files.map((f) => [f.path, f.tracked]).sort()).toEqual([
    [".cursor/rules/api.mdc", true],
    ["AGENTS.md", false],
    ["CLAUDE.md", true],
    ["web/CLAUDE.md", true],
  ]);
  expect(r.files.find((f) => f.path === "CLAUDE.md")?.url).toBe("https://github.com/honeycrust/web/blob/HEAD/CLAUDE.md");
  expect(r.files.find((f) => f.path === "AGENTS.md")?.url).toBe("");
  expect(r.lastCommit).toBeGreaterThan(0);
  expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toBe(before);

  const p = projectInstructions("Honeycrust", ["codex"], [r], Date.now());
  expect(p.checks.map((c) => c.kind).sort()).toEqual(["conflict", "untracked"]);
  expect(p.checks.find((c) => c.kind === "conflict")).toMatchObject({ topic: "package-manager" });
});

test("fileUrl links committed files on GitHub and Bitbucket only", () => {
  expect(fileUrl("https://github.com/honeycrust/web.git", "AGENTS.md")).toBe("https://github.com/honeycrust/web/blob/HEAD/AGENTS.md");
  expect(fileUrl("git@bitbucket.org:fernway/api.git", "CLAUDE.md")).toBe("https://bitbucket.org/fernway/api/src/HEAD/CLAUDE.md");
  expect(fileUrl("git@gitlab.com:x/y.git", "CLAUDE.md")).toBe("");
});
