/**
 * Each CLI's own project config that could turn Overhand's guard off, found before a run starts: the run moves on to the
 * next account (claude.ts) instead of starting, and the runtime refuses it too if it gets that far.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeId } from "../config";
import { at, projectRoots, refusalText } from "./runtime";

/**
 * A workspace settings file (`.gemini/settings.json`) that touches hooks: `--skip-trust` makes Gemini CLI trust it, it
 * outranks Overhand's user layer, and its `hooksConfig` could switch the guard off or its own BeforeTool hook rewrite a
 * call after the guard passed it. One that can't be read counts too.
 */
export function geminiRepoHooks(cwd: string): string | null {
  for (const root of projectRoots(cwd)) {
    const f = join(root, ".gemini", "settings.json");
    if (!existsSync(f)) continue;
    try {
      const s: unknown = JSON.parse(readFileSync(f, "utf8"));
      if (typeof s !== "object" || s === null || "hooks" in s || "hooksConfig" in s) return f;
    } catch {
      return f;
    }
  }
  return null;
}

/** JSON with comments (opencode.jsonc): line and block comments outside strings dropped; undefined when it won't parse. */
function jsonc(text: string): unknown {
  try {
    return JSON.parse(text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, str: string | undefined) => str ?? ""));
  } catch {
    return undefined;
  }
}

/**
 * A plugin of the repo's own (a file in `.opencode/plugin(s)/`, or a non-empty `plugin` list in its opencode.json):
 * OpenCode runs plugins one after another, and one after Overhand's could rewrite a call the guard already passed. A
 * config that can't be read counts.
 */
export function opencodeRepoPlugins(cwd: string): string | null {
  for (const root of projectRoots(cwd)) {
    for (const d of ["plugin", "plugins"]) {
      const dir = join(root, ".opencode", d);
      if (existsSync(dir) && readdirSync(dir).length) return dir;
    }
    for (const f of ["opencode.json", "opencode.jsonc"].map((n) => join(root, n))) {
      if (!existsSync(f)) continue;
      const c = jsonc(readFileSync(f, "utf8"));
      if (c === undefined || [at(c, "plugin"), at(c, "plugins")].some((p) => Array.isArray(p) && p.length > 0)) return f;
    }
  }
  return null;
}

/**
 * A Codex project hook (`.codex/hooks.json`, or `[hooks]` in `.codex/config.toml`): Overhand's `--dangerously-bypass-
 * hook-trust` would trust it too. A config.toml that can't be read counts.
 */
export function codexRepoHooks(cwd: string): string | null {
  for (const root of projectRoots(cwd)) {
    const hooks = join(root, ".codex", "hooks.json");
    if (existsSync(hooks)) return hooks;
    const toml = join(root, ".codex", "config.toml");
    if (!existsSync(toml)) continue;
    try {
      const c: unknown = Bun.TOML.parse(readFileSync(toml, "utf8"));
      if (typeof c === "object" && c !== null && "hooks" in c) return toml;
    } catch {
      return toml;
    }
  }
  return null;
}

const FOUND: Partial<Record<RuntimeId, [string, (cwd: string) => string | null]>> = {
  codex: ["Codex", codexRepoHooks],
  gemini: ["Gemini CLI", geminiRepoHooks],
  opencode: ["OpenCode", opencodeRepoPlugins],
};

/** Why CLI `id` won't run in `cwd`, or null. */
export function repoRefusal(id: RuntimeId, cwd: string): string | null {
  const f = FOUND[id];
  return f ? refusalText(f[0], f[1](cwd)) : null;
}
