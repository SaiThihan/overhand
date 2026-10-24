/**
 * Auto-grouping: which projects (or repos, during onboarding) belong together, from what they share: a GitHub owner or
 * org, a tracker (Linear team, Jira project, GitHub issues repo), a Slack workspace, a parent folder, or a name stem.
 * Pure: the caller gathers the facts (organise.ts), this proposes groups with a one-line reason and a confidence.
 */
import type { GroupSignal, GroupSignalKind, ProposedGroup } from "@overhand/contract";

/** What one project or repo shows about itself. */
export interface GroupUnit {
  name: string;
  /** Its folder relative to the code root, e.g. "acme/web". */
  dir: string;
  /** Owners of its git remotes (GitHub org or user, Bitbucket workspace). */
  owners: readonly string[];
  /** Its tracker as one key: `linear:<team>`, `jira:<site>/<project>`, `github:<owner>/<repo>`; empty = none. */
  tracker?: string;
  /** The Slack workspace it's discussed in; empty = none. */
  slack?: string;
}

type SignalKind = GroupSignalKind;
type Signal = GroupSignal;

/** How much each kind of shared fact says two projects belong together. */
const WEIGHT: Record<SignalKind, number> = { tracker: 0.95, owner: 0.9, slack: 0.8, folder: 0.65, name: 0.55 };

/** Folder and name parts too common to mean anything. */
const GENERIC = new Set([
  ...["", ".", "code", "src", "projects", "repos", "repositories", "git", "github", "dev", "work", "workspace", "sites", "apps"],
  ...["app", "web", "api", "the", "my", "site", "core", "ios", "android", "backend", "frontend", "mobile", "server", "client"],
  ...["docs", "infra", "lib", "libs", "sdk", "cli", "tools", "test", "demo", "www", "admin", "dashboard", "service", "ops"],
  // folders that sort by kind, not by who the work is for
  ...["clients", "client", "personal", "side", "oss", "forks", "archive", "experiments", "playground", "sandbox", "tmp", "old"],
]);

const lower = (s: string) => s.trim().toLowerCase();

/** The parent folder of a dir ("acme/web" → "acme"); empty when it sits right in the code root or the parent is generic. */
export function parentFolder(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  const parent = parts.length >= 2 ? lower(parts[parts.length - 2] ?? "") : "";
  return GENERIC.has(parent) ? "" : parent;
}

/** A name's leading word, when it says something ("acme-web" → "acme", "web-app" → ""). */
export function stem(name: string): string {
  const first = lower(name.split(/[^A-Za-z0-9]+/).find(Boolean) ?? "");
  return first.length >= 3 && !GENERIC.has(first) && !/^\d+$/.test(first) ? first : "";
}

/** Every fact a unit can share with another. */
export function signalsOf(u: GroupUnit): Signal[] {
  const out: Signal[] = [];
  for (const o of new Set(u.owners.map(lower).filter(Boolean))) out.push({ kind: "owner", value: o });
  if (u.tracker) out.push({ kind: "tracker", value: lower(u.tracker) });
  if (u.slack) out.push({ kind: "slack", value: lower(u.slack) });
  const folder = parentFolder(u.dir);
  if (folder) out.push({ kind: "folder", value: folder });
  const stems = new Set([u.name, ...u.owners].map(stem).filter(Boolean));
  for (const s of stems) out.push({ kind: "name", value: s });
  return out;
}

const key = (s: Signal) => `${s.kind}:${s.value}`;

/** "acme-labs" → "Acme-labs"; keeps the first spelling seen among the members. */
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What one signal says, in words, for the reason line. */
function phrase(s: Signal): string {
  if (s.kind === "owner") return `the ${s.value} org on the code host`;
  if (s.kind === "slack") return `the ${s.value} Slack workspace`;
  if (s.kind === "folder") return `the ${s.value}/ folder`;
  if (s.kind === "name") return `names starting “${s.value}”`;
  const [kind = "", rest = ""] = s.value.split(/:(.*)/);
  if (kind === "linear") return `Linear team ${rest.toUpperCase()}`;
  if (kind === "jira") return `Jira project ${rest.split("/").pop()?.toUpperCase() ?? rest}`;
  return `the issues of ${rest}`;
}

