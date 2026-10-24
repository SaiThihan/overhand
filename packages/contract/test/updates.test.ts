import { expect, test } from "bun:test";
import {
  isDue,
  isQuiet,
  lastSlot,
  redactUrls,
  type Summary,
  scopeSummary,
  toDiscord,
  toMarkdown,
  toSlack,
  toTeams,
  type UpdateChannel,
  UpdateChannelSchema,
  type UpdateWords,
} from "../src/index";

/** Plain words, as packages/themes has them (the contract doesn't depend on themes). */
const WORDS: UpdateWords = {
  upTitle: "{projects}: {span}",
  upSpanNight: "overnight",
  upSpanDay: "the last day",
  upSpanToday: "today",
  upSpanWeek: "this week",
  upShipped: "Shipped",
  upReview: "Needs review",
  upBlocked: "Blocked",
  upNext: "Next",
  upSpend: "Spend: {cost}",
  upQuiet: "Nothing to report.",
  upMore: "and {n} more",
  upFoot: "Sent by Overhand",
  upGuide: "Onboarding guide updated: {link}",
};

const pr = (project: string, key: string, title: string, n: number) => ({
  project,
  key,
  title,
  url: `https://github.com/acme/${project.toLowerCase()}/pull/${n}`,
});

/** Two projects' day: a client channel for Web must never see Api's work. */
const DAY: Summary = {
  span: "day",
  from: 0,
  to: 1,
  shipped: [pr("Web", "WEB-1", "Fix the <cart> & totals", 4), pr("Api", "API-7", "Rate limits", 9)],
  opened: [pr("Web", "WEB-2", "Dark mode", 5)],
  review: [pr("Web", "WEB-2", "Dark mode", 5)],
  blocked: [{ project: "Api", key: "API-8", title: "Which [database]?", url: "" }],
  next: [{ project: "Web", key: "WEB-3", title: "Gift cards", url: "" }],
  spend: { Web: 4.1, Api: 2.25 },
  guides: [],
};

const channel = (over: Partial<UpdateChannel> = {}): UpdateChannel =>
  UpdateChannelSchema.parse({ id: "web-client", name: "Web client", kind: "slack", projects: ["Web"], ...over });

test("a channel sees only its projects, its sections, and no spend unless it asks", () => {
  const ch = channel();
  const s = scopeSummary(DAY, ch.projects, ch.include);
  expect(JSON.stringify(s).includes("API")).toBe(false);
  expect(s.shipped.map((x) => x.key)).toEqual(["WEB-1"]);
  expect(s.spend).toEqual({});
  const spend = scopeSummary(DAY, ch.projects, { ...ch.include, spend: true, next: false });
  expect(spend.spend).toEqual({ Web: 4.1 });
  expect(spend.next).toEqual([]);
  expect(Object.keys(scopeSummary(DAY, ["Web", "Api"], ch.include).spend)).toEqual([]);
});

test("defaults: plain voice, every section but spend, daily at 9", () => {
  const ch = channel();
  expect(ch.voice).toBe("plain");
  expect(ch.include).toEqual({ shipped: true, review: true, blocked: true, next: true, spend: false });
  expect(ch.schedule).toEqual({ when: "daily", hour: 9, weekday: 5 });
  expect(UpdateChannelSchema.safeParse({ ...ch, projects: [] }).success).toBe(false);
});

const scoped = scopeSummary(DAY, ["Web"], { shipped: true, review: true, blocked: true, next: true, spend: true });

test("Slack: Block Kit with escaped mrkdwn and <url|key> links", () => {
  const p = toSlack(scoped, WORDS, ["Web"], { attribution: true });
  expect(p).toMatchSnapshot();
  expect(JSON.stringify(p)).toContain("<https://github.com/acme/web/pull/4|WEB-1> Fix the &lt;cart&gt; &amp; totals");
});

test("Teams: an Adaptive Card in a message envelope", () => {
  const p = toTeams(scoped, WORDS, ["Web"], { attribution: false });
  expect(p).toMatchSnapshot();
  expect(p.type).toBe("message");
  expect(JSON.stringify(p)).not.toContain("Sent by Overhand");
});

test("Discord: one embed, fields per section, no mentions", () => {
  const p = toDiscord(scoped, WORDS, ["Web"], { attribution: true });
  expect(p).toMatchSnapshot();
  expect(p.allowed_mentions).toEqual({ parse: [] });
});

