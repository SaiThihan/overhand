import { expect, test } from "bun:test";
import { branchWords, LEAD_TEMPLATES, LEAD_WORK, leadWork, type Ticket, titleWords, workName } from "../src/index";

const pr = (number: number, review: string, checks: string, client = "Shop") => ({
  client,
  repo: "shop",
  number,
  title: `PR ${number}`,
  url: `u${number}`,
  draft: false,
  review,
  checks,
  updated: "",
});
const advisory = (client: string, pkg: string, fix: string) => ({
  client,
  repo: client.toLowerCase(),
  number: 1,
  package: pkg,
  ecosystem: "npm",
  severity: "high",
  summary: "bad",
  fix,
  url: `a-${pkg}`,
});
const ticket = (key: string, title: string, labels: string[] = []): Ticket => ({ key, title, status: "", priority: "", labels, url: key });

test("every kind of work has a template, and every template a goal", () => {
  expect(Object.keys(LEAD_TEMPLATES).sort()).toEqual([...LEAD_WORK].sort());
  for (const k of LEAD_WORK) expect(LEAD_TEMPLATES[k].goal.length).toBeGreaterThan(20);
});

test("leadWork sorts a project's evidence into the kind of lead that handles it, and only that project's", () => {
  const items = leadWork(
    "Shop",
    {
      ci: [
        { client: "Shop", repo: "shop", branch: "main", state: "fail", failing: ["test"], url: "c1" },
        { client: "Shop", repo: "shop", branch: "main", state: "pass", failing: [], url: "c2" },
        { client: "Cafe", repo: "cafe", branch: "main", state: "fail", failing: ["test"], url: "c3" },
      ],
      myPrs: [pr(4, "CHANGES_REQUESTED", "FAILURE"), pr(5, "", "FAILURE"), pr(6, "", "SUCCESS"), pr(7, "CHANGES_REQUESTED", "", "Cafe")],
      sentry: [{ client: "Shop", id: "SHOP-1A", title: "boom", count: 1, users: 1, isNew: true, level: "error", url: "s" }],
      deploys: [{ client: "Shop", project: "web", state: "ERROR", target: "production", url: "d", created: 0 }],
      advisories: [advisory("Shop", "axios", "1.12.0"), advisory("Shop", "cookie", ""), advisory("Cafe", "lodash", "4.17.21")],
    },
    [ticket("SHOP-1", "Armed", ["agent"]), ticket("SHOP-2", "Not armed")],
    "agent",
  );
  const refs = (k: string) => items.filter((i) => i.kind === k).map((i) => i.ref);
  expect(refs("reviews")).toEqual(["shop#4"]);
  // a PR with changes requested is review work, even with red checks; red builds, checks and deploys are CI's
  expect(refs("ci")).toEqual(["shop main", "shop#5", "web"]);
  expect(refs("errors")).toEqual(["SHOP-1A"]);
  expect(refs("backlog")).toEqual(["SHOP-1"]);
  // each open advisory is its own piece of dependency work, named by package and repo; another project's stay there
  expect(refs("deps")).toEqual(["axios in shop", "cookie in shop"]);
  const briefs = items.filter((i) => i.kind === "deps").map((i) => i.brief);
  expect(briefs[0]).toContain("fixed in 1.12.0");
  expect(briefs[1]).toContain("no fixed version yet");
  // Sentry not connected: the reason string, not a list, means no error work (the UI asks to connect it)
  expect(leadWork("Shop", { ci: [], myPrs: [], sentry: "not connected" }, [], "agent")).toEqual([]);
});

