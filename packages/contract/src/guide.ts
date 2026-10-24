/**
 * Each project's onboarding guide (ONBOARDING.md at a repo's root): what the dashboard shows, and drift, the deterministic
 * check of what the guide says against what the repo has. Pure, shared by the daemon and the dashboard's demo.
 */
import { z } from "zod";

/** The guide's file, at the repo root. */
export const GUIDE_FILE = "ONBOARDING.md";

/**
 * One way the guide no longer matches the repo. `pm`: it names another package manager than the lockfile's (`said`,
 * `actual`). `script`: it runs a script or make target (`said`) the file `actual` doesn't define. `missing`: it runs a
 * tool (`said`) whose manifest `actual` isn't in the repo. `folder`: it mentions a top-level folder `said` that's gone.
 */
export const GuideDriftSchema = z.object({
  kind: z.enum(["pm", "script", "missing", "folder"]),
  said: z.string(),
  actual: z.string(),
});
export type GuideDrift = z.infer<typeof GuideDriftSchema>;

/**
 * A project's guide as the dashboard shows it. `source`: read from the default branch, from the open guide PR's branch,
 * a watch run's report (never written to the repo), or "" when there's none yet. `run`: a generation waiting for the
 * next work pass, under way, or the last one failed (`message` says why).
 */
export const GuideSchema = z.object({
  project: z.string(),
  /** The repo by name, never its path; "" when the project has no active repo. */
  repo: z.string(),
  source: z.enum(["default", "pr", "report", ""]),
  /** The file as written; empty when there's none. */
  text: z.string(),
  /** The branch the text was read from. */
  branch: z.string(),
  /** What "Share with your team" copies: the open PR while there is one, else the file on the code host; "" for neither. */
  share: z.string(),
  /** The open guide PR's local key (Review opens it), or "". */
  prKey: z.string(),
  run: z.enum(["idle", "queued", "running", "failed"]),
  message: z.string(),
  /** When the guide last changed (or the run last moved), for "updated 2 days ago". */
  at: z.number(),
  drift: z.array(GuideDriftSchema),
});
export type Guide = z.infer<typeof GuideSchema>;

/** What drift compares the guide with, read from the same branch as the guide. */
export interface RepoFacts {
  /** Top-level folders. */
  dirs: readonly string[];
  /** Top-level files. */
  files: readonly string[];
  /** package.json's scripts; null without a package.json. */
  scripts: Readonly<Record<string, string>> | null;
  /** The Makefile's targets; null without a Makefile. */
  makeTargets: readonly string[] | null;
}

/** A Makefile's targets: `name:` at the start of a line, not `:=` assignments or special `.TARGETS`. */
export function makeTargets(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/^([A-Za-z0-9_][\w.-]*(?:[ \t]+[A-Za-z0-9_][\w.-]*)*)[ \t]*:(?!=)/gm))
    for (const t of (m[1] ?? "").split(/\s+/)) if (t) out.add(t);
  return [...out];
}

/** Lockfiles and the package manager each one means. */
const LOCKS: [file: string, pm: string][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["uv.lock", "uv"],
  ["poetry.lock", "poetry"],
  ["Pipfile.lock", "pipenv"],
];
/** Each package manager's ecosystem: a guide saying npm is only wrong about a repo that locks with another JS one. */
const ECOSYSTEM: Record<string, "js" | "py"> = { bun: "js", pnpm: "js", yarn: "js", npm: "js", uv: "py", poetry: "py", pipenv: "py" };
/** Command words and the package manager they belong to. */
const PM_WORD: Record<string, string> = {
  npm: "npm",
  npx: "npm",
  pnpm: "pnpm",
  pnpx: "pnpm",
  yarn: "yarn",
  bun: "bun",
  bunx: "bun",
  uv: "uv",
  uvx: "uv",
  poetry: "poetry",
  pipenv: "pipenv",
};
/** Subcommands each JS package manager runs itself, not as a package.json script. npm runs scripts only via run (and test/start…). */
const BUILTIN: Record<string, Set<string>> = {
  bun: new Set(
    "install i add a remove rm update upgrade outdated link unlink pm init create publish patch test build run x exec repl audit info why".split(
      " ",
    ),
  ),
  pnpm: new Set(
    "install i add remove rm uninstall up update upgrade dlx exec create init publish link unlink why info outdated audit config cache list ls store workspace import patch pack version env setup bin dedupe prune fetch rebuild licenses deploy root help run".split(
      " ",
    ),
  ),
  yarn: new Set(
    "install add remove up upgrade update dlx exec create init publish link unlink why info outdated audit config cache list workspace workspaces import patch pack version set plugin node bin dedupe help global run".split(
      " ",
    ),
  ),
};
/** npm's shortcuts for scripts of the same name. */
const NPM_SCRIPTS = new Set(["test", "start", "stop", "restart"]);
/** Tools that need a manifest in the repo to run at all. */
const MANIFEST: Record<string, string> = { cargo: "Cargo.toml", go: "go.mod", make: "Makefile" };
/** Folders a guide may name that are generated or local, so never in the tree. */
const LOCAL_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "target", ".next", ".venv", "venv", "tmp", ".git"]);

