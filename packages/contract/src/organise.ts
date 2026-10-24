/**
 * Organising your work: groups of projects with shared rules, the lead scope per group, the proposed grouping and the
 * suggestions feed. The config's group schema is built from these, so the daemon and the dashboard agree.
 */
import { z } from "zod";
import { AutonomySchema } from "./autonomy";
import { BriefSchema } from "./decide";

/** A daily hold window for heavy jobs, "HH:MM" local; no kinds = every kind (a quiet window). */
export const HoldWindowSchema = z.object({
  from: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
  to: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
  kinds: z.array(z.enum(["browser", "simulator", "suite", "build", "devserver"])).default([]),
});

/**
 * Rules a group sets for its member projects. Each is optional: one left out falls back to the default; a member that
 * sets its own overrides it for itself. Private words add up (the group's and the member's), never replace.
 */
export const GroupRulesSchema = z.object({
  autonomy: AutonomySchema.optional(),
  assignedAutonomy: AutonomySchema.exclude(["watch", "ship"]).optional(),
  accounts: z.array(z.string()).optional(),
  fallbackToAll: z.boolean().optional(),
  private: z.array(z.string().min(1)).optional(),
  /** Protected branches the group's leads may push to; a lead's own `pushBranches` overrides it. */
  pushBranches: z.array(z.string()).optional(),
  /** Hold windows for heavy jobs started in the group's projects, on top of the house rules' own. */
  windows: z.array(HoldWindowSchema).optional(),
});
export type GroupRules = z.infer<typeof GroupRulesSchema>;

/** How many leads a group runs: one for the whole group, one per project, or none. */
export const LEAD_SCOPES = ["group", "repo", "none"] as const;
export const LeadScopeSchema = z.enum(LEAD_SCOPES);
export type LeadScope = z.infer<typeof LeadScopeSchema>;

const Confidence = z.enum(["low", "medium", "high"]);

/** What kind of shared fact puts projects in one group. */
export const GroupSignalKindSchema = z.enum(["owner", "tracker", "slack", "folder", "name"]);
export type GroupSignalKind = z.infer<typeof GroupSignalKindSchema>;

/** One thing a group's members share, e.g. { kind: "owner", value: "acme" }. */
export const GroupSignalSchema = z.object({ kind: GroupSignalKindSchema, value: z.string() });
export type GroupSignal = z.infer<typeof GroupSignalSchema>;

/** One proposed group: who's in it, why (one line), how sure (0–1), and what every member shares (strongest first). */
export const ProposedGroupSchema = z.object({
  name: z.string(),
  members: z.array(z.string()),
  reason: z.string(),
  confidence: z.number(),
  signals: z.array(GroupSignalSchema),
});
export type ProposedGroup = z.infer<typeof ProposedGroupSchema>;

/** A project's rules: what it sets itself, and what it ends up with (its own, else its group's, else the default). */
export const MemberViewSchema = z.object({
  name: z.string(),
  dir: z.string(),
  own: GroupRulesSchema.pick({ autonomy: true, assignedAutonomy: true, accounts: true, fallbackToAll: true }),
  effective: z.object({
    autonomy: AutonomySchema,
    assignedAutonomy: AutonomySchema.exclude(["watch", "ship"]),
    accounts: z.array(z.string()),
    fallbackToAll: z.boolean(),
  }),
});

/** One group as Settings and onboarding show it, with its lead scope advice and its leads. */
export const GroupViewSchema = z.object({
  name: z.string(),
  members: z.array(MemberViewSchema),
  rules: GroupRulesSchema,
  /** The scope last applied; null = never chosen. */
  lead: LeadScopeSchema.nullable(),
  advice: z.object({ scope: LeadScopeSchema, reason: z.string(), confidence: Confidence }),
  leads: z.array(z.object({ key: z.string(), label: z.string(), project: z.string(), running: z.boolean() })),
});
export type GroupView = z.infer<typeof GroupViewSchema>;

/** `GET /api/organise`: your groups, the projects in none, and the grouping Overhand would propose from scratch. */
export const OrganiseSchema = z.object({
  groups: z.array(GroupViewSchema),
  loose: z.array(MemberViewSchema),
  proposal: z.array(ProposedGroupSchema),
});
export type Organise = z.infer<typeof OrganiseSchema>;

/** `POST /api/organise/accept`: the grouping to keep (accepted as proposed, or adjusted). */
export const AcceptGroupingSchema = z.object({
  groups: z.array(z.object({ name: z.string().min(1), members: z.array(z.string()) })),
});

/** `POST /api/organise/rules`: a group's rules; `reset` clears members' own settings of the rules given. */
export const GroupRulesInputSchema = z.object({ group: z.string().min(1), rules: GroupRulesSchema, reset: z.boolean().default(false) });

/** `POST /api/organise/move`: a project into a group ("" = out of every group). */
export const MoveProjectSchema = z.object({ project: z.string().min(1), to: z.string() });

/** `POST /api/organise/lead`: a group's lead scope; `dryRun` only says what it would do, `confirm` may stop running leads. */
export const LeadScopeInputSchema = z.object({
  group: z.string().min(1),
  scope: LeadScopeSchema,
  dryRun: z.boolean().default(false),
  confirm: z.boolean().default(false),
});

/** What applying a lead scope does (or would do, on a dry run). */
export const LeadScopeResultSchema = z.object({
  added: z.array(z.string()),
  removed: z.array(z.string()),
  /** Running leads it would stop: nothing changed; ask again with `confirm`. */
  blocked: z.array(z.string()),
  applied: z.boolean(),
});

/** `GET /api/organise/suggestions`: every open suggestion as a decision card. */
export const SuggestionsSchema = z.object({ suggestions: z.array(BriefSchema) });

/** `POST /api/organise/suggestion`: act on one suggestion. */
export const SuggestionActSchema = z.object({ id: z.string().min(1), action: z.enum(["apply", "dismiss", "preview"]) });

/** What acting on a suggestion did: the dry run's lines, or what changed. */
export const SuggestionResultSchema = z.object({ ok: z.boolean(), lines: z.array(z.string()), undo: z.string().default("") });
