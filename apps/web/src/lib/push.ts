/** Protected branches Settings offers a lead push access to; any others its config already lists are shown too. */
const PROTECTED_BRANCHES = ["develop", "main", "master", "staging"] as const;

/** A lead's `pushBranches` as a list; absent (a daemon from before the setting) or malformed reads as none. */
export function pushBranchesOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((b): b is string => typeof b === "string" && b.trim() !== "") : [];
}

/** The branches to offer: the usual protected ones, then any others the lead already may push to. */
export function pushOptions(current: readonly string[]): string[] {
  return [...new Set<string>([...PROTECTED_BRANCHES, ...current])];
}

/** The list with `branch` switched on or off, in the order it was given. */
export function togglePush(current: readonly string[], branch: string): string[] {
  return current.includes(branch) ? current.filter((b) => b !== branch) : [...current, branch];
}