/** The guide's code: each line of its fenced blocks, and its inline `code` spans outside them. */
export function guideCode(text: string): { lines: string[]; spans: string[] } {
  const lines: string[] = [];
  const spans: string[] = [];
  let fence = "";
  for (const line of text.split("\n")) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (f && (!fence || f.startsWith(fence))) {
      fence = fence ? "" : f;
      continue;
    }
    if (fence) lines.push(line);
    else for (const m of line.matchAll(/(`+)([^`]+?)\1/g)) spans.push((m[2] ?? "").trim());
  }
  return { lines, spans };
}

/** The commands in a line of code: split at `&&`, `||`, `;` and `|`, a leading `$ ` prompt dropped. */
const commands = (code: string): string[][] =>
  code
    .split(/&&|\|\||;|\|/)
    .map((c) =>
      c
        .trim()
        .replace(/^[$>#]\s+/, "")
        .split(/\s+/)
        .filter(Boolean),
    )
    .filter((c) => c.length > 0);

/** A word that names a script, not a flag, a file or a placeholder. */
const scriptName = (w: string | undefined): string => (w && /^[A-Za-z0-9_][\w:.-]*$/.test(w) && !/\.(?:[cm]?[jt]s|json)$/.test(w) ? w : "");

/**
 * Where the guide no longer matches the repo, each finding once, in order: package manager, scripts and tools, folders.
 * Deterministic and conservative: only commands in code (inline or fenced) count, and a path counts as a folder only
 * when it ends in `/`, names a file with an extension, or has three parts, so a package import like `react-dom/client`
 * isn't read as one.
 */
export function guideDrift(text: string, repo: RepoFacts): GuideDrift[] {
  const { lines, spans } = guideCode(text);
  const cmds = [...lines, ...spans].flatMap(commands);
  const out: GuideDrift[] = [];
  const add = (d: GuideDrift) => {
    if (!out.some((x) => x.kind === d.kind && x.said === d.said)) out.push(d);
  };

  // the package manager: named in commands, against the lockfile of the same ecosystem
  const said = new Map<string, number>();
  for (const c of cmds) {
    const pm = PM_WORD[c[0] ?? ""];
    if (pm) said.set(pm, (said.get(pm) ?? 0) + 1);
  }
  const locked = new Map<string, string>();
  for (const [file, pm] of LOCKS) {
    const eco = ECOSYSTEM[pm];
    if (eco && repo.files.includes(file) && !locked.has(eco)) locked.set(eco, pm);
  }
  for (const [eco, actual] of locked) {
    if (said.has(actual)) continue;
    const other = [...said].filter(([pm]) => ECOSYSTEM[pm] === eco).sort((a, b) => b[1] - a[1])[0];
    if (other) add({ kind: "pm", said: other[0], actual });
  }

  // scripts and make targets the guide runs, and tools whose manifest is gone
  for (const c of cmds) {
    const [tool = "", sub, arg] = c;
    const manifest = MANIFEST[tool];
    if (manifest && !repo.files.includes(manifest)) {
      add({ kind: "missing", said: c.slice(0, 2).join(" "), actual: manifest });
      continue;
    }
    if (tool === "make" && repo.makeTargets) {
      const t = scriptName(c.slice(1).find((w) => !w.startsWith("-") && !w.includes("=")));
      if (t && !repo.makeTargets.includes(t)) add({ kind: "script", said: `make ${t}`, actual: "Makefile" });
      continue;
    }
    if (!repo.scripts || !["npm", "pnpm", "yarn", "bun"].includes(tool)) continue;
    const name =
      sub === "run" || sub === "run-script"
        ? scriptName(arg)
        : tool === "npm"
          ? NPM_SCRIPTS.has(sub ?? "")
            ? (sub ?? "")
            : ""
          : BUILTIN[tool]?.has(sub ?? "")
            ? ""
            : scriptName(sub);
    if (name && !(name in repo.scripts))
      add({ kind: "script", said: [tool, sub === name ? "" : sub, name].filter(Boolean).join(" "), actual: "package.json" });
  }

  // top-level folders the guide names that the repo no longer has
  const paths = [
    ...spans.filter((s) => !/\s/.test(s)),
    ...lines.flatMap((l) => (/^([A-Za-z0-9_][\w.-]*\/)\s*(?:#.*)?$/.exec(l)?.[1] ?? "").split(" ").filter(Boolean)),
  ];
  for (const p of paths) {
    const m = /^(?:\.\/)?([A-Za-z0-9_][\w.-]*)\/((?:[\w.@*-]+\/?)*)$/.exec(p);
    if (!m) continue;
    const [, top = "", rest = ""] = m;
    const parts = rest.split("/").filter(Boolean);
    const folderish = p.endsWith("/") || /\.\w+$/.test(parts.at(-1) ?? "") || parts.length >= 2;
    if (!folderish || LOCAL_DIRS.has(top) || repo.dirs.includes(top) || repo.files.includes(top)) continue;
    add({ kind: "folder", said: `${top}/`, actual: "" });
  }
  return out;
}
