/**
 * Teams (docs/teams.md): what members' daemons, the relay's team room and the dashboard agree on. Only metadata is
 * shared: who is here, which projects each person owns, their status, questions and answers, results, hand-offs, claims
 * and comments. Every message is a strict schema (an allowlist: an unknown field fails the whole message), every text is
 * short, and text that looks like code, a diff or a secret is refused. Code, diffs, keys, tokens and transcripts have no
 * field to travel in.
 */
import { z } from "zod";

export const TEAM_ROLES = ["owner", "admin", "member"] as const;
export const TeamRoleSchema = z.enum(TEAM_ROLES);
export type TeamRole = z.infer<typeof TeamRoleSchema>;

/** How long a question waits on its project's owner before it goes to the backup as well. */
export const QUESTION_FALLBACK_MS = 30 * 60_000;
/** A claim ("I'm on it") lapses after this long without activity from the person holding it. */
export const CLAIM_IDLE_MS = 30 * 60_000;
/** Members past the plan's seats keep working this long after the plan shrinks. */
export const SEAT_GRACE_MS = 7 * 24 * 60 * 60_000;
/** An invite link's life. */
export const INVITE_MS = 7 * 24 * 60 * 60_000;
/** The most bytes one message may take on the wire; a real one is a few hundred. */
export const MAX_TEAM_MESSAGE = 2048;
/** Durable events the relay keeps per team for members who were offline, and how many a reconnect gets. */
export const TEAM_LOG_KEEP = 500;
export const CATCHUP_MAX = 200;

// ── safe text ──

/** Secret-shaped strings: provider keys, tokens, private keys, JWTs. */
const SECRET =
  /\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_\w+|AKIA[0-9A-Z]{16}|xox[abposr]-[\w-]+|eyJ[\w-]{8,}\.[\w-]{8,})|-----BEGIN /;
/** Code and diffs: fences, diff headers and hunks. */
const CODE = /```|^(diff --git |@@ -\d|\+\+\+ [ab/]|--- [ab/])/m;

/**
 * Whether text may not enter the team feed: it looks like code, a diff or a secret (including any long run of mixed
 * letters and digits, the shape of most keys and tokens).
 */
export function unsafeText(s: string): boolean {
  if (SECRET.test(s) || CODE.test(s)) return true;
  return s.split(/[\s/.:,;()"'`]+/).some((w) => w.length >= 32 && /\d/.test(w) && /[A-Za-z]/.test(w));
}

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => !unsafeText(s), "looks like code or a secret");
/** A non-empty, single-line name. */
const name = (max: number) => text(max).regex(/^[^\n]+$/);
/** Ids the daemons make (a hash or UUID). */
const Id = z.string().regex(/^[\w-]{1,64}$/);
/** A WorkOS user id (or a dev id in tests). */
export const UserIdSchema = z.string().regex(/^[\w-]{1,64}$/);
/** What an item is, for claims, viewing and comments: `kind:ref`, e.g. `q:3f9a…`, `pr:Shop#418`. */
export const ItemRefSchema = z.string().regex(/^[a-z]{1,12}:[^\s]{1,120}$/);
/** A pull request's web address: shared only when the member turned on sharing PR links. */
const PrUrl = z
  .string()
  .max(300)
  .regex(/^https:\/\/[^\s]+$/);
const TicketKey = z.string().regex(/^[A-Za-z][A-Za-z0-9]*-\d{1,12}$/);

// ── what a member's daemon sends ──

/** Per project the member works on, as their map shows it. */
export const TeamProjectStatusSchema = z
  .object({
    name: name(60),
    state: z.enum(["working", "needs", "idle", "red"]),
    agents: z.number().int().min(0).max(999),
  })
  .strict();

/** Presence: replaces the member's last one. Never logged; it lives on the member's socket and dies with it. */
export const PresenceSchema = z
  .object({
    k: z.literal("presence"),
    agents: z.number().int().min(0).max(999),
    quiet: z.boolean(),
    /** What their dashboard has open, e.g. "PR #418": a static dot for others, never a cursor. */
    viewing: z
      .object({ item: ItemRefSchema, label: name(80) })
      .strict()
      .nullable(),
    /** "I'm on it": items they claimed, so nobody handles them twice. */
    claims: z.array(z.object({ item: ItemRefSchema, label: name(80) }).strict()).max(20),
    projects: z.array(TeamProjectStatusSchema).max(24),
  })
  .strict();

export const QuestionSchema = z
  .object({
    k: z.literal("question"),
    id: Id,
    project: name(60),
    /** Which of the asker's agents asks. */
    lead: name(60),
    text: text(400).min(1),
    /** What the agent does if nobody answers ("" when it just waits). */
    fallback: text(200),
  })
  .strict();

/** An answer to a question; empty text closes it (answered on the asker's own machine). */
export const AnswerSchema = z.object({ k: z.literal("answer"), id: Id, text: text(400) }).strict();

export const ResultSchema = z
  .object({
    k: z.literal("result"),
    project: name(60),
    title: name(140),
    outcome: z.enum(["merged", "opened", "failed"]),
    pr: PrUrl.nullable(),
  })
  .strict();

