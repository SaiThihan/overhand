import { expect, test } from "bun:test";
import { PLAN_COPY } from "@overhand/contract";
import { plainWords } from "@overhand/themes";
import { renderToStaticMarkup } from "react-dom/server";
import { HostedPublic, HostedUpgrade } from "./Hosted";

const eur = (amount: number) => ({ amount, currency: "EUR" });

test("signed out, the hosted page shows what Overhand is, the plans with live prices, the policies and Sign in", () => {
  const html = renderToStaticMarkup(
    <HostedPublic
      w={plainWords}
      prices={{ pro: { month: eur(900), year: eur(9000) }, team: { month: eur(1200), year: eur(12000) } }}
      onSignIn={() => {}}
    />,
  );
  for (const want of [
    plainWords.hostedPublicLine,
    "Pro",
    "Team",
    "€9 / month",
    "€90 / year",
    "€12 per seat / month",
    "€120 per seat / year",
    "Sign in",
  ])
    expect(html).toContain(want);
  for (const page of ["terms", "privacy", "refund", "contact"]) expect(html).toContain(`href="https://overhand.dev/${page}"`);
  expect(html).toContain('href="https://overhand.dev"');
  expect(html.toLowerCase()).not.toContain("dashboard");
});

test("signed in without a plan: what it is, what each plan adds, how it works, the live starting price, Choose a plan", () => {
  const html = renderToStaticMarkup(
    <HostedUpgrade w={plainWords} prices={{ pro: { month: eur(400), year: eur(4000) }, team: { month: eur(800) } }} />,
  );
  for (const want of [
    plainWords.hostedNeedsPlan,
    plainWords.hostedNeedsPlanLine,
    ...PLAN_COPY.pro.includes,
    ...PLAN_COPY.team.includes,
    plainWords.hostedHow1,
    plainWords.hostedHow2,
    plainWords.hostedHow3,
    "From €4 / month",
    plainWords.hostedChoosePlan,
    plainWords.hostedSignOut,
    plainWords.hostedNeedsPlanBody,
  ])
    expect(html).toContain(want.replace(/'/g, "&#x27;"));
  expect(html.toLowerCase()).not.toContain("dashboard");
  // prices unread: no price is made up
  expect(renderToStaticMarkup(<HostedUpgrade w={plainWords} prices={null} />)).not.toContain("€");
});

test("when prices can't be read, it points at the site's pricing page", () => {
  const html = renderToStaticMarkup(<HostedPublic w={plainWords} prices={null} onSignIn={() => {}} />);
  expect(html).toContain('href="https://overhand.dev/pricing"');
  expect(html).toContain(plainWords.hostedPricesElsewhere);
});
