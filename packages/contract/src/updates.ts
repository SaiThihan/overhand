/**
 * Team status updates: channels (a Slack, Teams or Discord incoming webhook each), when they're due, and the summary
 * scoped to a channel and written in each platform's format. Pure; the daemon posts them (packages/core/src/updates.ts).
 */
import { z } from "zod";
import { fill, type Span, type Summary, type SummaryItem, spendOf } from "./summary";

/** Where a status update goes: an incoming webhook URL of one of these. Email isn't offered: Overhand has no mail setup. */
export const UPDATE_KINDS = ["slack", "teams", "discord"] as const;
export type UpdateKind = (typeof UPDATE_KINDS)[number];
/** `daily` at an hour, `eod` at 18:00, `weekly` on a weekday at an hour, `manual` only from the dashboard. */
export const UPDATE_WHENS = ["daily", "eod", "weekly", "manual"] as const;
export type UpdateWhen = (typeof UPDATE_WHENS)[number];

/** A status update channel as config stores it. Its webhook URL lives in the secret store as `updateSecret(id)`. */
export const UpdateChannelSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes"),
  name: z.string().min(1),
  kind: z.enum(UPDATE_KINDS),
  /** Projects (client names) whose work it reports; nothing from any other project is posted. */
  projects: z.array(z.string()).min(1),
  /** `plain`, or a theme id to speak in that theme's voice. */
  voice: z.string().default("plain"),
  include: z
    .object({
      shipped: z.boolean().default(true),
      review: z.boolean().default(true),
      blocked: z.boolean().default(true),
      next: z.boolean().default(true),
      /** Off until chosen: a client channel shouldn't see what the work cost. */
      spend: z.boolean().default(false),
    })
    .prefault({}),
  schedule: z
    .object({
      when: z.enum(UPDATE_WHENS).default("daily"),
      /** Local hour for `daily` and `weekly`. */
      hour: z.number().int().min(0).max(23).default(9),
      /** `weekly`: 0 Sunday … 6 Saturday. */
      weekday: z.number().int().min(0).max(6).default(5),
    })
    .prefault({}),
});
export type UpdateChannel = z.infer<typeof UpdateChannelSchema>;

/** The secret store item holding a channel's webhook URL. */
export const updateSecret = (id: string): string => `status-update-${id}`;

/** How each channel's last send went, for Health. `error` never holds the webhook URL. */
export const UpdateStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(UPDATE_KINDS),
  /** When it last posted (or tried to); 0 for never. */
  sentAt: z.number(),
  error: z.string(),
  /** The projects it carries (a work report can be sent only there). Empty for older daemons. */
  projects: z.array(z.string()).default([]),
});
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;

/** `GET /api/updates/preview?id=…`: the channel's update as it would go out now. */
export const UpdatePreviewSchema = z.object({ markdown: z.string() });

/** The words an update is written in: a theme's `words` has all of them. */
export interface UpdateWords {
  upTitle: string;
  upSpanNight: string;
  upSpanDay: string;
  upSpanToday: string;
  upSpanWeek: string;
  upShipped: string;
  upReview: string;
  upBlocked: string;
  upNext: string;
  upSpend: string;
  upQuiet: string;
  upMore: string;
  upFoot: string;
  /** A merged onboarding guide's line; `{link}` is the file on the code host. */
  upGuide: string;
}

const HOUR = 3_600_000;
/** End of day, for `eod`. */
const EOD_HOUR = 18;

/** The span a channel's update covers. */
export const spanOf = (when: UpdateWhen): Span => (when === "eod" ? "today" : when === "weekly" ? "week" : "day");

/** The latest scheduled time at or before `now`, or null for `manual`. */
export function lastSlot(s: UpdateChannel["schedule"], now: number): number | null {
  if (s.when === "manual") return null;
  const d = new Date(now);
  const hour = s.when === "eod" ? EOD_HOUR : s.hour;
  const back = s.when === "weekly" ? (d.getDay() - s.weekday + 7) % 7 : 0;
  let slot = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, hour).getTime();
  if (slot > now) slot = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back - (s.when === "weekly" ? 7 : 1), hour).getTime();
  return slot;
}

/**
 * Whether a channel's update is due: a slot passed since the last send, within 12 hours (a Mac asleep at 9 still sends
 * when it wakes that morning, not a stale one at night).
 */
export function isDue(s: UpdateChannel["schedule"], now: number, lastAt: number): boolean {
  const slot = lastSlot(s, now);
  return slot !== null && lastAt < slot && now - slot < 12 * HOUR;
}

