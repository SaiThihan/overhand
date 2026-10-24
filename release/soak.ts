/**
 * The open-all-day soak: one dashboard tab on a scratch daemon, fed a realistic day (agents start and finish, the
 * activity log grows past a full day's worth, questions come and go, merges, failures, the odd theme switch, and idle
 * stretches), sampled for growth. It fails when the tab's heap, DOM or listeners keep growing after warm-up, when the
 * daemon's memory runs away, or when keeping the tab open while nothing happens costs more than the budget.
 *
 * Usage: bun release/soak.ts --minutes 20          (the release gate: a compressed two and a half days)
 *        bun release/soak.ts --hours 24            (the real thing: a day at a day's pace)
 *        [--out dir] [--every <seconds>] [--port 4396] [--no-build]
 *
 * Writes <out>/samples.csv, samples.jsonl, daemon.log and chart.html (rewritten at every sample, so it can be opened
 * mid-run). Its daemon gets its own OVERHAND_HOME, HOME and port, a PATH whose gh and claude refuse, and stops with the
 * soak: the owner's daemon (4317) and config are never touched. Everything runs at nice 10, one browser, one tab.
 */
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { getPriority, setPriority, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Browser, CDPSession, Page } from "playwright-core";

const ROOT = resolve(import.meta.dir, "..");

/** One sample: the tab and the daemon at the end of an interval, and what the interval cost. */
export interface Sample {
  /** Seconds since the tab opened. */
  t: number;
  /** Nothing changed and nobody clicked during the interval, or in the minute before it. */
  idle: boolean;
  /** JS heap in use after a forced GC, MB. */
  heapMb: number;
  nodes: number;
  listeners: number;
  /** Renderer + GPU CPU over the interval, % of one core. */
  tabCpu: number;
  /** Bytes the tab received over the interval, KB per minute. */
  netKbMin: number;
  daemonRssMb: number;
  /** Daemon CPU over the interval, % of one core. */
  daemonCpu: number;
  /** Lines in today's activity log, for the chart's context. */
  lines: number;
}

/**
 * What staying open may cost. Growth is the median of the last third of the post-warm-up samples against the median of
 * the first third (the state legitimately moves the DOM around, so single samples are noise); idle is the mean over
 * idle intervals.
 */
export const BUDGET = {
  heapGrowth: 0.2,
  heapSlackMb: 3,
  nodeGrowth: 0.2,
  nodeSlack: 300,
  listenerGrowth: 0.2,
  listenerSlack: 60,
  daemonRssGrowth: 0.5,
  daemonRssMaxMb: 512,
  /** Renderer + GPU while idle, % of one core. */
  tabIdleCpu: 3,
  /** Daemon while idle, % of one core. */
  daemonIdleCpu: 3,
  /** What the tab receives while idle, KB per minute. */
  idleNetKbMin: 512,
} as const;

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Judges a run against BUDGET: every check, passing or not. Samples before `warmupS` only set the scene. */
export function verdict(samples: Sample[], warmupS: number, budget: typeof BUDGET = BUDGET): Check[] {
  const after = samples.filter((s) => s.t >= warmupS);
  if (after.length < 6) return [{ name: "samples", ok: false, detail: `${after.length} after warm-up; need 6` }];
  const third = Math.max(2, Math.floor(after.length / 3));
  const growth = (name: string, pick: (s: Sample) => number, rate: number, slack: number, unit: string): Check => {
    const base = median(after.slice(0, third).map(pick));
    const end = median(after.slice(-third).map(pick));
    const limit = base * (1 + rate) + slack;
    return { name, ok: end <= limit, detail: `${r1(base)} → ${r1(end)}${unit} (limit ${r1(limit)}${unit})` };
  };
  const idle = after.filter((s) => s.idle);
  const idleMean = (name: string, pick: (s: Sample) => number, limit: number, unit: string): Check =>
    idle.length
      ? {
          name,
          ok: mean(idle.map(pick)) <= limit,
          detail: `${r1(mean(idle.map(pick)))}${unit} (limit ${limit}${unit}, ${idle.length} idle samples)`,
        }
      : { name, ok: false, detail: "no idle samples" };
  const rssBase = median(after.slice(0, third).map((s) => s.daemonRssMb));
  // the peak after the base window: a daemon that gives memory back early in that window drops the base, and its
  // earlier high must not then count as growth over it (a 20-minute run on the map design: 133 MB, then 60, then 94)
  const rssMax = Math.max(...after.slice(third).map((s) => s.daemonRssMb));
  const rssLimit = Math.min(rssBase * (1 + budget.daemonRssGrowth), budget.daemonRssMaxMb);
  return [
    growth("tab heap", (s) => s.heapMb, budget.heapGrowth, budget.heapSlackMb, " MB"),
    growth("tab DOM nodes", (s) => s.nodes, budget.nodeGrowth, budget.nodeSlack, ""),
    growth("tab listeners", (s) => s.listeners, budget.listenerGrowth, budget.listenerSlack, ""),
    { name: "daemon RSS", ok: rssMax <= rssLimit, detail: `${r1(rssBase)} → peak ${r1(rssMax)} MB (limit ${r1(rssLimit)} MB)` },
    idleMean("tab idle CPU", (s) => s.tabCpu, budget.tabIdleCpu, "%"),
    idleMean("daemon idle CPU", (s) => s.daemonCpu, budget.daemonIdleCpu, "%"),
    idleMean("tab idle network", (s) => s.netKbMin, budget.idleNetKbMin, " KB/min"),
  ];
}