/** A ticket or finding handed to a teammate's crew: lands as an "Assign an agent" item on their machine. */
export const HandoffSchema = z
  .object({
    k: z.literal("handoff"),
    id: Id,
    to: UserIdSchema,
    project: name(60),
    title: name(200),
    key: TicketKey.nullable(),
    note: text(400),
  })
  .strict();

export const CommentSchema = z
  .object({
    k: z.literal("comment"),
    id: Id,
    item: ItemRefSchema,
    text: text(400).min(1),
    /** Only these people are notified. */
    mentions: z.array(UserIdSchema).max(10),
  })
  .strict();

/** Everything a member may send. Anything else is dropped, whole. */
export const TeamSendSchema = z.discriminatedUnion("k", [
  PresenceSchema,
  QuestionSchema,
  AnswerSchema,
  ResultSchema,
  HandoffSchema,
  CommentSchema,
]);
export type TeamSend = z.infer<typeof TeamSendSchema>;
export type Presence = z.infer<typeof PresenceSchema>;
/** The kinds the relay logs for members who were offline; presence is live only. */
export const DURABLE_KINDS = ["question", "answer", "result", "handoff", "comment"] as const;

/** A message from a member, as the room fans it out: stamped with who sent it and when (never taken from the client). */
const stamped = <T extends z.ZodRawShape>(s: z.ZodObject<T>) =>
  s.extend({ by: UserIdSchema, at: z.number(), seq: z.number().int().default(0) });
export const TeamEventSchema = z.discriminatedUnion("k", [
  stamped(PresenceSchema),
  stamped(QuestionSchema),
  stamped(AnswerSchema),
  stamped(ResultSchema),
  stamped(HandoffSchema),
  stamped(CommentSchema),
]);
export type TeamEvent = z.infer<typeof TeamEventSchema>;
export type LoggedEvent = Exclude<TeamEvent, { k: "presence" }>;

/** What the room says on its own. */
export const RoomSaysSchema = z.discriminatedUnion("k", [
  /** On connect: who is online with their presence, and what was logged since the member's last sequence number. */
  z.object({
    k: z.literal("hello"),
    online: z.array(z.object({ by: UserIdSchema, at: z.number(), presence: PresenceSchema.nullable() })),
    log: z.array(TeamEventSchema),
    /** More was logged than a reconnect gets: the oldest were left out. */
    truncated: z.boolean(),
  }),
  z.object({ k: z.literal("join"), by: UserIdSchema, at: z.number() }),
  z.object({ k: z.literal("leave"), by: UserIdSchema, at: z.number() }),
  /** Membership, roles, invites or ownership changed: read the roster again. */
  z.object({ k: z.literal("roster"), at: z.number() }),
]);
export type RoomSays = z.infer<typeof RoomSaysSchema>;
export const TeamIncomingSchema = z.union([RoomSaysSchema, TeamEventSchema]);
export type TeamIncoming = z.infer<typeof TeamIncomingSchema>;