/** A summary cut down to a channel: its projects only, the sections it includes, spend only when it asks for it. */
export function scopeSummary(s: Summary, projects: readonly string[], include: UpdateChannel["include"]): Summary {
  const mine = (xs: SummaryItem[], on: boolean) => (on ? xs.filter((x) => projects.includes(x.project)) : []);
  return {
    ...s,
    shipped: mine(s.shipped, include.shipped),
    opened: mine(s.opened, include.shipped),
    review: mine(s.review, include.review),
    blocked: mine(s.blocked, include.blocked),
    next: mine(s.next, include.next),
    spend: include.spend ? Object.fromEntries(Object.entries(s.spend).filter(([p]) => projects.includes(p))) : {},
    guides: s.guides.filter((g) => projects.includes(g.project) && g.url),
  };
}

/** Items listed per section before "and N more". */
const SHOWN = 8;

type Section = { head: string; items: SummaryItem[] };

/** The update's parts in order, before any platform's syntax. */
function parts(s: Summary, w: UpdateWords, projects: readonly string[]) {
  const span = { night: w.upSpanNight, day: w.upSpanDay, today: w.upSpanToday, week: w.upSpanWeek }[s.span];
  const sections: Section[] = [
    { head: w.upShipped, items: s.shipped },
    { head: w.upReview, items: s.review },
    { head: w.upBlocked, items: s.blocked },
    { head: w.upNext, items: s.next },
  ].filter((x) => x.items.length);
  const cost = spendOf(s);
  const spend = Object.keys(s.spend).length ? fill(w.upSpend, { cost: `$${cost.toFixed(2)}` }) : "";
  // each merged guide is one line, its link kept apart so each platform can write it as a link
  const guides = s.guides.map((g) => {
    const [before = "", after = ""] = w.upGuide.split("{link}");
    return { before, url: g.url, after };
  });
  return { title: fill(w.upTitle, { projects: projects.join(", "), span }), sections, spend, guides };
}

const more = (items: SummaryItem[], w: UpdateWords) => (items.length > SHOWN ? fill(w.upMore, { n: items.length - SHOWN }) : "");

