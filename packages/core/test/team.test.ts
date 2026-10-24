import { beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { type DashboardState, parseTeamSend, type TeamRoster, TeamSendSchema } from "@overhand/contract";
import { state as fixture } from "@overhand/contract/fixtures/state";
import { assign, loadAssignments, loadFindings } from "../src/assign";
import { levelFor } from "../src/autonomy";
import type { Client } from "../src/config";
import { OPS } from "../src/env";
import { mentionsIn, presenceOf, questionText, receive, resetTeam, resultOf, setTeamHooks } from "../src/team";

const roster: TeamRoster = {
  team: { id: "org_1", name: "Crew" },
  me: "user_me",
  role: "member",
  seats: 5,
  over: null,
  members: [
    { user: "user_me", email: "me@x.dev", role: "member", joinedAt: 2, seated: true },
    { user: "user_ana", email: "ana@x.dev", role: "owner", joinedAt: 1, seated: true },
  ],
  invites: [],
  projects: [{ project: "Shop", owner: "user_ana", backup: "user_me" }],
};

const calls: { answer: [string, string, string][]; notify: [string, string][] } = { answer: [], notify: [] };
beforeEach(() => {
  rmSync(join(OPS, "findings.json"), { force: true });
  rmSync(join(OPS, "assigned.json"), { force: true });
  resetTeam(roster);
  calls.answer.length = 0;
  calls.notify.length = 0;
  setTeamHooks({
    state: async () => state(),
    answer: (lead, text, from) => calls.answer.push([lead, text, from]),
    notify: (title, body) => calls.notify.push([title, body]),
    changed: () => {},
  });
});

const client = (name: string, prefix: string, autonomy: Client["autonomy"]): Client => ({
  name,
  dir: name.toLowerCase(),
  prefix,
  host: "github",
  tracker: { kind: "github", repo: `o/${name.toLowerCase()}` },
  aliases: [],
  accounts: [],
  fallbackToAll: true,
  autonomy,
  assignedAutonomy: "propose",
  status: { vercelSecrets: [], sentrySecrets: [] },
});

/** The web's state fixture, with one ticket agent running on Shop. */
const state = (): DashboardState =>
  fixture({
    now: 1000,
    running: [{ name: "SHOP-12", account: "a", cwd: "/Users/me/code/shop/.worktrees/SHOP-12", startedAt: 1, pid: 1 }],
    clients: [{ name: "Shop", prefix: "SHOP", host: "github", autonomy: "watch", assignedAutonomy: "propose", shipBlock: "" }],
  });

test("presence carries counts and statuses only: no paths, commands or ticket text", () => {
  const p = presenceOf(state(), { item: "pr:Shop#418", label: "PR #418" }, [{ item: "q:abc1", label: "Ana's question" }]);
  expect(p).toEqual({
    k: "presence",
    agents: 1,
    quiet: false,
    viewing: { item: "pr:Shop#418", label: "PR #418" },
    claims: [{ item: "q:abc1", label: "Ana's question" }],
    projects: [{ name: "Shop", state: "working", agents: 1 }],
  });
  expect(JSON.stringify(p)).not.toContain("/Users/");
  expect(TeamSendSchema.safeParse(p).success).toBe(true);
});

test("a question goes out as prose: code blocks and diff lines are left on the machine", () => {
  const inbox = [
    "## Question from the lead",
    "Should checkout keep the old provider? The current code:",
    "```ts",
    "const key = process.env.STRIPE_KEY",
    "```",
    "diff --git a/pay.ts b/pay.ts",
    "+ const x = 1",
    "I can keep both behind a flag.",
  ].join("\n");
  const text = questionText(inbox);
  expect(text).toBe("Should checkout keep the old provider? The current code: I can keep both behind a flag.");
  expect(
    parseTeamSend(JSON.stringify({ k: "question", id: "q-1", project: "Shop", lead: "Shop lead", text, fallback: "" })),
  ).not.toBeNull();
  // a question that is nothing but code becomes nothing
  expect(questionText("## Q\n```\nsk-ant-api03-abcdefghijklmnopqrstu\n```")).toBe("");
});

test("results name the ticket or PR title, never the agent's own words", () => {
  const s = state();
  expect(resultOf("- 09:12 ✗ SHOP-12 attempt 2: the token sk-ant-api03-abcdefghijklmnopqrstu was rejected", s, false)).toEqual({
    k: "result",
    project: "Shop",
    title: "SHOP-12",
    outcome: "failed",
    pr: null,
  });
  expect(resultOf("- 09:13 ✅ SHOP-12 → https://github.com/o/shop/pull/7", s, false)?.pr).toBeNull();
  expect(resultOf("- 09:13 ✅ SHOP-12 → https://github.com/o/shop/pull/7", s, true)?.pr).toBe("https://github.com/o/shop/pull/7");
  expect(resultOf("- 09:14 🎉 Shop#7 merged: Fix the cart total (SHOP-12)", s, false)?.title).toBe("Fix the cart total (SHOP-12)");
  expect(resultOf("- 09:15 🔧 SHOP-12 fix round", s, false)).toBeNull();
  expect(resultOf("- 09:15 ✅ OTHER-1 → x", s, false)).toBeNull();
});

test("a hand-off to you lands held as an Assign an agent item; nothing runs until you assign it, at the project's level", () => {
  receive(
    JSON.stringify({
      k: "handoff",
      id: "h-1",
      to: "user_me",
      project: "Shop",
      title: "Flaky checkout test",
      key: "SHOP-40",
      note: "Can your crew take it?",
      by: "user_ana",
      at: 5,
      seq: 1,
    }),
  );
  // a hand-off to someone else is only metadata here
  receive(
    JSON.stringify({
      k: "handoff",
      id: "h-2",
      to: "user_ana",
      project: "Shop",
      title: "Other",
      key: null,
      note: "",
      by: "user_me",
      at: 6,
      seq: 2,
    }),
  );
  // the same event again (a catch-up after reconnecting) is acted on once
  receive(
    JSON.stringify({
      k: "hello",
      online: [],
      truncated: false,
      log: [
        {
          k: "handoff",
          id: "h-1",
          to: "user_me",
          project: "Shop",
          title: "Flaky checkout test",
          key: "SHOP-40",
          note: "",
          by: "user_ana",
          at: 5,
          seq: 1,
        },
      ],
    }),
  );
  const held = loadFindings();
  expect(held).toHaveLength(1);
  expect(held[0]).toMatchObject({ project: "Shop", key: "SHOP-40", title: "Flaky checkout test", from: "team", post: "" });
  expect(held[0]?.text).toContain("Ana handed this to your crew. Can your crew take it?");
  expect(calls.notify).toHaveLength(1);
  expect(loadAssignments()).toEqual({});
  // on a watch project it runs at assignedAutonomy once assigned; where agents act on their own, a hand-off still waits
  const watch = client("Shop", "SHOP", "watch");
  const act = client("Shop", "SHOP", "act");
  const a = assign({ project: "Shop", key: "SHOP-40", title: "Flaky checkout test", by: "dashboard" }, [watch]);
  expect(levelFor(watch, Boolean(loadAssignments()[a.key]))).toBe("propose");
  expect(() => assign({ project: "Shop", key: "SHOP-41", title: "x", by: "dashboard" }, [act])).toThrow();
  expect(assign({ project: "Shop", key: "SHOP-41", title: "x", by: "dashboard", allowAct: true }, [act]).key).toBe("SHOP-41");
});

test("an answer from a teammate reaches the lead that asked, once; mentions notify only the person mentioned", () => {
  // this daemon's lead asked q-1 (tick() records what it publishes)
  resetTeam(roster, { "q-1": "shop-lead" });
  receive(
    JSON.stringify({
      k: "question",
      id: "q-1",
      project: "Shop",
      lead: "Shop lead",
      text: "Which provider?",
      fallback: "",
      by: "user_me",
      at: 1,
      seq: 1,
    }),
  );
  receive(JSON.stringify({ k: "answer", id: "q-1", text: "Keep the old one.", by: "user_ana", at: 2, seq: 2 }));
  receive(JSON.stringify({ k: "answer", id: "q-1", text: "Actually, the new one.", by: "user_ana", at: 3, seq: 3 }));
  // an answer to someone else's question isn't for any lead here
  receive(JSON.stringify({ k: "answer", id: "q-other", text: "Yes.", by: "user_ana", at: 4, seq: 4 }));
  expect(calls.answer).toEqual([["shop-lead", "Keep the old one.", "Ana"]]);
  receive(
    JSON.stringify({
      k: "comment",
      id: "c-1",
      item: "q:q-1",
      text: "@me can you check?",
      mentions: ["user_me"],
      by: "user_ana",
      at: 2,
      seq: 5,
    }),
  );
  receive(JSON.stringify({ k: "comment", id: "c-2", item: "q:q-1", text: "noted", mentions: [], by: "user_ana", at: 3, seq: 6 }));
  receive(
    JSON.stringify({
      k: "comment",
      id: "c-1",
      item: "q:q-1",
      text: "@me can you check?",
      mentions: ["user_me"],
      by: "user_ana",
      at: 2,
      seq: 5,
    }),
  );
  expect(calls.notify).toEqual([["Ana mentioned you", "@me can you check?"]]);
  expect(mentionsIn("@ana and @nobody, @ME", roster.members).sort()).toEqual(["user_ana", "user_me"]);
});

test("incoming messages outside the contract are ignored", () => {
  receive(
    JSON.stringify({
      k: "handoff",
      id: "h-9",
      to: "user_me",
      project: "Shop",
      title: "x",
      key: null,
      note: "",
      diff: "+a",
      by: "user_ana",
      at: 1,
      seq: 9,
    }),
  );
  receive("not json");
  expect(loadFindings()).toEqual([]);
});