/** A small seeded random source, so two soaks of the same length replay the same day. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The synthetic day: what the daemon's files would say, written into the scratch OVERHAND_HOME.

const PROJECTS = [
  { name: "Honeycrust", prefix: "HONEY", lead: "honey" },
  { name: "Fernway", prefix: "FERN", lead: "fern" },
];
const ACCOUNTS = ["work-max", "side-pro"];
const THEMES = ["overhand", "nexus", "legion", "syndicate", "tokenmaxx", "catnap"];
const TITLES = [
  "fix the checkout total rounding",
  "add retry to the webhook sender",
  "move invoices to the new table",
  "tighten the session cookie",
  "make the search box keyboard friendly",
  "drop the unused feature flags",
  "speed up the nightly export",
  "show the order status on mobile",
];
/** The working day, in virtual minutes after midnight: outside it nothing happens (the idle stretches). */
const WORK = [8 * 60, 20 * 60];

/** The scratch daemon's config: two projects with leads, no secrets that exist, nothing that reaches the network. */
function config(home: string): object {
  return {
    owner: { name: "Sam", keychainAccount: "soak-nobody" },
    accounts: ACCOUNTS,
    codeRoot: join(home, "code"),
    clients: PROJECTS.map((p) => ({
      name: p.name,
      dir: p.lead,
      prefix: p.prefix,
      host: "github",
      aliases: [p.lead],
      tracker: { kind: "linear", secret: "soak-no-such-secret" },
    })),
    slack: [],
    godmode: PROJECTS.map((p) => ({
      key: p.lead,
      label: `${p.name} lead`,
      dir: p.lead,
      project: p.name,
      lockFile: `${p.lead}/.lead.lock`,
    })),
  };
}

interface Running {
  name: string;
  account: string;
  start: number;
  /** Virtual minute it ends. */
  ends: number;
}

/** Writes a JSON file the way the daemon does: whole or not at all. */
function atomic(path: string, data: unknown): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(data));
  renameSync(`${path}.tmp`, path);
}

/** The day as the daemon's files tell it, advanced one virtual minute at a time. */
class Day {
  private r = rng(20261020);
  private running: Running[] = [];
  private prs = new Map<string, { url: string; branch: string; mergeAt: number; draft: boolean }>();
  private pending = new Map<string, { client: string; title: string; goneAt: number; createAfter: number }>();
  private asks = new Map<string, number>(); // lead → when it gets answered
  private leadsUp = new Map<string, number>(); // lead → when it stops
  private ticket = 100;
  lines = 0;

  constructor(
    private home: string,
    private pid: number,
  ) {}

