/**
 * Proof on every PR: which checks the agent ran and how they ended, what the diff touched, what the agent says it
 * verified, and the honest gaps. The daemon assembles it from the run's transcript and the worktree's diff
 * (packages/core/src/proof.ts); this is its shape and how it reads in a PR body. Pure.
 */
import { z } from "zod";

export const CHECK_KINDS = ["test", "typecheck", "lint", "build"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

/** One check command the agent ran, as its last run of that command ended. */
export const ProofCheckSchema = z.object({
  kind: z.enum(CHECK_KINDS),
  command: z.string(),
  ok: z.boolean(),
  /** The tool's own summary line ("120 pass, 0 fail", "Found 2 errors"); "" when it printed none we know. */
  summary: z.string(),
  /** Tests the run reported skipped; 0 when none or not said. */
  skipped: z.number(),
});
export type ProofCheck = z.infer<typeof ProofCheckSchema>;

export const ProofSchema = z.object({
  at: z.number(),
  /** False when the run left nothing Overhand can read the commands from (a CLI that prints only its answer). */
  transcript: z.boolean(),
  checks: z.array(ProofCheckSchema),
  files: z.number(),
  added: z.number(),
  removed: z.number(),
  /** Where the change is, biggest first (`packages/core`, `apps/web`, `(root)`). */
  areas: z.array(z.string()),
  /** The diff touches UI files (components, styles, pages); tests and stories don't count. */
  ui: z.boolean(),
  /** Only docs changed: the work report counts it at half. */
  docsOnly: z.boolean(),
  /** What the agent says it checked itself, in its words. */
  verified: z.string(),
  shots: z.object({ before: z.boolean(), after: z.boolean(), note: z.string() }),
  /** What the proof is missing, said plainly ("no tests ran"). Empty when nothing is. */
  gaps: z.array(z.string()),
});
export type Proof = z.infer<typeof ProofSchema>;

/** The gaps in a proof, from its facts: no tests, failed or skipped ones, UI with no screenshots, an empty diff. */
export function proofGaps(p: Omit<Proof, "gaps">): string[] {
  const gaps: string[] = [];
  if (!p.transcript) gaps.push("no run log Overhand can read: which checks ran is unknown");
  else if (!p.docsOnly && !p.checks.some((c) => c.kind === "test")) gaps.push("no tests ran");
  for (const c of p.checks) {
    if (!c.ok) gaps.push(`${c.kind === "test" ? "tests" : c.kind} failed: ${c.command}`);
    if (c.skipped) gaps.push(`tests skipped: ${c.skipped} (${c.command})`);
  }
  if (p.ui && !p.shots.after) gaps.push(`UI changed, no screenshots${p.shots.note ? `: ${p.shots.note}` : ""}`);
  if (!p.files) gaps.push("the diff is empty");
  return gaps;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** A one-line read of a check: its command, then its summary or its exit. */
export const checkLine = (c: ProofCheck): string =>
  `${c.ok ? "✅" : "❌"} \`${c.command}\`${c.summary ? ` — ${c.summary}` : c.ok ? " — passed" : " — failed"}`;

/**
 * The proof as a PR body section, in Markdown. With `attribution` off nothing names an agent or Overhand (the project
 * doesn't show AI attribution). CI isn't in it: the code host shows its checks on the PR itself.
 */
export function proofMarkdown(p: Proof, attribution: boolean): string {
  const agent = (yes: string, no: string) => (attribution ? yes : no);
  const lines = ["### Proof", "", `**${agent("Checks the agent ran", "Checks run")}**`];
  if (!p.transcript) lines.push("- unknown: no readable run log");
  else if (!p.checks.length) lines.push("- none");
  else lines.push(...p.checks.map((c) => `- ${checkLine(c)}`));
  lines.push(
    "",
    `**Changed:** ${plural(p.files, "file")}, +${p.added} −${p.removed}${p.areas.length ? ` in ${p.areas.map((a) => `\`${a}\``).join(", ")}` : ""}`,
  );
  if (p.verified.trim()) lines.push("", `**${agent("The agent says it verified", "Verified")}:** ${p.verified.trim()}`);
  if (p.ui)
    lines.push(
      "",
      `**Screenshots:** ${
        p.shots.after
          ? `${p.shots.before ? "before and after" : "after"} taken${attribution ? " (in Overhand's review)" : ""}`
          : p.shots.note || "none"
      }`,
    );
  lines.push("", "**Gaps:**", ...(p.gaps.length ? p.gaps.map((g) => `- ${g}`) : ["- none found"]));
  if (attribution) lines.push("", "_Assembled by Overhand from the agent's run log and the diff._");
  return lines.join("\n");
}
