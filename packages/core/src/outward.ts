/**
 * The outward firewall: every text Overhand or its agents send off this machine (tracker comments and tickets, PRs and
 * commit messages, Slack drafts, status updates, the team feed) is read first. A secret, a word on your deny-list, or
 * another project's name, alias or ticket key stops it: it's held as a finding with the spans marked (Edit and post,
 * Post anyway, Dismiss), never dropped.
 */
import { join } from "node:path";
import { type Finding, type LeakHit, type LeakKind, termHits } from "@overhand/contract";
import { findingId, holdFinding } from "./assign";
import type { Config } from "./config";
import { PLACEHOLDER, SECRET_PATTERNS } from "./corners";
import { CFG, OPS } from "./env";
import { effectiveClients, firewallDest } from "./groups";
import { readJson, writeJsonAtomic } from "./state";

/** What the firewall reads from the config. */
export type FirewallConfig = Pick<Config, "clients" | "outward"> & Partial<Pick<Config, "groups">>;

/** A name, token or password set to a value: `API_TOKEN=abc123…` (not `$VAR`, not a placeholder). */
const NAMED =
  /\b[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Za-z0-9_]*=("[^"]{8,}"|'[^']{8,}'|[^\s"'$<]{8,})/gi;
/** A password in a connection URL: `postgres://app:pw@host`. */
const URL_CRED = /:\/\/[^:/\s@]+:([^@\s]{3,})@/g;

/** The secrets in `text`: the token formats corners.ts knows, named secrets and passwords in URLs. Placeholders aren't. */
export function secretHits(text: string): LeakHit[] {
  const hits: LeakHit[] = [];
  const add = (start: number, end: number) => {
    const term = text.slice(start, end);
    if (!PLACEHOLDER.test(term) && !hits.some((h) => h.start < end && start < h.end))
      hits.push({ start, end, term, why: "secret", project: "" });
  };
  for (const re of SECRET_PATTERNS) for (const m of text.matchAll(new RegExp(re.source, "g"))) add(m.index, m.index + m[0].length);
  for (const re of [NAMED, URL_CRED])
    for (const m of text.matchAll(re)) {
      const v = m[1] ?? "";
      const at = m.index + m[0].lastIndexOf(v);
      add(at, at + v.length);
    }
  return hits;
}

/**
 * Every span of `text` that may not go to `dest` (the projects it's bound for; empty when it isn't one project's):
 * secrets, your deny-list, and other projects' words. Empty when it may go.
 */
export function scanOutward(text: string, dest: readonly string[], cfg: FirewallConfig = CFG): LeakHit[] {
  // a group's private words are each member's, and its members may name each other (groups.ts)
  const groups = { groups: cfg.groups ?? [] };
  const words = termHits(text, firewallDest(groups, dest), effectiveClients({ ...groups, clients: cfg.clients }), cfg.outward.deny);
  const secrets = secretHits(text).filter((s) => !words.some((w) => w.start < s.end && s.start < w.end));
  return [...secrets, ...words].sort((a, b) => a.start - b.start);
}

/** `text` with every secret replaced by `[secret]`, and the hits moved to match: a held secret is never stored. */
export function maskSecrets(text: string, hits: readonly LeakHit[]): { text: string; hits: LeakHit[] } {
  let out = "";
  let at = 0;
  const moved: LeakHit[] = [];
  for (const h of [...hits].sort((a, b) => a.start - b.start)) {
    out += text.slice(at, h.start);
    const term = h.why === "secret" ? "[secret]" : h.term;
    moved.push({ ...h, start: out.length, end: out.length + term.length, term });
    out += term;
    at = h.end;
  }
  return { text: out + text.slice(at), hits: moved };
}

/** Something about to leave the machine. */
export interface Outbound {
  kind: LeakKind;
  /** The project it's about (its finding shows under it); "" when none. */
  project: string;
  /** The projects whose destination it is; defaults to `project`. */
  to?: readonly string[];
  /** The destination in words. */
  dest: string;
  /** The ticket it's on, if any. */
  key?: string;
  title: string;
  text: string;
  /** What sending it later needs (a ticket key, a repo, a channel id). */
  payload?: Record<string, string>;
}

/** Thrown where a caller waits on what was sent (a new ticket's key, a PR): the firewall held it instead. */
export class HeldError extends Error {
  constructor(public readonly finding: string) {
    super("held by the outward firewall: it's waiting for you in Needs you");
  }
}

/** The finding `o` is held as, secrets masked. */
function leakFinding(o: Outbound, hits: readonly LeakHit[]): Omit<Finding, "id" | "at"> {
  const m = maskSecrets(o.text, hits);
  return {
    project: o.project,
    key: o.key ?? "",
    title: o.title,
    text: m.text,
    post: "",
    from: "agent",
    leak: { kind: o.kind, dest: o.dest, hits: m.hits, payload: o.payload ?? {} },
  };
}

/** Holds `o` as a finding with its hits (secrets masked). Returns the finding's id. */
export const holdLeak = (o: Outbound, hits: readonly LeakHit[]): string => holdFinding(leakFinding(o, hits));

/**
 * Reads `o` before it leaves: true when it may go (nothing matched, or you pressed Post anyway on this very text);
 * otherwise it's held as a finding in Needs you and false. Nothing is dropped: the held text is what Edit and post
 * starts from. One you dismissed stays held without asking again.
 */
export function cleared(o: Outbound, cfg: FirewallConfig = CFG, ops = OPS): boolean {
  const hits = scanOutward(o.text, o.to ?? (o.project ? [o.project] : []), cfg);
  if (!hits.length) return true;
  const f = leakFinding(o, hits);
  if (takeAllowed(findingId(f), ops)) return true;
  holdFinding(f);
  return false;
}

// ---------- Post anyway, where the sender tries again itself (an agent's command, the team feed) ----------

const ALLOW_FILE = (ops: string) => join(ops, "outward-allow.json");

/** Lets the text held as finding `id` through once, the next time its sender tries it. */
export function allowOnce(id: string, ops = OPS): void {
  const list = readJson<string[]>(ALLOW_FILE(ops), []);
  writeJsonAtomic(ALLOW_FILE(ops), [...list.filter((k) => k !== id), id].slice(-50));
}

/** Whether finding `id` was let through once, using that up. */
function takeAllowed(id: string, ops = OPS): boolean {
  const list = readJson<string[]>(ALLOW_FILE(ops), []);
  if (!list.includes(id)) return false;
  writeJsonAtomic(
    ALLOW_FILE(ops),
    list.filter((x) => x !== id),
  );
  return true;
}