test("Markdown: titles can't forge links; a quiet summary says so", () => {
  const all = scopeSummary(DAY, ["Api"], { shipped: true, review: true, blocked: true, next: true, spend: false });
  expect(toMarkdown(all, WORDS, ["Api"], { attribution: false })).toMatchSnapshot();
  expect(toMarkdown(all, WORDS, ["Api"], { attribution: false })).toContain("API-8 Which \\[database\\]?");
  const quiet = scopeSummary(DAY, ["Nobody"], channel().include);
  expect(toMarkdown(quiet, WORDS, ["Nobody"], { attribution: false })).toBe("**Nobody: the last day**\n\nNothing to report.");
});

test("long sections end with 'and N more'", () => {
  const many = { ...scoped, shipped: Array.from({ length: 11 }, (_, i) => pr("Web", `WEB-${i + 10}`, "", i)) };
  expect(toMarkdown(many, WORDS, ["Web"], { attribution: false })).toContain("- and 3 more");
});

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime(); // Oct 2026: the 20th is a Tuesday

test("schedules: daily at its hour, end of day at 18:00, weekly on its day, manual never", () => {
  const daily = channel().schedule;
  expect(lastSlot(daily, at(20, 10))).toBe(at(20, 9));
  expect(lastSlot(daily, at(20, 8))).toBe(at(19, 9));
  expect(lastSlot({ ...daily, when: "eod" }, at(20, 19))).toBe(at(20, 18));
  const friday = { when: "weekly" as const, hour: 16, weekday: 5 };
  expect(lastSlot(friday, at(20, 10))).toBe(at(16, 16));
  expect(lastSlot(friday, at(23, 16, 30))).toBe(at(23, 16));
  expect(lastSlot({ ...daily, when: "manual" }, at(20, 10))).toBeNull();
});

test("due once per slot, and a stale slot (asleep for 12 hours) is skipped", () => {
  const daily = channel().schedule;
  expect(isDue(daily, at(20, 9, 1), at(19, 9, 1))).toBe(true);
  expect(isDue(daily, at(20, 9, 2), at(20, 9, 1))).toBe(false);
  expect(isDue(daily, at(20, 8), at(19, 9, 1))).toBe(false);
  expect(isDue(daily, at(20, 22), at(19, 9, 1))).toBe(false);
  expect(isDue({ ...daily, when: "manual" }, at(20, 9, 1), 0)).toBe(false);
});

test("errors never carry a URL", () => {
  expect(redactUrls("fetch failed: https://hooks.slack.com/services/T0/B0/xyz timed out")).toBe("fetch failed: [link hidden] timed out");
});

test("a merged onboarding guide is one line, only in channels scoped to its project, on every platform", () => {
  const link = "https://github.com/acme/web/blob/HEAD/ONBOARDING.md";
  const s: Summary = {
    ...DAY,
    shipped: [],
    opened: [],
    review: [],
    blocked: [],
    next: [],
    spend: {},
    guides: [
      { project: "Web", key: "WEB-ONBOARDING-X", title: "ONBOARDING.md", url: link },
      { project: "Api", key: "API-ONBOARDING-Y", title: "ONBOARDING.md", url: "https://github.com/acme/api/blob/HEAD/ONBOARDING.md" },
    ],
  };
  const web = channel();
  const scoped = scopeSummary(s, web.projects, web.include);
  expect(scoped.guides.map((g) => g.project)).toEqual(["Web"]);
  expect(isQuiet(scoped)).toBe(false);
  const md = toMarkdown(scoped, WORDS, web.projects, { attribution: false });
  expect(md).toContain(`Onboarding guide updated: ${link}`);
  expect(md).not.toContain("acme/api");
  expect(md).not.toContain(WORDS.upQuiet);
  const o = { attribution: false };
  expect(JSON.stringify(toSlack(scoped, WORDS, web.projects, o))).toContain(`Onboarding guide updated: <${link}>`);
  expect(JSON.stringify(toTeams(scoped, WORDS, web.projects, o))).toContain(`Onboarding guide updated: ${link}`);
  expect(JSON.stringify(toDiscord(scoped, WORDS, web.projects, o))).toContain(`Onboarding guide updated: ${link}`);
  // a channel for another project hears nothing about it
  const other = scopeSummary(s, ["Shop"], web.include);
  expect(other.guides).toEqual([]);
  expect(isQuiet(other)).toBe(true);
});