test("leadWork: patch and minor updates are dependency work and a major never is; untested files and TODO notes are each their own", () => {
  const up = (pkg: string, update: "patch" | "minor" | "major", client = "Shop") => ({
    client,
    repo: "shop",
    manager: "npm",
    package: pkg,
    current: "1.0.0",
    next: "1.0.1",
    update,
  });
  const file = (path: string, n: number, client = "Shop") => ({ client, repo: "shop", path, n });
  const items = leadWork(
    "Shop",
    {
      ci: [],
      myPrs: [],
      sentry: [],
      outdated: [up("zod", "patch"), up("vite", "minor"), up("next", "major"), up("left-pad", "patch", "Cafe")],
      untested: [file("src/cart.ts", 9), file("src/x.ts", 1, "Cafe")],
      todos: [file("src/a.ts", 3)],
    },
    [],
    "agent",
  );
  const refs = (k: string) => items.filter((i) => i.kind === k).map((i) => i.ref);
  expect(refs("current")).toEqual(["zod in shop", "vite in shop"]);
  expect(refs("untested")).toEqual(["shop/src/cart.ts"]);
  expect(refs("todos")).toEqual(["shop/src/a.ts"]);
  expect(items.map((i) => i.brief)).toEqual([
    "patch update in shop: zod 1.0.0 → 1.0.1 (npm)",
    "minor update in shop: vite 1.0.0 → 1.0.1 (npm)",
    "No test names shop/src/cart.ts, changed in 9 commits in the last 30 days",
    "3 TODO, FIXME or HACK notes in shop/src/a.ts",
  ]);
});

test("branchWords reads a branch as words, and nothing for a default or generated one", () => {
  expect(branchWords("feat/pricing-fix")).toBe("Pricing fix");
  expect(branchWords("fix/home-page_hero")).toBe("Home page hero");
  expect(branchWords("main")).toBe("");
  expect(branchWords("worktree-agent-a1b2c3d4")).toBe("");
  // never a vendor in a name
  expect(branchWords("claude/onboarding-copy")).toBe("Onboarding copy");
  expect(branchWords("codex/ci")).toBe("CI");
  // at most four words
  expect(branchWords("feat/one-two-three-four-five-six")).toBe("One two three four");
});

test("workName: a rename wins, then the person's own name, then the branch, then the ticket, then the fallback", () => {
  const tickets = [ticket("SHOP-142", "Gift card balance"), ticket("SHOP-150", "Show when an order will be ready to pick up")];
  expect(workName({ renamed: "Night shift", own: "my session", branch: "feat/x-y", tickets, fallback: "f" })).toBe("Night shift");
  expect(workName({ own: "my session", branch: "feat/x-y", tickets, fallback: "f" })).toBe("my session");
  expect(workName({ branch: "feat/shop-142-gift-card", tickets, fallback: "f" })).toBe("Gift card");
  expect(workName({ branch: "SHOP-142", tickets, fallback: "f" })).toBe("Gift card balance");
  // a long title is a sentence, not a name: the key is what people say
  expect(workName({ branch: "shop-150", tickets, fallback: "f" })).toBe("SHOP-150");
  expect(workName({ branch: "main", tickets, fallback: "Online shop" })).toBe("Online shop");
});

test("workName: past the person's own words, the project's own words for the work, before any job or place name", () => {
  const vocab = ["", "fix(cart): keep the cart when a session expires", "Second commit"];
  // a generated branch names nothing: its PR title or own commit does, read like a branch
  expect(workName({ branch: "worktree-agent-a1b2c3d4", tickets: [], vocab, fallback: "detached" })).toBe("Keep cart session expires");
  // the person's own words still come first
  expect(workName({ branch: "feat/pricing-fix", tickets: [], vocab, fallback: "f" })).toBe("Pricing fix");
  expect(workName({ own: "my session", branch: "x1y2z3w4", tickets: [], vocab, fallback: "f" })).toBe("my session");
  // nothing usable in them: the fallback
  expect(workName({ branch: "main", tickets: [], vocab: ["chore: a1b2c3d4e5"], fallback: "Online shop" })).toBe("Online shop");
  expect(titleWords("feat(site)!: Claude adds the pricing page")).toBe("Adds pricing page");
});
