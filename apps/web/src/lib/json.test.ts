import { expect, test } from "bun:test";
import { getAt, type JsonObject, setAt, stringAt } from "./json";

test("stringAt falls back to the default when the config leaves a field out (an account with no runtimes or providers entry)", () => {
  const cfg: JsonObject = { accounts: ["sam"], runtimes: { fernway: { kind: "codex", model: "" } }, providers: {} };
  expect(stringAt(cfg, "runtimes.sam.kind", "claude-code")).toBe("claude-code");
  expect(stringAt(cfg, "providers.sam.kind", "claude")).toBe("claude");
  expect(stringAt(cfg, "runtimes.fernway.kind", "claude-code")).toBe("codex");
  expect(stringAt(cfg, "runtimes.fernway.model")).toBe("");
});

test("getAt and setAt walk dotted paths through objects and arrays without touching the original", () => {
  const cfg: JsonObject = { clients: [{ name: "Honeycrust", tracker: { kind: "linear" } }] };
  expect(getAt(cfg, "clients.0.tracker.kind")).toBe("linear");
  expect(getAt(cfg, "clients.3.name")).toBeUndefined();
  const next = setAt(cfg, "clients.0.tracker.kind", "jira");
  expect(getAt(next, "clients.0.tracker.kind")).toBe("jira");
  expect(getAt(cfg, "clients.0.tracker.kind")).toBe("linear");
  expect(setAt(cfg, "godmode.0.key", "x")).toEqual({ ...cfg, godmode: [{ key: "x" }] });
  expect(setAt({ a: [1, 2, 3] }, "a.1", undefined)).toEqual({ a: [1, 3] });
  const withJenkins: JsonObject = { jenkins: { url: "" }, b: 1 };
  expect(setAt(withJenkins, "jenkins", undefined)).toEqual({ b: 1 });
});
