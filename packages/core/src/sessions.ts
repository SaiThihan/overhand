/**
 * Live agent sessions on this machine: Claude Code ones read from Claude Code's own files, leads on other agent CLIs
 * from their logs; and readable logs.
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { clip, plainText } from "@overhand/contract";
import { AGENT_HOME, existingHome, ownSignInHome } from "./agent-home";
import { ACCOUNTS, CFG, CLIENTS, CODE, HOME, MIN, runtimeOf, shAsync } from "./env";
import { leadChildren, leadDir, leadPid, loadLeads, lockHolder } from "./leads";
import { cwdOf } from "./platform";
import { RUNTIMES } from "./runtimes";
import { currentRuns, readJson } from "./state";
import { streamEvents } from "./usage";

/** A lead's log as the last lines a person reads, by the agent CLI its account runs (Claude Code's stream-json by default). */
export function leadLog(raw: string, account: string, maxLines = 80): string {
  const rt = RUNTIMES[runtimeOf(account).kind];
  return rt.readable ? rt.readable(raw, maxLines) : readableLog(raw, maxLines);
}

/** Leads running on an agent CLI other than Claude Code: `ps` finds only `claude`, so these come from .leads.json and their log. */
function otherAgentLeads(): LiveSession[] {
  const leads = loadLeads();
  return CFG.godmode.flatMap((g) => {
    const st = leads[g.key];
    const pid = st ? leadPid(g, st) : 0;
    if (!st || !pid || runtimeOf(st.account ?? "").kind === "claude-code") return [];
    const log = st.log && existsSync(st.log) ? st.log : "";
    const at = log ? statSync(log).mtimeMs : 0;
    const tail = log ? readFileSync(log, "utf8").slice(-64_000) : "";
    return [
      {
        pid,
        kind: "lead" as const,
        label: g.label,
        client: g.project || "Other",
        cwd: leadDir(g).replace(HOME, "~"),
        branch: branchAt(leadDir(g)),
        upSec: Math.round((Date.now() - st.startedAt) / 1000),
        active: Date.now() - at < 2 * MIN,
        name: "",
        model: runtimeOf(st.account ?? "").model,
        mode: "auto",
        lastAction: clip(plainText(leadLog(tail, st.account ?? "", 1)), 200),
        subagents: [],
      },
    ];
  });
}

export interface LiveSession {
  pid: number;
  kind: "agent" | "lead" | "you";
  label: string;
  client: string;
  cwd: string;
  upSec: number;
  /** Wrote to its transcript in the last 2 minutes (working), else idle or waiting for input. */
  active: boolean;
  /** The session's name in Claude Code (/rename), when it has one. */
  name: string;
  /** The model of its latest reply and its permission mode (auto, plan, …); empty when unknown. */
  model: string;
  mode: string;
  /** Its latest step as a person reads it: what it said or the tool it ran. */
  lastAction: string;
  /** The branch checked out where it works; "" when that isn't a repo or it's detached. */
  branch: string;
  /** Subagents that wrote in the last 30 minutes, working ones first, each with where it works. */
  subagents: {
    name: string;
    description: string;
    color: string;
    active: boolean;
    lastAt: number;
    model: string;
    mode: string;
    cwd: string;
    client: string;
    branch: string;
  }[];
}

/** The folder a transcript's latest event names (Claude Code writes `cwd` on each): where that agent works now. */
export function transcriptCwd(text: string): string {
  return latestCwd(streamEvents(text).reverse());
}
/** The first `cwd` among events already parsed, newest first. */
const latestCwd = (newestFirst: ReturnType<typeof streamEvents>): string => {
  for (const e of newestFirst) if (typeof e !== "string" && typeof e.cwd === "string" && e.cwd) return e.cwd;
  return "";
};

/** The branch checked out at dir, from git's own files (no git process: this runs on every state read); "" = none. */
export function branchAt(dir: string): string {
  for (let d = resolve(dir); ; d = dirname(d)) {
    const dot = join(d, ".git");
    if (existsSync(dot)) {
      try {
        const gitDir = statSync(dot).isDirectory()
          ? dot
          : resolve(
              d,
              readFileSync(dot, "utf8")
                .match(/^gitdir: (.+)$/m)?.[1]
                ?.trim() ?? ".git",
            );
        return (
          readFileSync(join(gitDir, "HEAD"), "utf8")
            .match(/^ref: refs\/heads\/(.+)$/m)?.[1]
            ?.trim() ?? ""
        );
      } catch {
        return "";
      }
    }
    if (dirname(d) === d) return "";
  }
}

