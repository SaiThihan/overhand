import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plainText } from "@overhand/contract";
import { webFile } from "../src/server";

test("webFile serves the built dashboard and nothing outside dist", () => {
  const dist = mkdtempSync(join(tmpdir(), "overhand-dist-"));
  expect(webFile("/", dist)).toBeNull(); // not built yet
  writeFileSync(join(dist, "index.html"), "<!doctype html>");
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "assets", "app.js"), "");
  expect(webFile("/", dist)).toBe(join(dist, "index.html"));
  expect(webFile("/assets/app.js", dist)).toBe(join(dist, "assets", "app.js"));
  expect(webFile("/assets/missing.js", dist)).toBeNull();
  expect(webFile("/api/state", dist)).toBeNull();
  expect(webFile("/../overhand.config.json", dist)).toBeNull();
  expect(webFile("/%2e%2e/overhand.config.json", dist)).toBeNull();
  expect(webFile("/%E0%A4%A", dist)).toBeNull(); // malformed encoding
});

test("plainText turns a markdown step into one readable line", () => {
  expect(plainText("Phase 2 is done: **PR #49** ([link](https://x/49)) splits `run.ts`.\n\n> note")).toBe(
    "Phase 2 is done: PR #49 (link) splits run.ts. note",
  );
});

test("sh gives up on a hung command instead of holding the work pass forever", async () => {
  const { sh } = await import("../src/env");
  const started = Date.now();
  const r = sh(["sleep", "5"], "/tmp", 300);
  expect(r.ok).toBe(false);
  expect(r.err).toBe("timed out after 0.3 s: sleep 5");
  expect(Date.now() - started).toBeLessThan(3000);
});