  private file = (...p: string[]): string => join(this.home, ...p);
  private date = (): string => new Date().toLocaleDateString("sv-SE");

  private say(min: number, line: string): void {
    const hm = `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    appendFileSync(this.file("reports", `${this.date()}.md`), `- ${hm} ${line}\n`);
    this.lines++;
  }

  private pick<T>(xs: readonly T[]): T {
    const x = xs[Math.floor(this.r() * xs.length)];
    if (x === undefined) throw new Error("pick from an empty list");
    return x;
  }

  /** Advances to virtual minute `min`; true when anything changed. */
  tick(min: number, now: number): boolean {
    const work = min % 1440 >= (WORK[0] ?? 0) && min % 1440 < (WORK[1] ?? 1440);
    let changed = false;
    let state = false;
    let runs = false;

    // agents finish: a run line, a report line, maybe a pull request
    for (const run of this.running.filter((x) => x.ends <= min)) {
      const ok = this.r() > 0.15;
      const mins = run.ends - run.start;
      appendFileSync(
        this.file("runs", `${this.date()}.jsonl`),
        `${JSON.stringify({
          name: run.name,
          account: run.account,
          start: now - mins * 60_000,
          end: now,
          cost: Math.round(this.r() * 300) / 100,
          ok,
          kind: "ticket",
          key: run.name,
          project: PROJECTS.find((p) => run.name.startsWith(p.prefix))?.name ?? "",
          runtime: "claude-code",
          provider: "claude",
          model: "",
        })}\n`,
      );
      if (ok) {
        const url = `https://github.com/acme/${run.name.split("-")[0]?.toLowerCase()}/pull/${this.ticket}`;
        this.prs.set(run.name, { url, branch: `agent/${run.name}`, mergeAt: min + 30 + Math.floor(this.r() * 150), draft: this.r() > 0.6 });
        this.say(min, `✅ ${run.name} (${run.account}, $${(this.r() * 3).toFixed(2)}) → ${url}`);
        state = true;
      } else this.say(min, `✗ ${run.name} exited (code 1) after ${mins} min`);
      runs = true;
    }
    this.running = this.running.filter((x) => x.ends > min);

    // pull requests merge; questions get answered; Slack requests become tickets or are vetoed
    for (const [key, pr] of this.prs)
      if (pr.mergeAt <= min) {
        this.prs.delete(key);
        this.say(min, `🎉 ${key} PR merged`);
        state = true;
      }
    for (const [id, p] of this.pending)
      if (p.goneAt <= min) {
        this.pending.delete(id);
        state = true;
      }
    for (const [lead, at] of this.asks)
      if (at <= min) {
        this.asks.delete(lead);
        appendFileSync(this.file("leads", lead, "questions.md"), "\n## Answer from Sam\nGo with your recommendation.\n");
        this.say(min, `answered ${lead}`);
        changed = true;
      }
    for (const [lead, at] of this.leadsUp)
      if (at <= min) {
        this.leadsUp.delete(lead);
        rmSync(this.file("code", lead, ".lead.lock"), { force: true });
        this.say(min, `${lead} exited (0) after ${20 + Math.floor(this.r() * 40)} min`);
        changed = true;
      }

    if (work) {
      if (this.running.length < 3 && this.r() < 0.07) {
        const p = this.pick(PROJECTS);
        const name = `${p.prefix}-${this.ticket++}`;
        const account = this.pick(ACCOUNTS);
        this.running.push({ name, account, start: min, ends: min + 8 + Math.floor(this.r() * 50) });
        this.say(min, `${name} started headless (pid ${this.pid}, ${account})`);
        runs = true;
      }
      if (this.r() < 0.012) {
        const p = this.pick(PROJECTS);
        const id = `soak-${min}`;
        this.pending.set(id, {
          client: p.name,
          title: this.pick(TITLES),
          goneAt: min + 10 + Math.floor(this.r() * 30),
          createAfter: now + 15 * 60_000,
        });
        this.say(min, `inbox: 1 item (${p.name})`);
        state = true;
      }
      for (const p of PROJECTS) {
        if (!this.asks.has(p.lead) && this.r() < 0.008) {
          this.asks.set(p.lead, min + 20 + Math.floor(this.r() * 100));
          writeFileSync(
            this.file("leads", p.lead, "questions.md"),
            `## Should ${this.pick(TITLES)} ship behind a flag?\nI'd ship it behind a flag for a day.\nOptions: flag | straight to main\nIf there's no answer: I'll put it behind a flag.\n`,
          );
          this.say(min, `❓ ${p.lead} asked a question`);
          changed = true;
        }
        if (!this.leadsUp.has(p.lead) && this.r() < 0.01) {
          this.leadsUp.set(p.lead, min + 20 + Math.floor(this.r() * 60));
          writeFileSync(this.file("code", p.lead, ".lead.lock"), JSON.stringify({ pid: this.pid, heartbeat: now }));
          this.say(min, `${p.lead} started headless (pid ${this.pid}, ${this.pick(ACCOUNTS)})`);
          changed = true;
        }
      }
      // the chatter between the stories
      if (this.r() < 0.35) {
        const p = this.pick(PROJECTS);
        this.say(
          min,
          this.pick([
            `${p.lead} found nothing to do; next look in 30 min`,
            `${p.name}: acme/${p.lead}#${200 + Math.floor(this.r() * 50)} opened: ${this.pick(TITLES)}`,
            `${p.name}: acme/${p.lead}#${200 + Math.floor(this.r() * 50)} approved: ${this.pick(TITLES)}`,
            `${p.name}: acme/${p.lead}#${200 + Math.floor(this.r() * 50)} checks failing: build`,
            `inbox: 0 items (${p.name})`,
          ]),
        );
        changed = true;
      }
    }

    // leads keep their lock fresh while up, as the real ones do
    for (const lead of this.leadsUp.keys())
      writeFileSync(this.file("code", lead, ".lead.lock"), JSON.stringify({ pid: this.pid, heartbeat: now }));
    if (runs)
      atomic(
        this.file(".current.json"),
        this.running.map((x) => ({ name: x.name, account: x.account, cwd: this.file("code"), startedAt: now, pid: this.pid })),
      );
    if (state)
      atomic(this.file("state.json"), {
        attempts: {},
        nextAccount: 0,
        slackCursor: 0,
        seen: [],
        prs: Object.fromEntries(
          [...this.prs].map(([key, p]) => [
            key,
            {
              url: p.url,
              host: "github",
              repo: "acme/x",
              number: 1,
              branch: p.branch,
              mainRepo: "acme/x",
              repoPath: "",
              seen: "",
              fixes: 0,
              draft: p.draft,
            },
          ]),
        ),
        pending: Object.fromEntries(
          [...this.pending].map(([id, p]) => [
            id,
            { client: p.client, title: p.title, details: "", permalink: "", from: "Dana", createAfter: p.createAfter },
          ]),
        ),
      });
    return changed || state || runs;
  }

  /** Lays out the scratch home: config, the folders the daemon reads, a heartbeat. */
  init(): void {
    for (const d of ["reports", "runs", ...PROJECTS.flatMap((p) => [join("leads", p.lead), join("code", p.lead)])])
      mkdirSync(this.file(d), { recursive: true });
    writeFileSync(this.file("overhand.config.json"), JSON.stringify(config(this.home), null, 2));
    this.heartbeat();
  }

  /** The daemon's heartbeat, so the dashboard shows it as up. */
  heartbeat(): void {
    writeFileSync(this.file(".heartbeat"), String(Date.now()));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Measuring.

/** CPU seconds and resident memory of a process, from ps (macOS and Linux). */
function psStat(pid: number): { cpuS: number; rssMb: number } | null {
  const r = Bun.spawnSync(["ps", "-o", "rss=,time=", "-p", String(pid)]);
  const [rss, time] = r.stdout.toString().trim().split(/\s+/);
  if (r.exitCode !== 0 || !rss || !time) return null;
  // [[dd-]hh:]mm:ss[.ss]
  const [days, clock] = time.includes("-") ? time.split("-") : ["0", time];
  const cpuS = (clock ?? "").split(":").reduce((s, part) => s * 60 + Number(part), 0) + Number(days) * 86400;
  return { cpuS, rssMb: Number(rss) / 1024 };
}

/** Renderer + GPU CPU seconds so far, from the browser's own process list. */
async function tabCpuS(browserCdp: CDPSession): Promise<number> {
  const { processInfo } = await browserCdp.send("SystemInfo.getProcessInfo");
  return processInfo.filter((p) => p.type === "renderer" || p.type === "GPU").reduce((s, p) => s + p.cpuTime, 0);
}

async function pageMetrics(cdp: CDPSession): Promise<{ heapMb: number; nodes: number; listeners: number }> {
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const m = (name: string) => metrics.find((x) => x.name === name)?.value ?? 0;
  return { heapMb: m("JSHeapUsedSize") / 2 ** 20, nodes: m("Nodes"), listeners: m("JSEventListeners") };
}

/** The log as a page of small line charts, one per measure. */
export function chart(samples: Sample[], checks: Check[], title: string): string {
  const series: [keyof Sample, string][] = [
    ["heapMb", "Tab JS heap (MB, after GC)"],
    ["nodes", "Tab DOM nodes"],
    ["listeners", "Tab event listeners"],
    ["tabCpu", "Tab CPU, renderer + GPU (% of a core)"],
    ["netKbMin", "Tab network (KB/min)"],
    ["daemonRssMb", "Daemon RSS (MB)"],
    ["daemonCpu", "Daemon CPU (% of a core)"],
    ["lines", "Activity log lines today"],
  ];
  const W = 560;
  const H = 120;
  const end = Math.max(1, ...samples.map((s) => s.t));
  const plot = ([key, label]: [keyof Sample, string]): string => {
    const ys = samples.map((s) => Number(s[key]));
    const max = Math.max(1e-9, ...ys);
    const x = (t: number) => ((t / end) * W).toFixed(1);
    const y = (v: number) => (H - (v / max) * (H - 8) - 4).toFixed(1);
    const idle = samples
      .filter((s) => s.idle)
      .map((s) => `<rect x="${x(s.t)}" y="0" width="3" height="${H}" class="idle"/>`)
      .join("");
    const line = samples.map((s) => `${x(s.t)},${y(Number(s[key]))}`).join(" ");
    const last = ys.at(-1) ?? 0;
    return `<figure><figcaption>${label}<b>${r1(last)}</b><span>max ${r1(max)}</span></figcaption><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${idle}<polyline points="${line}"/></svg></figure>`;
  };
  const rows = checks.map((c) => `<li class="${c.ok ? "ok" : "bad"}">${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}</li>`).join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Soak</title>
<style>:root{--bg:#fff;--fg:#1d1d1f;--mute:#6e6e73;--line:#2563eb;--idle:#0000000d;--ok:#15803d;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececf0;--mute:#9a9aa2;--line:#60a5fa;--idle:#ffffff10;--ok:#4ade80;--bad:#f87171}}
body{background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif;margin:24px 16px;max-width:1200px}
h1{font-size:18px;margin:0 0 4px}p{color:var(--mute);margin:0 0 16px}ul{padding:0;list-style:none;margin:0 0 20px}.ok{color:var(--ok)}.bad{color:var(--bad)}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr));gap:16px}figure{margin:0}
figcaption{display:flex;gap:8px;font-size:13px;margin-bottom:4px}figcaption b{margin-left:auto}figcaption span{color:var(--mute)}
svg{width:100%;height:120px;border-bottom:1px solid var(--mute)}polyline{fill:none;stroke:var(--line);stroke-width:1.5;vector-effect:non-scaling-stroke}.idle{fill:var(--idle)}</style>
<h1>${title}</h1><p>${samples.length} samples over ${r1(end / 60)} min; shaded = idle intervals.</p><ul>${rows}</ul><main>${series.map(plot).join("")}</main>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The run.