/** The project a folder belongs to, by the configured project folders; "Other" when none. */
const clientAt = (cwd: string): string =>
  CLIENTS.find((c) => cwd === join(CODE, c.dir) || cwd.startsWith(`${join(CODE, c.dir)}/`))?.name ?? "Other";

type Tail = { model: string; mode: string; lastAction: string; cwd: string };
/** Each transcript's tail as last read, by file, with the size and time it had: re-read only when it changed. */
const tails = new Map<string, { size: number; mtime: number; tail: Tail }>();

/**
 * The latest reply's model, the permission mode, the latest step and its folder, from a transcript's last 256 KB.
 * Runs on every state read for every session and subagent, so an unchanged file (same size and time) is not re-read.
 */
export function transcriptTail(file: string): Tail {
  if (!existsSync(file)) return { model: "", mode: "", lastAction: "", cwd: "" };
  const { size, mtimeMs: mtime } = statSync(file);
  const seen = tails.get(file);
  if (seen && seen.size === size && seen.mtime === mtime) return seen.tail;
  // read only the tail: transcripts of long sessions run to hundreds of MB
  const buf = Buffer.alloc(Math.min(size, 256 * 1024));
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, buf.length, size - buf.length);
  } finally {
    closeSync(fd);
  }
  const text = buf.toString("utf8");
  const newestFirst = streamEvents(text).reverse();
  let model = "";
  let mode = "";
  for (const e of newestFirst) {
    if (typeof e === "string") continue;
    const msg = e.message as { model?: string } | undefined;
    if (!model && e.type === "assistant" && msg?.model && msg.model !== "<synthetic>") model = msg.model;
    if (!mode && typeof e.permissionMode === "string") mode = e.permissionMode;
    if (model && mode) break;
  }
  // transcripts use the same event shapes as stream-json, so the log reader picks the latest step
  const tail = { model, mode, lastAction: clip(plainText(readableLog(text, 1)), 200), cwd: latestCwd(newestFirst) };
  // ponytail: one entry per transcript ever seen; sessions are few, so it's only trimmed when it grows large
  if (tails.size > 500) tails.clear();
  tails.set(file, { size, mtime, tail });
  return tail;
}

const RECENT_SUBAGENT_MS = 30 * MIN;

/**
 * A live Claude process's session, from Claude Code's own files: sessions/<pid>.json names the session id, and
 * projects/<cwd>/<id>.jsonl plus <id>/subagents/ hold its transcript and each subagent's (with a .meta.json).
 */
function sessionDetail(
  pid: number,
  proj: string,
  configDirs: string[],
): {
  name: string;
  lastAt: number;
  model: string;
  mode: string;
  lastAction: string;
  cwd: string;
  subagents: LiveSession["subagents"];
} | null {
  for (const d of configDirs) {
    const meta = readJson<{ sessionId?: string; name?: string } | null>(join(d, "sessions", `${pid}.json`), null);
    if (!meta?.sessionId) continue;
    const base = join(d, "projects", proj, meta.sessionId);
    const lastAt = existsSync(`${base}.jsonl`) ? statSync(`${base}.jsonl`).mtimeMs : 0;
    const dir = join(base, "subagents");
    const subagents = (existsSync(dir) ? readdirSync(dir) : [])
      .filter((f) => f.endsWith(".meta.json"))
      .flatMap((f) => {
        const log = join(dir, f.replace(/\.meta\.json$/, ".jsonl"));
        const at = existsSync(log) ? statSync(log).mtimeMs : 0;
        if (Date.now() - at > RECENT_SUBAGENT_MS) return [];
        const m = readJson<{
          name?: string;
          agentType?: string;
          description?: string;
          color?: string;
          model?: string;
          permissionMode?: string;
        }>(join(dir, f), {});
        // unnamed subagents are all "general-purpose": their task description is the useful title
        const name = m.name ?? m.description ?? m.agentType ?? "subagent";
        const type = m.agentType === "general-purpose" ? "" : (m.agentType ?? "");
        const description = m.name ? (m.description ?? "") : type;
        const tail = transcriptTail(log);
        return [
          {
            name,
            description,
            color: m.color ?? "",
            active: Date.now() - at < 2 * MIN,
            lastAt: at,
            model: m.model ?? tail.model,
            mode: m.permissionMode ?? "",
            // a subagent in a worktree of its own works somewhere else than its session
            cwd: tail.cwd.replace(HOME, "~"),
            client: tail.cwd ? clientAt(tail.cwd) : "",
            branch: tail.cwd ? branchAt(tail.cwd) : "",
          },
        ];
      })
      .sort((a, b) => Number(b.active) - Number(a.active) || b.lastAt - a.lastAt);
    return { name: meta.name ?? "", lastAt, ...transcriptTail(`${base}.jsonl`), subagents };
  }
  return null;
}

