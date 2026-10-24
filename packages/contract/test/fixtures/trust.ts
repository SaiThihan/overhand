/**
 * The demo's trust signals: BOOK-88's fix round "updated a stale fixture" by dropping two assertions and skipping the
 * test that failed, and the guard blocked two things in the night. The findings are what the daemon's detector reports
 * for this diff (packages/core/test/corners.test.ts checks they stay in step).
 */
import type { Corner, GuardBlock } from "@overhand/contract";

/** BOOK-88's test file after its fix round. */
export const BOOK88_TEST_DIFF = [
  "diff --git a/api/slots.test.ts b/api/slots.test.ts",
  "--- a/api/slots.test.ts",
  "+++ b/api/slots.test.ts",
  '@@ -12,12 +12,10 @@ describe("getSlots", () => {',
  '   test("reads the slots once a minute", async () => {',
  '     await getSlots("dr-lee");',
  '     await getSlots("dr-lee");',
  "-    expect(db.slots.find).toHaveBeenCalledTimes(1);",
  "-    expect(queries()).toBe(1);",
  "   });",
  " ",
  '-  test("expires after 60 seconds", async () => {',
  '+  test.skip("expires after 60 seconds", async () => {',
  "     clock.advance(61_000);",
  '     await getSlots("dr-lee");',
  "     expect(db.slots.find).toHaveBeenCalledTimes(2);",
  "   });",
];

const file = "api/slots.test.ts";
/** What the detector finds in it: a skipped test (look before merging) and two assertions gone (worth a glance). */
export const BOOK88_CORNERS: Corner[] = [
  { kind: "test-skipped", severity: "block", file, line: 17, sign: "+", text: 'test.skip("expires after 60 seconds", async () => {' },
  { kind: "assertions-removed", severity: "warn", file, line: 15, sign: "-", text: "expect(db.slots.find).toHaveBeenCalledTimes(1);" },
  { kind: "assertions-removed", severity: "warn", file, line: 16, sign: "-", text: "expect(queries()).toBe(1);" },
];

/** The night's guardrail log, by clock time. */
export const GUARD_BLOCKS: (Omit<GuardBlock, "at"> & { hm: string })[] = [
  {
    hm: "03:12",
    project: "Company website",
    run: "WEB-31",
    tool: "Bash",
    action: "git push origin main",
    rule: "push only the agent's own feature branch",
  },
  {
    hm: "04:44",
    project: "Mobile app",
    run: "APP-12",
    tool: "Read",
    action: "/Users/sam/Code/mobile-app/.env.production",
    rule: "no access to production env files",
  },
];
