import { expect, test } from "bun:test";
import { plainWords as w } from "../../themes/src/words";
import { type Billing, budgetNotice, detectBilling, isBilled, splitSpend } from "../src/billing";

test("an account's billing type comes from how it signs in", () => {
  // Claude Code: its own sign-in is likely a plan, but a Console login is per use, so the config alone isn't sure; an API
  // key is paid per use; the cloud bills the cloud account
  expect(detectBilling({ runtime: "claude-code" })).toEqual({ billing: "plan", sure: false, from: "sign-in" });
  expect(detectBilling({ runtime: "claude-code", provider: { kind: "claude", auth: "login" } }).billing).toBe("plan");
  expect(detectBilling({ runtime: "claude-code", provider: { kind: "claude", auth: "key" } })).toEqual({
    billing: "pay-per-use",
    sure: true,
    from: "key",
  });
  expect(detectBilling({ runtime: "claude-code", provider: { kind: "bedrock" } })).toEqual({ billing: "cloud", sure: true, from: "cloud" });
  expect(detectBilling({ runtime: "claude-code", provider: { kind: "vertex" } }).billing).toBe("cloud");
  // a gateway on this computer costs nothing; one elsewhere is most likely paid per use, but Settings asks
  for (const baseUrl of ["http://localhost:11434", "http://127.0.0.1:4000", "http://[::1]:8080", "http://box.local:4000"])
    expect(detectBilling({ runtime: "claude-code", provider: { kind: "gateway", baseUrl } })).toEqual({
      billing: "local",
      sure: true,
      from: "local",
    });
  expect(detectBilling({ runtime: "codex", provider: { kind: "gateway", baseUrl: "https://openrouter.ai/api" } })).toEqual({
    billing: "pay-per-use",
    sure: false,
    from: "gateway",
  });
  // other CLIs: a local model is local; otherwise a suggestion only, which Settings asks about
  expect(detectBilling({ runtime: "aider", model: "ollama_chat/qwen3" }).billing).toBe("local");
  expect(detectBilling({ runtime: "opencode", model: "ollama/qwen3" }).billing).toBe("local");
  expect(detectBilling({ runtime: "codex" })).toEqual({ billing: "plan", sure: false, from: "cli" });
  expect(detectBilling({ runtime: "cursor" }).billing).toBe("plan");
  expect(detectBilling({ runtime: "gemini" })).toEqual({ billing: "pay-per-use", sure: false, from: "cli" });
  // a Claude provider left on a non-Claude CLI says nothing about it
  expect(detectBilling({ runtime: "codex", provider: { kind: "claude", auth: "key" } }).sure).toBe(false);
});

test("only pay-per-use and cloud are billed", () => {
  const billed: Billing[] = ["pay-per-use", "cloud"];
  for (const b of ["plan", "pay-per-use", "cloud", "local"] as const) expect(isBilled(b)).toBe(billed.includes(b));
});

test("billed counts only billed accounts' runs; at API prices counts every run", () => {
  const of: Record<string, Billing> = { sam: "plan", aws: "cloud", key: "pay-per-use", box: "local" };
  const runs = [
    { account: "sam", cost: 10 },
    { account: "aws", cost: 3 },
    { account: "key", cost: 1.5 },
    { account: "box", cost: 0.5 },
    { cost: 2 }, // a line with no account resolves like any account: here, the default plan
  ];
  expect(splitSpend(runs, (a) => of[a] ?? "plan")).toEqual({ billed: 4.5, apiPrice: 17 });
  expect(splitSpend([], () => "cloud")).toEqual({ billed: 0, apiPrice: 0 });
  // the billing a run recorded wins over its account's type now
  expect(
    splitSpend(
      [
        { account: "sam", cost: 2, billing: "cloud" },
        { account: "aws", cost: 3, billing: "plan" },
      ],
      (a) => of[a] ?? "plan",
    ),
  ).toEqual({
    billed: 2,
    apiPrice: 5,
  });
});

test("the budget's notice says plans carry on, or, when an account is held for billing not known yet, says that instead", () => {
  expect(budgetNotice(w, false)).toBe(
    "Pay-per-use and cloud agents wait until tomorrow. Plan accounts carry on. Raise it in Settings to go on today.",
  );
  expect(budgetNotice(w, true)).toBe(
    `Pay-per-use and cloud agents wait until tomorrow. ${w.budgetUnknown} Raise it in Settings to go on today.`,
  );
  expect(budgetNotice(w, true)).not.toContain("carry on");
});