interface Options {
  seconds: number;
  /** Virtual days played over the run. */
  days: number;
  everyS: number;
  warmupS: number;
  out: string;
  port: number;
  build: boolean;
}

function options(argv: string[]): Options {
  const arg = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const hours = arg("--hours");
  const seconds = hours ? Number(hours) * 3600 : Number(arg("--minutes") ?? 20) * 60;
  if (!(seconds > 0)) throw new Error("--hours or --minutes must be a positive number");
  const long = seconds >= 3 * 3600;
  const port = Number(arg("--port") ?? 4396);
  if (port === 4317) throw new Error("4317 is the owner's daemon; the soak runs its own");
  return {
    seconds,
    // a long run lives a day at a day's pace; a short one squeezes two and a half days in, so the log outgrows a real day
    days: long ? seconds / 86400 : 2.5,
    everyS: Number(arg("--every") ?? (long ? 300 : 30)),
    // a short run's first working day fills the day ribbon; the growth that counts comes after
    warmupS: long ? 3600 : seconds / 4,
    out: resolve(arg("--out") ?? join(ROOT, "release", "out", "soak")),
    port,
    build: !argv.includes("--no-build"),
  };
}

/** Whether anything listens on the port. */
async function listening(port: number): Promise<boolean> {
  try {
    const s = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {} } });
    s.end();
    return true;
  } catch {
    return false;
  }
}

