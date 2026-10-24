/**
 * One summary of the night, day or week: what agents shipped, what waits for review, what's blocked and what's next. The
 * social card draws it and team status updates post it. Pure, shared by the daemon and the dashboard.
 */
import { z } from "zod";

/** The stretch of time a summary covers: since 18:00 yesterday, the last 24 hours, since midnight, the last 7 days. */
export const SPANS = ["night", "day", "today", "week"] as const;
export const SpanSchema = z.enum(SPANS);
export type Span = z.infer<typeof SpanSchema>;

/** One ticket or PR in a summary. `title` and `url` are empty when unknown. */
export const SummaryItemSchema = z.object({
  project: z.string(),
  key: z.string(),
  title: z.string().default(""),
  url: z.string().default(""),
});
export type SummaryItem = z.infer<typeof SummaryItemSchema>;

/** `GET /api/summary?span=…`: what the agents did in a span, across every project. */
export const SummarySchema = z.object({
  span: SpanSchema,
  from: z.number(),
  to: z.number(),
  /** PRs that merged in the span. */
  shipped: z.array(SummaryItemSchema),
  /** PRs agents opened in the span. */
  opened: z.array(SummaryItemSchema),
  /** Agent PRs open now, waiting for a person's review. */
  review: z.array(SummaryItemSchema),
  /** Tickets waiting on a person now: a question, a report, or attempts used up. */
  blocked: z.array(SummaryItemSchema),
  /** Tickets queued for an agent. */
  next: z.array(SummaryItemSchema),
  /** Estimated dollars billed in the span (pay-per-use and cloud runs), per project (runs that belong to none are left out). */
  spend: z.record(z.string(), z.number()),
  /** Onboarding guides whose PR merged in the span: `url` is the file on the code host. Empty for older daemons. */
  guides: z.array(SummaryItemSchema).default([]),
});
export type Summary = z.infer<typeof SummarySchema>;

const DAY = 86_400_000;

/** When a span starts, on the local clock. */
export function spanFrom(span: Span, now: number): number {
  const d = new Date(now);
  if (span === "day") return now - DAY;
  if (span === "week") return now - 7 * DAY;
  if (span === "today") return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 18).getTime();
}

/** Total billed in a summary. */
export const spendOf = (s: Summary): number => Object.values(s.spend).reduce((a, b) => a + b, 0);

/** Fills `{name}` placeholders. */
export const fill = (text: string, vars: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