/** `ps` elapsed time ([[dd-]hh:]mm:ss) in seconds. */
const etimeSec = (e: string): number => {
  const [d, rest] = e.includes("-") ? e.split("-") : ["0", e];
  return (rest ?? "").split(":").reduce((n, x) => n * 60 + Number(x), 0) + Number(d) * 86_400;
};

// each running Claude Code process's starting folder, by pid
const startCwds = new Map<number, string>();

/** Every running Claude Code process on this machine, whatever started it: ops agents, supervised leads, your terminals. */
export async function liveSessions(): Promise<LiveSession[]> {
  const running = currentRuns();
  const leadsState = loadLeads();
  const configDirs = [join(HOME, ".claude"), AGENT_HOME, ...ACCOUNTS.map((a) => existingHome(a) || ownSignInHome(a)).filter(Boolean)];
  const out: LiveSession[] = [];
  const seen = new Set<number>();
  for (const line of (await shAsync(["ps", "-Ao", "pid=,etime=,comm="])).out.split("\n")) {
    const [pidStr, etime, ...cmd] = line.trim().split(/\s+/);
    if ((cmd.join(" ").split("/").pop() ?? "") !== "claude") continue;
    const pid = Number(pidStr);
    seen.add(pid);
    // where it started never changes, so lsof runs once per process (~40 ms each on macOS, every few seconds otherwise)
    const cwd = startCwds.get(pid) ?? cwdOf(pid);
    startCwds.set(pid, cwd);
    // Claude Code keeps each project's transcripts in projects/<cwd with / and . turned into ->
    const proj = cwd.replace(/[/.]/g, "-");
    const newest = configDirs
      .map((d) => join(d, "projects", proj))
      .filter((d) => existsSync(d))
      .flatMap((d) =>
        readdirSync(d)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => statSync(join(d, f)).mtimeMs),
      );
    const detail = sessionDetail(pid, proj, configDirs);
    const lastAt = detail?.lastAt || (newest.length ? Math.max(...newest) : 0); // its own transcript when known
    const lead = CFG.godmode.find((g) => leadChildren.get(g.key)?.pid === pid || leadsState[g.key]?.pid === pid || lockHolder(g) === pid);
    const run = running.find((r) => r.pid === pid);
    const kind = run ? "agent" : lead ? "lead" : "you";
    // where it works now: its transcript's latest folder (a session can move into a worktree), else where it started
    const at = detail?.cwd || cwd;
    out.push({
      pid,
      kind,
      label: run ? `${run.name} on ${run.account}` : lead ? lead.label : "Your session",
      client: clientAt(at),
      cwd: at.replace(HOME, "~"),
      branch: branchAt(at),
      upSec: etimeSec(etime ?? "0"),
      active: Date.now() - lastAt < 2 * MIN,
      name: detail?.name ?? "",
      model: detail?.model ?? "",
      mode: detail?.mode || (lead ? "auto" : ""), // headless leads don't log it; ops starts them in auto
      lastAction: detail?.lastAction ?? "",
      subagents: detail?.subagents ?? [],
    });
  }
  for (const pid of startCwds.keys()) if (!seen.has(pid)) startCwds.delete(pid);
  return [...out, ...otherAgentLeads()];
}

/** Turns a stream-json log into the last lines a person wants: what the lead said, which tools it ran, how it ended. */
export function readableLog(raw: string, maxLines = 80): string {
  const out: string[] = [];
  const brief = (input: Record<string, unknown> = {}) =>
    String(input.command ?? input.description ?? input.file_path ?? input.pattern ?? input.prompt ?? input.url ?? "")
      .replace(/\s+/g, " ")
      .slice(0, 140);
  for (const line of streamEvents(raw)) {
    if (typeof line === "string") {
      out.push(line);
      continue;
    }
    const e = line as {
      type?: string;
      message?: { content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[] };
      result?: string;
      is_error?: boolean;
    };
    if (e.type === "assistant") {
      for (const c of e.message?.content ?? []) {
        if (c.type === "text" && c.text?.trim()) out.push(c.text.trim());
        else if (c.type === "tool_use") out.push(`→ ${c.name}${brief(c.input) ? `: ${brief(c.input)}` : ""}`);
      }
    } else if (e.type === "result")
      out.push(`${e.is_error ? "✗ ended with an error" : "✓ finished"}: ${String(e.result ?? "").slice(0, 300)}`);
  }
  return out.slice(-maxLines).join("\n");
}