/** How long the dashboard may stay lively after a change before an interval counts as idle (the scene's LIVE_MS). */
const SETTLE_MS = 60_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Opens the command bar and runs `line` (the soak's stand-in for someone using the dashboard). */
async function command(page: Page, line: string): Promise<void> {
  await page.keyboard.press("Control+k");
  await page.waitForSelector("[cmdk-input]", { timeout: 5000 });
  await page.keyboard.type(line);
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  for (let i = 0; i < 3 && (await page.$("[role=dialog]")); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
}

async function main(): Promise<void> {
  const o = options(process.argv.slice(2));
  setPriority(Math.min(19, Math.max(10, getPriority()))); // the daemon and the browser inherit it
  if (await listening(o.port)) throw new Error(`port ${o.port} is in use; pass --port`);
  if (
    o.build &&
    Bun.spawnSync(["bun", "run", "--filter", "web", "build"], { cwd: ROOT, stdout: "ignore", stderr: "inherit" }).exitCode !== 0
  )
    throw new Error("the web build failed");
  rmSync(o.out, { recursive: true, force: true });
  mkdirSync(o.out, { recursive: true });
  const home = mkdtempSync(join(tmpdir(), "overhand-soak-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  // gh and claude answer "no" at once: no network, no real accounts, no owner's PRs on the soak's dashboard
  for (const tool of ["gh", "claude", "codex"]) writeFileSync(join(bin, tool), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const day = new Day(home, process.pid);
  day.init();

  // the daemon runs under a watchdog shell: if the soak dies without cleaning up, the daemon goes with it
  const daemon = Bun.spawn(
    [
      "sh",
      "-c",
      '"$SOAK_BUN" run.ts ui >>"$SOAK_LOG" 2>&1 & d=$!; echo $d; trap \'kill $d 2>/dev/null; exit 0\' TERM INT; while kill -0 "$SOAK_PARENT" 2>/dev/null && kill -0 $d 2>/dev/null; do sleep 2; done; kill $d 2>/dev/null',
    ],
    {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "inherit",
      env: {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        HOME: home,
        OVERHAND_HOME: home,
        OVERHAND_PORT: String(o.port),
        SOAK_BUN: process.execPath,
        SOAK_LOG: join(o.out, "daemon.log"),
        SOAK_PARENT: String(process.pid),
      },
    },
  );
  const reader = daemon.stdout.getReader();
  const first = new TextDecoder().decode((await reader.read()).value).trim();
  reader.releaseLock();
  const daemonPid = Number(first.split("\n")[0]);
  if (!daemonPid) throw new Error(`the daemon didn't start: ${first}`);

  let browser: Browser | null = null;
  let stopping = false;
  const cleanup = async () => {
    if (stopping) return;
    stopping = true;
    await browser?.close().catch(() => {});
    daemon.kill("SIGTERM");
    await Promise.race([daemon.exited, sleep(5000)]);
    try {
      process.kill(daemonPid, "SIGKILL");
    } catch {} // already gone
    rmSync(home, { recursive: true, force: true });
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.on(sig, () => {
      console.error(`\nsoak: ${sig}, cleaning up`);
      void cleanup().then(() => process.exit(130));
    });
  // whatever happens below, the run ends on time (plus a margin for the last sample) and takes its daemon and browser down
  const deadline = setTimeout(
    () => {
      console.error("soak: past its deadline, stopping");
      void cleanup().then(() => process.exit(2));
    },
    (o.seconds + 300) * 1000,
  );

  let failed = false;
  try {
    for (let i = 0; i < 60 && !(await listening(o.port)); i++) await sleep(500);
    if (!(await listening(o.port))) throw new Error(`the daemon never listened on ${o.port}; see ${join(o.out, "daemon.log")}`);

    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ args: ["--mute-audio"] });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // test browsers never talk: speechSynthesis uses the OS voice even headless, so a replayed brief speaks aloud
    await ctx.addInitScript(() => {
      try {
        Object.defineProperty(window, "speechSynthesis", {
          value: {
            speak() {},
            cancel() {},
            getVoices: () => [],
            pause() {},
            resume() {},
            speaking: false,
            pending: false,
            paused: false,
            onvoiceschanged: null,
            addEventListener() {},
            removeEventListener() {},
          },
        });
      } catch {}
    });
    // skip the boot sequence; the tab opens like a returning visitor's
    await ctx.addInitScript(() => {
      try {
        sessionStorage.setItem("overhand-booted", "1");
      } catch {}
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let crashed = false;
    page.on("crash", () => {
      crashed = true;
    });
    const cdp = await ctx.newCDPSession(page);
    const browserCdp = await browser.newBrowserCDPSession();
    await cdp.send("Performance.enable");
    // count bytes without keeping bodies: the browser would otherwise hold them for DevTools and grow by itself
    await cdp.send("Network.enable", { maxTotalBufferSize: 0, maxResourceBufferSize: 0 });
    let bytes = 0;
    cdp.on("Network.dataReceived", (e) => {
      bytes += e.encodedDataLength || e.dataLength;
    });
    await page.goto(`http://127.0.0.1:${o.port}/`, { waitUntil: "load" });
    await page.waitForSelector(".hud-pane", { timeout: 30_000 });

    const csv = join(o.out, "samples.csv");
    const jsonl = join(o.out, "samples.jsonl");
    const keys: (keyof Sample)[] = ["t", "idle", "heapMb", "nodes", "listeners", "tabCpu", "netKbMin", "daemonRssMb", "daemonCpu", "lines"];
    writeFileSync(csv, `${keys.join(",")}\n`);
    writeFileSync(jsonl, "");
    const samples: Sample[] = [];
    const title = `Overhand soak, ${o.seconds >= 3600 ? `${r1(o.seconds / 3600)} h` : `${r1(o.seconds / 60)} min`}, started ${new Date().toISOString().slice(0, 16)}`;

    const t0 = Date.now();
    const vminMs = (o.seconds * 1000) / (o.days * 1440);
    const startMin = 6 * 60; // the day starts before work, so warm-up sees the morning arrive
    let min = startMin;
    let lastChange = t0; // the last time anything changed or was clicked
    let lastBeat = 0;
    let lastCpu = { tab: await tabCpuS(browserCdp), daemon: psStat(daemonPid)?.cpuS ?? 0, at: Date.now(), bytes: 0 };
    let nextSample = t0 + o.everyS * 1000;
    // the user: a theme switch every sixth of the run, a look at what needs them every tenth (only in working hours)
    const actions = [
      ...Array.from({ length: 5 }, (_, i) => ({
        at: t0 + ((i + 1) / 6) * o.seconds * 1000,
        line: `theme ${THEMES[(i + 1) % THEMES.length]}`,
      })),
      ...Array.from({ length: 9 }, (_, i) => ({ at: t0 + ((i + 1) / 10) * o.seconds * 1000 + 7000, line: "alerts" })),
    ].sort((a, b) => a.at - b.at);
    let actionFails = 0;

    while (Date.now() - t0 < o.seconds * 1000) {
      if (crashed) throw new Error("the tab crashed");
      const now = Date.now();
      // the virtual clock follows real time, so a slow tick never stretches the run
      const target = startMin + Math.floor((now - t0) / vminMs);
      while (min < target) {
        min++;
        if (day.tick(min, now)) lastChange = now;
      }
      if (now - lastBeat > 5000) {
        day.heartbeat();
        lastBeat = now;
      }
      const inWork = min % 1440 >= (WORK[0] ?? 0) && min % 1440 < (WORK[1] ?? 1440);
      const due = actions[0];
      if (due && now >= due.at) {
        actions.shift();
        if (inWork) {
          lastChange = now;
          await command(page, due.line).catch(() => {
            actionFails++;
          });
        }
      }
      if (now >= nextSample) {
        nextSample += o.everyS * 1000;
        const pm = await pageMetrics(cdp);
        const cpu = { tab: await tabCpuS(browserCdp), daemon: psStat(daemonPid), at: Date.now(), bytes };
        if (!cpu.daemon) throw new Error("the daemon died; see daemon.log");
        const dt = (cpu.at - lastCpu.at) / 1000;
        const s: Sample = {
          t: Math.round((cpu.at - t0) / 1000),
          // idle: nothing changed in the interval or the minute before it (the scene stays live that long, LIVE_MS)
          idle: lastChange <= lastCpu.at - SETTLE_MS,
          heapMb: pm.heapMb,
          nodes: pm.nodes,
          listeners: pm.listeners,
          tabCpu: ((cpu.tab - lastCpu.tab) / dt) * 100,
          netKbMin: (cpu.bytes - lastCpu.bytes) / 1024 / (dt / 60),
          daemonRssMb: cpu.daemon.rssMb,
          daemonCpu: ((cpu.daemon.cpuS - lastCpu.daemon) / dt) * 100,
          lines: day.lines,
        };
        lastCpu = { tab: cpu.tab, daemon: cpu.daemon.cpuS, at: cpu.at, bytes };
        samples.push(s);
        appendFileSync(csv, `${keys.map((k) => (typeof s[k] === "number" ? r1(Number(s[k])) : String(s[k]))).join(",")}\n`);
        appendFileSync(jsonl, `${JSON.stringify(s)}\n`);
        writeFileSync(join(o.out, "chart.html"), chart(samples, verdict(samples, o.warmupS), title));
        console.log(
          `  ${r1(s.t / 60)} min${s.idle ? " idle" : ""}: heap ${r1(s.heapMb)} MB, ${s.nodes} nodes, ${s.listeners} listeners, tab ${r1(s.tabCpu)}%, ${r1(s.netKbMin)} KB/min; daemon ${r1(s.daemonRssMb)} MB, ${r1(s.daemonCpu)}%; ${s.lines} lines`,
        );
      }
      await sleep(Math.max(20, Math.min(vminMs, 1000)));
    }

    const checks = verdict(samples, o.warmupS);
    if (errors.length) checks.push({ name: "page errors", ok: false, detail: `${errors.length}: ${errors.slice(0, 3).join(" | ")}` });
    if (actionFails) console.log(`  (${actionFails} of the user's clicks didn't land; not a budget)`);
    writeFileSync(join(o.out, "chart.html"), chart(samples, checks, title));
    writeFileSync(join(o.out, "verdict.json"), JSON.stringify({ budget: BUDGET, warmupS: o.warmupS, checks }, null, 1));
    console.log(`\n${checks.map((c) => `  ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`).join("\n")}\n  ${join(o.out, "chart.html")}`);
    failed = checks.some((c) => !c.ok);
  } catch (e) {
    console.error(`soak: ${e instanceof Error ? e.message : String(e)}`);
    failed = true;
  } finally {
    clearTimeout(deadline);
    await cleanup();
  }
  process.exit(failed ? 1 : 0);
}

if (import.meta.main) await main();
