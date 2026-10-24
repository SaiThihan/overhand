/**
 * How hard this machine is working, in plain terms: CPU as a share of its capacity (1-minute load per core), memory
 * pressure, free disk, and the battery and heat when they matter, each green, amber or red. The daemon samples it once
 * a minute into a 3-hour ring (no extra process: loadavg is free, memory is one sysctl or /proc read); only while the
 * machine is strained does it also work out who is causing it, grouped by agent session, with everything else summed
 * up as "other apps" (your own apps are never named).
 */
import { readFileSync } from "node:fs";
import { cpus, freemem, totalmem } from "node:os";
import type { Config } from "./config";
import type { Machine } from "./governor";

export type Level = "ok" | "warn" | "bad";
export type Governor = Config["governor"];

/** One reading of the machine. `cpu` is load per core (1 = full capacity); `mem` the share of memory in use. */
export interface Reading extends Machine {
  at: number;
  mem: number;
}

/** One gauge as the dashboard words it. */
export interface Gauge {
  what: "cpu" | "mem" | "disk" | "battery" | "heat";
  level: Level;
  /** cpu: × capacity; mem: share in use; disk: GB free; battery: percent. */
  value: number;
}

const RANK: Record<Level, number> = { ok: 0, warn: 1, bad: 2 };
/** The worst of some levels. */
export const worst = (ls: readonly Level[]): Level => ls.reduce<Level>((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");

/**
 * The gauges for a reading: CPU red above the governor's load limit, amber from three quarters of capacity; memory amber
 * from 80% in use, red from 92%; disk red below the heavy-job floor, amber below the warning; battery and heat only when
 * they matter (on battery, or throttling).
 */
export function gauges(r: Reading, g: Governor): Gauge[] {
  const out: Gauge[] = [
    { what: "cpu", value: r.loadPerCore, level: r.loadPerCore >= g.maxLoadPerCore ? "bad" : r.loadPerCore >= 0.75 ? "warn" : "ok" },
    { what: "mem", value: r.mem, level: r.mem >= 0.92 ? "bad" : r.mem >= 0.8 ? "warn" : "ok" },
    { what: "disk", value: r.freeGb, level: r.freeGb < g.pauseHeavyBelowGb ? "bad" : r.freeGb < g.warnFreeGb ? "warn" : "ok" },
  ];
  if (r.battery && !r.battery.charging)
    out.push({
      what: "battery",
      value: r.battery.pct,
      level: r.battery.pct < g.minBatteryPct ? "bad" : r.battery.pct < g.minBatteryPct + 20 ? "warn" : "ok",
    });
  if (r.throttled) out.push({ what: "heat", value: 1, level: "bad" });
  return out;
}

/** /proc/meminfo: the share of memory in use (MemAvailable against MemTotal), or null when it doesn't say. */
export function parseMeminfo(text: string): number | null {
  const kb = (k: string) => Number(text.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"))?.[1] ?? Number.NaN);
  const total = kb("MemTotal");
  const avail = kb("MemAvailable");
  return total > 0 && avail >= 0 ? 1 - avail / total : null;
}

/**
 * Memory in use now: macOS's own pressure figure (kern.memorystatus_level, the share free), /proc/meminfo on Linux, and
 * free against total anywhere else.
 */
export function memoryInUse(): number {
  try {
    if (process.platform === "darwin") {
      const r = Bun.spawnSync(["sysctl", "-n", "kern.memorystatus_level"], { stdout: "pipe", stderr: "ignore", timeout: 2000 });
      const free = Number(r.stdout.toString().trim());
      if (free > 0 && free <= 100) return 1 - free / 100;
    } else if (process.platform === "linux") {
      const used = parseMeminfo(readFileSync("/proc/meminfo", "utf8"));
      if (used !== null) return used;
    }
  } catch {
    // fall through to the portable figure
  }
  return 1 - freemem() / Math.max(1, totalmem());
}

// ---------- who's causing it ----------

/** One process's cost: %CPU (of one core, as ps reports it) and resident memory in KB. */
export interface Cost {
  pid: number;
  ppid: number;
  pgid: number;
  cpu: number;
  rssKb: number;
}

/** `ps -A -o pid=,ppid=,pgid=,%cpu=,rss=` rows. */
export function parseCosts(out: string): Cost[] {
  return out.split("\n").flatMap((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)/);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), cpu: Number(m[4]), rssKb: Number(m[5]) }] : [];
  });
}

/** Every process's cost now (one ps call; commands aren't read, so nothing of yours is named). */
export function costs(): Cost[] {
  try {
    const r = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,pgid=,%cpu=,rss="], { stdout: "pipe", stderr: "ignore", timeout: 5000 });
    return parseCosts(r.stdout.toString());
  } catch {
    return [];
  }
}

