/**
 * The social card's words: what a summary says once the privacy switches have had their say. Private by default: no
 * project or client names (ticket keys carry them too), no ticket titles, no repos, no money, and never code.
 */
import { type Span, type Summary, type SummaryItem, spendOf } from "@overhand/contract";
import type { Words } from "@overhand/themes";
import { fmt, money } from "./format";

/** What the person allowed on the card. Every switch starts off. */
export interface CardPrivacy {
  /** Project names and ticket keys (a key's prefix names its project). */
  projects: boolean;
  titles: boolean;
  /** owner/repo, read from PR links. */
  repos: boolean;
  money: boolean;
}

export const PRIVATE: CardPrivacy = { projects: false, titles: false, repos: false, money: false };

/** The card's text, top to bottom. */
export interface CardContent {
  span: Span;
  /** "4 PRs shipped overnight" */
  headline: string;
  /** "0 needed me · $6.20" */
  sub: string;
  /** "3 opened", "2 in review", "5 queued" */
  stats: string[];
  /** Only what the switches let through: projects, repos, shipped items. */
  details: string[];
  foot: string;
}

/** `owner/repo` from a GitHub or Bitbucket PR link, else "". */
export function repoOf(url: string): string {
  const m = url.match(/^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/(?:pull|pull-requests)\//);
  return m?.[1] ?? "";
}

/**
 * The summary with everything private taken out unless its switch is on: project names and keys, titles, links (and the
 * repos they name), spend. What's left is counts, so the card can't leak what this function removed.
 */
export function privacyFilter(s: Summary, p: CardPrivacy): Summary {
  const clean = (xs: SummaryItem[]) =>
    xs.map((x) => ({
      project: p.projects ? x.project : "",
      key: p.projects ? x.key : "",
      title: p.titles ? x.title : "",
      url: p.repos ? x.url : "",
    }));
  return {
    ...s,
    shipped: clean(s.shipped),
    opened: clean(s.opened),
    review: clean(s.review),
    blocked: clean(s.blocked),
    next: clean(s.next),
    spend: p.money ? { all: spendOf(s) } : {},
  };
}

const SPAN_WORD = { night: "cardNight", day: "cardToday", today: "cardToday", week: "cardWeek" } as const;

/** The card's text for a summary, in a theme's voice, through the privacy filter. */
export function cardContent(summary: Summary, w: Words, p: CardPrivacy): CardContent {
  const s = privacyFilter(summary, p);
  const span = w[SPAN_WORD[s.span]];
  const n = s.shipped.length;
  const headline = fmt(n === 0 ? w.cardQuiet : n === 1 ? w.cardShippedOne : w.cardShippedMany, { n, span });
  const sub = [fmt(w.cardNeeded, { n: s.blocked.length }), p.money ? fmt(w.cardBilled, { money: money(spendOf(s)) }) : ""]
    .filter(Boolean)
    .join(" · ");
  const counts: [number, string][] = [
    [s.opened.length, w.cardOpened],
    [s.review.length, w.cardReview],
    [s.next.length, w.cardNext],
  ];
  const stats = counts.filter(([k]) => k > 0).map(([k, word]) => fmt(word, { n: k }));
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  const worked = [...s.shipped, ...s.opened];
  const details = [
    uniq(worked.map((x) => x.project)).join(", "),
    uniq(worked.map((x) => repoOf(x.url))).join(", "),
    ...s.shipped
      .slice(0, 3)
      .map((x) => [x.key, x.title].filter(Boolean).join(" "))
      .filter(Boolean),
  ].filter(Boolean);
  return { span: s.span, headline, sub, stats, details, foot: w.cardMade };
}

/** The card as text: the image's alt text and "Copy as Markdown". */
export function cardMarkdown(c: CardContent): string {
  return [`**${c.headline}**`, c.sub, c.stats.join(" · "), ...c.details.map((d) => `- ${d}`), `_${c.foot}_`].filter(Boolean).join("\n\n");
}