/** The units' display name for an owner or folder value: the spelling one of them uses. */
function spelled(units: readonly GroupUnit[], s: Signal): string {
  const owner = units.flatMap((u) => u.owners).find((o) => lower(o) === s.value);
  return owner ?? s.value;
}

/**
 * The proposed grouping: units joined whenever they share a fact (owner, tracker, workspace, parent folder, name stem),
 * each group named after what its members share most strongly and given a one-line reason and a confidence. A unit
 * sharing nothing stands alone. Deterministic: the same facts give the same proposal, largest groups first.
 */
export function proposeGrouping(units: readonly GroupUnit[]): ProposedGroup[] {
  const parent = units.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] ?? r;
    return r;
  };
  /** The weakest link that joined each root's group, so a chain of weak links reads as unsure. */
  const weakest = new Map<number, number>();
  const sigs = units.map(signalsOf);
  const holders = new Map<string, number[]>();
  sigs.forEach((ss, i) => {
    for (const s of ss) holders.set(key(s), [...(holders.get(key(s)) ?? []), i]);
  });
  // strongest facts first, so a group's weakest link is as strong as it can be
  const order = [...holders.entries()].sort((a, b) => WEIGHT[kindOf(b[0])] - WEIGHT[kindOf(a[0])] || a[0].localeCompare(b[0]));
  for (const [k, idx] of order) {
    if (idx.length < 2) continue;
    const w = WEIGHT[kindOf(k)];
    for (const i of idx.slice(1)) {
      const a = find(idx[0] ?? i);
      const b = find(i);
      if (a === b) continue;
      const link = Math.min(w, weakest.get(a) ?? 1, weakest.get(b) ?? 1);
      parent[b] = a;
      weakest.set(a, link);
    }
  }
  const byRoot = new Map<number, number[]>();
  units.forEach((_, i) => {
    byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), i]);
  });
  const taken = new Set<string>();
  return [...byRoot.entries()]
    .map(([root, idx]) =>
      describe(
        idx.map((i) => units[i]).filter((u): u is GroupUnit => !!u),
        weakest.get(root) ?? 0,
      ),
    )
    .sort((a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name))
    .map((g) => {
      let name = g.name;
      for (let n = 2; taken.has(lower(name)); n++) name = `${g.name} ${n}`;
      taken.add(lower(name));
      return { ...g, name };
    });
}

const KINDS: readonly SignalKind[] = ["owner", "tracker", "slack", "folder", "name"];
const kindOf = (k: string): SignalKind => KINDS.find((x) => k.startsWith(`${x}:`)) ?? "name";

/** Name, reason and confidence for one group of units. */
function describe(members: readonly GroupUnit[], link: number): ProposedGroup {
  const names = members.map((u) => u.name);
  if (members.length === 1) {
    const u = members[0];
    const owner = u?.owners[0];
    return {
      name: u?.name ?? "",
      members: names,
      reason: "Shares no org, tracker, chat or folder with anything else: it stands alone",
      confidence: 0.6,
      signals: owner ? [{ kind: "owner", value: lower(owner) }] : [],
    };
  }
  const all = members.map((u) => new Set(signalsOf(u).map(key)));
  const shared = [...(all[0] ?? [])]
    .filter((k) => all.every((s) => s.has(k)))
    .map((k): Signal => ({ kind: kindOf(k), value: k.slice(k.indexOf(":") + 1) }))
    .sort((a, b) => WEIGHT[b.kind] - WEIGHT[a.kind] || a.value.localeCompare(b.value));
  const top = shared[0];
  const named = shared.find((s) => s.kind === "owner" || s.kind === "folder" || s.kind === "name");
  const name = named ? title(spelled(members, named)) : title(members[0]?.name ?? "Group");
  // every member sharing one fact is as sure as that fact; a chain of links only as sure as its weakest, a little less
  const confidence = top ? WEIGHT[top.kind] : Math.round(link * 0.85 * 100) / 100;
  const reason = shared.length
    ? `All ${members.length} share ${shared
        .slice(0, 2)
        .map((s) => phrase({ ...s, value: s.kind === "owner" ? spelled(members, s) : s.value }))
        .join(" and ")}`
    : `Linked one to the next by shared orgs, trackers, chat or folders`;
  return { name, members: names, reason, confidence, signals: shared };
}