/** A session as attribution sees it: its process and how to name it. */
export interface Who {
  pid: number;
  project: string;
  branch: string;
  name: string;
  browsers: number;
  heavy: { kind: string }[];
}

/** A group's share: CPU as a share of the machine's capacity, memory in MB. */
export interface Share {
  label: string;
  cpu: number;
  memMb: number;
}

/** "Orchard · spring-sale · browser checks · 19 headless browsers": project, branch or name, what it runs. */
export function whoLabel(s: Who): string {
  const kinds = [...new Set(s.heavy.map((h) => h.kind))];
  return [
    s.project,
    s.name || s.branch,
    kinds.length ? `${kinds.join(", ")} jobs` : "",
    s.browsers ? `${s.browsers} headless browsers` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * CPU and memory grouped by agent session (each session's whole process tree), largest first; everything else is one
 * "other apps" total. `cores` turns ps's per-core percentages into a share of the machine.
 */
export function attribute(sessions: Who[], table: Cost[], cores: number): { groups: Share[]; other: Omit<Share, "label"> } {
  const kids = new Map<number, Cost[]>();
  for (const p of table) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p]);
  const byPid = new Map(table.map((p) => [p.pid, p]));
  const taken = new Set<number>();
  const cap = Math.max(1, cores) * 100;
  const groups = sessions.flatMap((s) => {
    const tree: Cost[] = [];
    const stack = [s.pid];
    while (stack.length) {
      const pid = stack.pop() ?? 0;
      const p = byPid.get(pid);
      if (!p || taken.has(pid)) continue;
      taken.add(pid);
      tree.push(p);
      stack.push(...(kids.get(pid) ?? []).map((c) => c.pid));
    }
    if (!tree.length) return [];
    return [
      {
        label: whoLabel(s),
        cpu: tree.reduce((n, p) => n + p.cpu, 0) / cap,
        memMb: Math.round(tree.reduce((n, p) => n + p.rssKb, 0) / 1024),
      },
    ];
  });
  const rest = table.filter((p) => !taken.has(p.pid));
  return {
    groups: groups.sort((a, b) => b.cpu - a.cpu),
    other: { cpu: rest.reduce((n, p) => n + p.cpu, 0) / cap, memMb: Math.round(rest.reduce((n, p) => n + p.rssKb, 0) / 1024) },
  };
}

/** What's behind the strain: the biggest session when it uses at least a third of what's in use, else "other apps". */
export function causeOf(a: { groups: Share[]; other: Omit<Share, "label"> }): string {
  const top = a.groups[0];
  const used = a.groups.reduce((n, g) => n + g.cpu, 0) + a.other.cpu;
  return top && used > 0 && top.cpu >= used / 3 ? top.label : "other apps";
}

// ---------- the 3-hour history ----------

/** One point on the history line; `cause` is set on a red point (a spike), naming who caused it. */
export interface Point {
  at: number;
  cpu: number;
  mem: number;
  level: Level;
  cause: string;
}

/** 3 hours of one-a-minute samples. */
export const RING = 180;

/** The sampler's state: the ring, and the latest attribution (kept while strained). */
export interface Strain {
  history: Point[];
  groups: Share[];
  other: Omit<Share, "label">;
  cause: string;
}

/** A fresh sampler. */
export const blankStrain = (): Strain => ({ history: [], groups: [], other: { cpu: 0, memMb: 0 }, cause: "" });

/**
 * Takes one sample into `st`: the reading's point, and, only when CPU or memory is amber or red, who's causing it
 * (`attribution` is asked then and only then). Returns the point.
 */
export function takeSample(
  st: Strain,
  r: Reading,
  g: Governor,
  attribution: () => { groups: Share[]; other: Omit<Share, "label"> },
): Point {
  const gs = gauges(r, g).filter((x) => x.what === "cpu" || x.what === "mem");
  const level = worst(gs.map((x) => x.level));
  if (level === "ok") {
    st.groups = [];
    st.other = { cpu: 0, memMb: 0 };
    st.cause = "";
  } else {
    const a = attribution();
    st.groups = a.groups.slice(0, 5);
    st.other = a.other;
    st.cause = causeOf(a);
  }
  const point = { at: r.at, cpu: r.loadPerCore, mem: r.mem, level, cause: level === "bad" ? st.cause : "" };
  st.history.push(point);
  if (st.history.length > RING) st.history.splice(0, st.history.length - RING);
  return point;
}

/** Red for the last `n` samples: strain worth a card, not a blip. */
export const sustained = (st: Strain, n = 3): boolean => st.history.length >= n && st.history.slice(-n).every((p) => p.level === "bad");

/** The machine's core count, for the dashboard's "× capacity". */
export const CORES = cpus().length;

/** The daemon's own sampler, read by the dashboard. */
export const STRAIN: Strain = blankStrain();
