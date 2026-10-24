/**
 * Overhand's plans in words: the one source for the site's pricing page (site/build.ts), the relay's pages
 * (app.overhand.dev "/" and /relay/billing) and the hosted app's signed-out view. Only what's built today is listed.
 * Amounts are never written here: they come from Paddle's catalog, through the relay's /relay/prices.
 */
import { CYCLES, type Cycle, PLANS, type Plan } from "./relay";

/** Every plan on the pricing page, in order: Free and Business are never sold through Paddle. */
export const PLAN_KEYS = ["free", ...PLANS, "business"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

type Copy = { readonly name: string; readonly promise: string; readonly includes: readonly string[] };
type Paid = Copy & { readonly per: { readonly [C in Cycle]: string } };
/** Free and Business have no catalog price, so their price reads as words: `price` beside `note`. */
type Unpriced = Copy & { readonly price: string; readonly note: string };

/** Each plan: its name, one line of what it's for, and what's included. */
export const PLAN_COPY: { readonly free: Unpriced; readonly business: Unpriced } & { readonly [P in Plan]: Paid } = {
  free: {
    name: "Free",
    promise: "Everything on your own computer, forever.",
    includes: [
      "Everything on your machine: every agent and model, and cleanup",
      "Your phone over your own Tailscale",
      "Push through your own ntfy topic",
    ],
    price: "€0",
    note: "forever",
  },
  pro: {
    name: "Pro",
    promise: "The Overhand on your computer, from anywhere.",
    includes: [
      "Overhand from any device, without setup: it connects straight to your computer",
      "Push to your phone, sent by your own computer",
    ],
    per: { month: " / month", year: " / year" },
  },
  team: {
    name: "Team",
    promise: "Pro for every seat, and your team's agents side by side.",
    includes: [
      "Everything in Pro, for each seat",
      "From 2 seats; add or remove seats any time, prorated",
      "Each other's agents in one view: project owners and backups, invites and roles",
    ],
    per: { month: " per seat / month", year: " per seat / year" },
  },
  business: {
    name: "Business",
    promise: "Overhand on your own terms.",
    includes: ["Your own relay, invoicing and direct support, on request"],
    price: "Ask",
    note: "",
  },
};

/** Who sells, and how tax works: under every list of plans with prices. */
export const PLAN_TAX =
  "EU prices include VAT; US sales tax is added at checkout. Paddle is the merchant of record and handles payment, tax and invoices.";

/** The catalog as /relay/prices returns it: a price per plan and cycle, either missing when Paddle has none. */
export type PriceTable = { readonly [P in Plan]?: { readonly [C in Cycle]?: { amount: number; currency: string } } };

/** A price in its currency, from minor units: 900 EUR is €9, 1250 is €12.50. */
export const priceText = (p: { amount: number; currency: string }): string =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: p.currency, minimumFractionDigits: p.amount % 100 ? 2 : 0 }).format(
    p.amount / 100,
  );

/**
 * What a year saves over twelve months, from the catalog's own prices: in months of the monthly price and as an
 * amount. Null when either price is missing, they differ in currency, or the year saves nothing.
 */
export const yearSaving = (plan: Plan, table: PriceTable | null | undefined): { months: number; amount: string } | null => {
  const m = table?.[plan]?.month;
  const y = table?.[plan]?.year;
  if (!m || !y || m.currency !== y.currency || y.amount >= 12 * m.amount) return null;
  const saved = 12 * m.amount - y.amount;
  return { months: saved / m.amount, amount: priceText({ amount: saved, currency: m.currency }) };
};

/** One paid plan's prices as read, per cycle in order ("€9 / month", "€90 / year"); none when the catalog lacks them. */
export const planPrices = (plan: Plan, table: PriceTable | null | undefined): string[] =>
  CYCLES.flatMap((cy) => {
    const p = table?.[plan]?.[cy];
    return p ? [`${priceText(p)}${PLAN_COPY[plan].per[cy]}`] : [];
  });