/** Markdown-escapes text people wrote (ticket titles), so a bracket can't forge a link. */
const mdText = (t: string) => t.replace(/([\\[\]*_`<>])/g, "\\$1");
const mdLine = (x: SummaryItem) => `${x.url ? `[${x.key}](${x.url})` : x.key}${x.title ? ` ${mdText(x.title)}` : ""}`;

/** Options every format takes: whether the "Sent by Overhand" line shows (outward.aiAttribution). */
export interface FormatOptions {
  attribution: boolean;
}

/** True when there's nothing to say: no items and no spend. Scheduled sends skip these; a quiet team stays quiet. */
export const isQuiet = (s: Summary): boolean =>
  !s.shipped.length && !s.review.length && !s.blocked.length && !s.next.length && !Object.keys(s.spend).length && !s.guides.length;

/** The update as Markdown, for "Copy as Markdown". */
export function toMarkdown(s: Summary, w: UpdateWords, projects: readonly string[], o: FormatOptions): string {
  const p = parts(s, w, projects);
  const out = [`**${mdText(p.title)}**`, ""];
  if (!p.sections.length && !p.spend && !p.guides.length) out.push(w.upQuiet, "");
  for (const sec of p.sections) {
    out.push(`**${sec.head}**`, ...sec.items.slice(0, SHOWN).map((x) => `- ${mdLine(x)}`));
    const m = more(sec.items, w);
    if (m) out.push(`- ${m}`);
    out.push("");
  }
  for (const g of p.guides) out.push(`${mdText(g.before)}${g.url}${mdText(g.after)}`, "");
  if (p.spend) out.push(p.spend, "");
  if (o.attribution) out.push(`_${w.upFoot}_`);
  return out.join("\n").trim();
}

/** Slack's mrkdwn: `&`, `<` and `>` escaped, links as `<url|text>`. */
const slackText = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slackLine = (x: SummaryItem) =>
  `• ${x.url ? `<${x.url}|${slackText(x.key)}>` : slackText(x.key)}${x.title ? ` ${slackText(x.title)}` : ""}`;

/**
 * A Slack incoming webhook payload: Block Kit (a header, one mrkdwn section per part, a context footer) with `text` as
 * the notification and fallback. Slack: docs.slack.dev/messaging/sending-messages-using-incoming-webhooks.
 */
export function toSlack(s: Summary, w: UpdateWords, projects: readonly string[], o: FormatOptions): Record<string, unknown> {
  const p = parts(s, w, projects);
  const blocks: Record<string, unknown>[] = [{ type: "header", text: { type: "plain_text", text: p.title.slice(0, 150) } }];
  if (!p.sections.length && !p.spend && !p.guides.length)
    blocks.push({ type: "section", text: { type: "mrkdwn", text: slackText(w.upQuiet) } });
  for (const sec of p.sections) {
    const m = more(sec.items, w);
    const lines = [`*${slackText(sec.head)}*`, ...sec.items.slice(0, SHOWN).map(slackLine), ...(m ? [`• ${slackText(m)}`] : [])];
    blocks.push({ type: "section", text: { type: "mrkdwn", text: lines.join("\n").slice(0, 3000) } });
  }
  for (const g of p.guides)
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `${slackText(g.before)}<${g.url}>${slackText(g.after)}` } });
  if (p.spend) blocks.push({ type: "section", text: { type: "mrkdwn", text: slackText(p.spend) } });
  if (o.attribution) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: slackText(w.upFoot) }] });
  const counts = p.sections.map((x) => `${x.head}: ${x.items.length}`).join(" · ");
  return { text: slackText([p.title, counts].filter(Boolean).join(" · ")), blocks };
}

/** Adaptive Cards' markdown has no backslash escapes: brackets that could forge a link become parentheses instead. */
const teamsText = (t: string) => t.replace(/\[/g, "(").replace(/\]/g, ")");
const teamsLine = (x: SummaryItem) =>
  `${x.url ? `[${teamsText(x.key)}](${x.url})` : teamsText(x.key)}${x.title ? ` ${teamsText(x.title)}` : ""}`;

/**
 * A Microsoft Teams payload: an Adaptive Card (1.4) in a `message` envelope, which a Teams Workflows webhook ("Send
 * webhook alerts to a channel") posts as-is. Office 365 connector MessageCards are being retired, so none are sent.
 * Teams: learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook.
 */
export function toTeams(s: Summary, w: UpdateWords, projects: readonly string[], o: FormatOptions): Record<string, unknown> {
  const p = parts(s, w, projects);
  const text = (t: string, extra: Record<string, unknown> = {}) => ({ type: "TextBlock", text: t, wrap: true, ...extra });
  const body: Record<string, unknown>[] = [text(teamsText(p.title), { size: "Large", weight: "Bolder" })];
  if (!p.sections.length && !p.spend && !p.guides.length) body.push(text(teamsText(w.upQuiet)));
  for (const sec of p.sections) {
    body.push(text(teamsText(sec.head), { weight: "Bolder", spacing: "Medium" }));
    for (const x of sec.items.slice(0, SHOWN)) body.push(text(`• ${teamsLine(x)}`, { spacing: "None" }));
    const m = more(sec.items, w);
    if (m) body.push(text(`• ${teamsText(m)}`, { spacing: "None", isSubtle: true }));
  }
  for (const g of p.guides) body.push(text(`${teamsText(g.before)}${g.url}${teamsText(g.after)}`, { spacing: "Medium" }));
  if (p.spend) body.push(text(teamsText(p.spend), { spacing: "Medium" }));
  if (o.attribution) body.push(text(teamsText(w.upFoot), { size: "Small", isSubtle: true, spacing: "Medium" }));
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", body },
      },
    ],
  };
}

/**
 * A Discord execute-webhook payload: one embed, a field per part (values up to 1024 characters), and no mentions, so a
 * ticket title can't ping anyone. Discord: docs.discord.com/developers/resources/webhook.
 */
export function toDiscord(s: Summary, w: UpdateWords, projects: readonly string[], o: FormatOptions): Record<string, unknown> {
  const p = parts(s, w, projects);
  const fields = p.sections.map((sec) => {
    const m = more(sec.items, w);
    const value = [...sec.items.slice(0, SHOWN).map((x) => `• ${mdLine(x)}`), ...(m ? [`• ${m}`] : [])].join("\n");
    return { name: sec.head.slice(0, 256), value: value.slice(0, 1024) };
  });
  for (const g of p.guides) fields.push({ name: "​", value: `${g.before}${g.url}${g.after}`.slice(0, 1024) });
  if (p.spend) fields.push({ name: "​", value: p.spend });
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: p.title.slice(0, 256),
        color: 0x8fb4ff,
        ...(fields.length ? { fields } : { description: w.upQuiet }),
        ...(o.attribution ? { footer: { text: w.upFoot } } : {}),
      },
    ],
  };
}

/** The payload for a channel's platform. */
export function payloadFor(
  kind: UpdateKind,
  s: Summary,
  w: UpdateWords,
  projects: readonly string[],
  o: FormatOptions,
): Record<string, unknown> {
  return kind === "slack" ? toSlack(s, w, projects, o) : kind === "teams" ? toTeams(s, w, projects, o) : toDiscord(s, w, projects, o);
}

/** An error message safe to show: any URL in it (a webhook's is a secret) becomes "[link hidden]". */
export const redactUrls = (msg: string): string => msg.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[link hidden]").slice(0, 300);