/** A member's message from the wire, or null when it isn't one they may send (too big, unknown, or unsafe). */
export function parseTeamSend(raw: string): TeamSend | null {
  if (raw.length > MAX_TEAM_MESSAGE) return null;
  try {
    const r = TeamSendSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

// ── the roster: membership, roles, ownership, seats (relay GET /relay/team) ──

export const TeamMemberSchema = z.object({
  user: UserIdSchema,
  email: z.string(),
  role: TeamRoleSchema,
  joinedAt: z.number(),
  /** Within the plan's seats (or its grace): a member past them can see the roster but not use the team. */
  seated: z.boolean(),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

export const TeamRosterSchema = z.object({
  team: z.object({ id: z.string(), name: z.string() }),
  me: UserIdSchema,
  role: TeamRoleSchema,
  /** The Team plan's seats (Paddle quantity); 0 when the plan lapsed. */
  seats: z.number().int(),
  /** Members are past the seats: when that started and when the grace ends (members past the seats stop then). */
  over: z.object({ since: z.number(), until: z.number() }).nullable(),
  members: z.array(TeamMemberSchema),
  /** Open invites; admins and the owner only (empty for members). */
  invites: z.array(z.object({ id: z.string(), email: z.string(), role: TeamRoleSchema, expiresAt: z.number() })),
  /** Who owns each shared project, and who backs them up. Projects match members' project names. */
  projects: z.array(z.object({ project: z.string(), owner: z.string().nullable(), backup: z.string().nullable() })),
});
export type TeamRoster = z.infer<typeof TeamRosterSchema>;

/** The team as the dashboard gets it (DashboardState.team): the roster plus the live feed from the daemon. */
export const TeamStateSchema = z.object({
  roster: TeamRosterSchema,
  /** The daemon holds the team socket now. */
  connected: z.boolean(),
  /** Online members' presence by user id (yours included). */
  online: z.record(z.string(), z.object({ at: z.number(), presence: PresenceSchema.nullable() })),
  /** The durable feed, oldest first, at most CATCHUP_MAX. */
  log: z.array(TeamEventSchema),
  /** Why the team isn't live (not linked, plan lapsed, past the seats), or "". */
  problem: z.string(),
  /** This member shares PR links in results. */
  sharePrs: z.boolean(),
});
export type TeamState = z.infer<typeof TeamStateSchema>;

// ── what everyone computes the same way ──

type Question = Extract<LoggedEvent, { k: "question" }>;
type Projects = TeamRoster["projects"];

/**
 * Who a question waits on: its project's owner first; after QUESTION_FALLBACK_MS (or with no owner) the backup too;
 * with neither, anyone. Pure, so every member's dashboard agrees without a server timer.
 */
export function routeQuestion(
  q: Pick<Question, "project" | "at">,
  projects: Projects,
  now: number,
): { to: string[]; stage: "owner" | "backup" | "anyone" } {
  const p = projects.find((x) => x.project === q.project);
  const owner = p?.owner ?? null;
  const backup = p?.backup ?? null;
  if (owner && (now - q.at < QUESTION_FALLBACK_MS || !backup)) return { to: [owner], stage: "owner" };
  if (backup) return { to: owner ? [owner, backup] : [backup], stage: "backup" };
  return { to: [], stage: "anyone" };
}

/** Questions in the log nobody has answered yet, oldest first. */
export function openQuestions(log: readonly TeamEvent[]): Question[] {
  const answered = new Set(log.flatMap((e) => (e.k === "answer" ? [e.id] : [])));
  return log.filter((e): e is Question => e.k === "question" && !answered.has(e.id));
}

/** One thing in the team that waits on you. */
export type TeamWait =
  | { kind: "question"; item: string; event: Question; stage: "owner" | "backup" | "anyone" }
  | { kind: "handoff"; item: string; event: Extract<LoggedEvent, { k: "handoff" }> }
  | { kind: "mention"; item: string; event: Extract<LoggedEvent, { k: "comment" }> };

/** How long a hand-off or a mention keeps waiting on you on the Team view. */
export const WAIT_MS = 24 * 60 * 60_000;

/**
 * What waits on `me`: questions routed to you that you didn't ask, hand-offs to you and mentions of you from the last
 * day. Only these are orange; everything else on the Team view is neutral.
 */
export function waitingOn(me: string, t: Pick<TeamState, "log"> & { roster: Pick<TeamRoster, "projects"> }, now: number): TeamWait[] {
  const out: TeamWait[] = [];
  for (const q of openQuestions(t.log)) {
    if (q.by === me) continue;
    const r = routeQuestion(q, t.roster.projects, now);
    if (r.to.includes(me)) out.push({ kind: "question", item: `q:${q.id}`, event: q, stage: r.stage });
  }
  for (const e of t.log) {
    if (now - e.at > WAIT_MS || e.by === me) continue;
    if (e.k === "handoff" && e.to === me) out.push({ kind: "handoff", item: `h:${e.id}`, event: e });
    if (e.k === "comment" && e.mentions.includes(me)) out.push({ kind: "mention", item: e.item, event: e });
  }
  return out;
}

/** Live claims on items by everyone online, by item: who and since when, minus any that lapsed. */
export function claimsOf(online: TeamState["online"]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [user, o] of Object.entries(online))
    for (const c of o.presence?.claims ?? []) out.set(c.item, [...(out.get(c.item) ?? []), user]);
  return out;
}

/** A name to show for a member: the part of their email before the @, capitalised. */
export const memberName = (email: string): string => {
  const n = email.split("@")[0] ?? email;
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : email;
};

/**
 * The team brief: a few plain lines about the team since `since` (the morning, or your last look): who is online, what
 * merged, what waits on you, what was handed over.
 */
export function teamBrief(t: TeamState, now: number, since = now - 24 * 60 * 60_000): string[] {
  const who = (u: string) => memberName(t.roster.members.find((m) => m.user === u)?.email ?? u);
  const online = Object.keys(t.online).filter((u) => u !== t.roster.me);
  const agents = Object.values(t.online).reduce((n, o) => n + (o.presence?.agents ?? 0), 0);
  const recent = t.log.filter((e) => e.at >= since);
  const merged = recent.filter((e) => e.k === "result" && e.outcome === "merged").length;
  const failed = recent.filter((e) => e.k === "result" && e.outcome === "failed").length;
  const waits = waitingOn(t.roster.me, t, now);
  const lines = [
    `${online.length ? `${online.map(who).join(", ")} online` : "Nobody else online"}; ${agents} ${agents === 1 ? "agent" : "agents"} working across the team.`,
  ];
  if (merged || failed) lines.push(`Since then: ${merged} merged${failed ? `, ${failed} failed` : ""}.`);
  const q = waits.filter((w) => w.kind === "question").length;
  const h = waits.filter((w) => w.kind === "handoff");
  if (q) lines.push(`${q} ${q === 1 ? "question waits" : "questions wait"} on you.`);
  for (const x of h) if (x.kind === "handoff") lines.push(`${who(x.event.by)} handed you ${x.event.title} (${x.event.project}).`);
  return lines;
}
