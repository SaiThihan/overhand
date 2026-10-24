import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownSignInHome } from "../src/agent-home";
import { loadConfig, saveConfig } from "../src/config";
import { claudeEnv } from "../src/env";
import { allowSubscriptionTokens } from "../src/legacy-token";
import { secretsOf } from "../src/setup";

const store: Record<string, string> = { "claude-token-main": "oat", "anthropic-key-api": "sk-ant", "or-key": "sk-or" };
const asked: string[] = [];
const read = (s: string): string | null => {
  asked.push(s);
  return store[s] ?? null;
};
const example = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "overhand.config.example.json"), "utf8"));

test("an old config without providers loads unchanged and every account runs on Claude", () => {
  const dir = mkdtempSync(join(tmpdir(), "overhand-prov-"));
  writeFileSync(join(dir, "overhand.config.json"), JSON.stringify(example));
  const c = loadConfig(dir);
  expect(c.accounts).toEqual(["work-max"]);
  expect(c.providers).toEqual({});
  expect(() => saveConfig(dir, { ...example, providers: { ghost: { kind: "claude" } } })).toThrow("unknown account ghost");
  // a Claude account without a sign-in kind uses Claude Code's own sign-in
  expect(saveConfig(dir, { ...example, providers: { "work-max": { kind: "claude" } } }).providers["work-max"]).toEqual({
    kind: "claude",
    auth: "login",
  });
  const gw = saveConfig(dir, { ...example, providers: { "work-max": { kind: "gateway", baseUrl: "http://localhost:11434" } } });
  expect(gw.providers["work-max"]).toEqual({ kind: "gateway", baseUrl: "http://localhost:11434", secret: "", model: "", smallModel: "" });
});

test("account labels: lowercase words like honeycrust-dev; no dots or digits-only, which Settings' dotted paths can't hold", () => {
  const dir = mkdtempSync(join(tmpdir(), "overhand-label-"));
  const save = (accounts: string[]) => () => saveConfig(dir, { ...example, accounts, clients: [], slack: [] });
  expect(save(["main", "honeycrust-dev", "fernway-ci", "work_max", "2fa"])().accounts).toHaveLength(5);
  expect(save(["work.max"])).toThrow("lowercase letters, digits, - and _");
  expect(save(["Work"])).toThrow("lowercase letters, digits, - and _");
  expect(save(["42"])).toThrow("not only digits");
});

test("claudeEnv: an API key as ANTHROPIC_API_KEY, own sign-in sends no credential, stray backend variables never leak in", () => {
  process.env.ANTHROPIC_BASE_URL = "http://stray";
  process.env.CLAUDE_CODE_USE_BEDROCK = "1";
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "stray";
  asked.length = 0;
  try {
    const key = claudeEnv("api", { kind: "claude", auth: "key" }, read);
    expect(key.ANTHROPIC_API_KEY).toBe("sk-ant");
    expect(key.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(key.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(key.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(() => claudeEnv("none", { kind: "claude", auth: "key" }, read)).toThrow("no Anthropic API key for none");
    // own sign-in: Claude Code reads its login from the account's config folder; nothing is read or sent from here
    const own = claudeEnv("main", { kind: "claude", auth: "login" }, read);
    for (const v of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"]) expect(own[v]).toBeUndefined();
    // a subscription token is stored for "main", yet nothing ever asked for one
    expect(asked.filter((s) => s.startsWith("claude-token-"))).toEqual([]);
  } finally {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }
});

test("a stored subscription token is used only behind the local code opt-in", () => {
  allowSubscriptionTokens(true);
  try {
    expect(claudeEnv("main", { kind: "claude", auth: "login" }, read).CLAUDE_CODE_OAUTH_TOKEN).toBe("oat");
    expect(claudeEnv("api", { kind: "claude", auth: "key" }, read).ANTHROPIC_API_KEY).toBe("sk-ant"); // no token: its key
  } finally {
    allowSubscriptionTokens(false);
  }
  expect(claudeEnv("main", { kind: "claude", auth: "login" }, read).CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
});

test("claudeEnv: Bedrock and Vertex switch Claude Code to the cloud, a pinned model pins every alias", () => {
  const b = claudeEnv("aws", { kind: "bedrock", region: "eu-west-1", profile: "dev", model: "", smallModel: "" }, read);
  expect(b).toMatchObject({ CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "eu-west-1", AWS_PROFILE: "dev" });
  expect(b.ANTHROPIC_MODEL).toBeUndefined();
  expect(b.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  const v = claudeEnv("gcp", { kind: "vertex", region: "global", project: "p1", model: "claude-opus-4-8", smallModel: "h" }, read);
  expect(v).toMatchObject({
    CLAUDE_CODE_USE_VERTEX: "1",
    CLOUD_ML_REGION: "global",
    ANTHROPIC_VERTEX_PROJECT_ID: "p1",
    ANTHROPIC_MODEL: "claude-opus-4-8",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-8",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-opus-4-8",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "h",
  });
});

test("claudeEnv: a gateway gets its base URL, a bearer token (a placeholder when none is named) and its model", () => {
  const local = claudeEnv(
    "local",
    { kind: "gateway", baseUrl: "http://localhost:11434", secret: "", model: "qwen3:1.7b", smallModel: "" },
    read,
  );
  expect(local).toMatchObject({
    ANTHROPIC_BASE_URL: "http://localhost:11434",
    ANTHROPIC_AUTH_TOKEN: "overhand",
    ANTHROPIC_MODEL: "qwen3:1.7b",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "qwen3:1.7b",
  });
  const or = claudeEnv("or", { kind: "gateway", baseUrl: "https://openrouter.ai/api", secret: "or-key", model: "", smallModel: "" }, read);
  expect(or.ANTHROPIC_AUTH_TOKEN).toBe("sk-or");
  expect(or.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
  const missing = { kind: "gateway", baseUrl: "https://x.dev", secret: "nope", model: "", smallModel: "" } as const;
  expect(() => claudeEnv("or", missing, read)).toThrow("gateway token nope");
});

test("each Claude account kind needs its own thing: own sign-in a config folder, an API key its key, never a token", () => {
  const dir = mkdtempSync(join(tmpdir(), "overhand-kinds-"));
  const c = saveConfig(dir, {
    ...example,
    accounts: ["own", "api", "aws"],
    providers: { api: { kind: "claude", auth: "key" }, aws: { kind: "bedrock", region: "eu-west-1" } },
    clients: [],
    slack: [],
  });
  expect(ownSignInHome("own", c, "/h")).toBe("/h/accounts/own");
  expect(ownSignInHome("api", c, "/h")).toBe("");
  expect(ownSignInHome("aws", c, "/h")).toBe("");
  const claudeItems = (x: string[]) => x.filter((s) => s.startsWith("anthropic-key-") || s.startsWith("claude-token-"));
  expect(claudeItems(secretsOf(c))).toEqual(["anthropic-key-api"]);
  // the local code opt-in brings back the old setup: stored tokens, the old shared config folder
  allowSubscriptionTokens(true);
  try {
    expect(claudeItems(secretsOf(c))).toEqual(["claude-token-own", "anthropic-key-api"]);
    expect(ownSignInHome("own", c, "/h")).toBe("");
  } finally {
    allowSubscriptionTokens(false);
  }
});
