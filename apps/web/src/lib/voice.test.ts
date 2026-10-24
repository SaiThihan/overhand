import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { themes } from "@overhand/themes";
import { pickVoice, spoken } from "./voice";

test("each theme speaks in its own character: preferred voices, rate and pitch", () => {
  for (const t of themes) {
    expect(t.voice.prefer.length).toBeGreaterThan(0);
    expect(t.voice.rate).toBeGreaterThan(0.5);
    expect(t.voice.rate).toBeLessThan(1.5);
    expect(t.voice.pitch).toBeGreaterThan(0);
    expect(t.voice.pitch).toBeLessThanOrEqual(2);
  }
});

test("a theme's first available preferred voice wins, else British English, else the default", () => {
  const v = (name: string, lang: string) => ({ name, lang });
  const device = [v("Samantha", "en-US"), v("Google UK English Male", "en-GB"), v("Serena", "en-GB")];
  expect(pickVoice(device, ["Daniel", "Google UK English Male"])?.name).toBe("Google UK English Male");
  expect(pickVoice(device, ["Nobody"])?.name).toBe("Google UK English Male");
  expect(pickVoice([v("Samantha", "en-US")], ["Nobody"])).toBeNull();
  expect(pickVoice([], ["Daniel"])).toBeNull();
});

test("ticket keys are read as people say them", () => {
  expect(spoken("Queued HONEY-142, FERN-88 and BLUE-1204.")).toBe("Queued Honey 1 42, Fern 88 and Blue 12 oh 4.");
});

test("nothing needs cross-origin isolation, and no page asks for it", () => {
  const root = join(import.meta.dir, "..");
  for (const f of new Bun.Glob("**/*.{ts,tsx}").scanSync(root)) {
    if (f.endsWith(".test.ts")) continue;
    const text = readFileSync(join(root, f), "utf8");
    expect({ f, threads: /SharedArrayBuffer|crossOriginIsolated|Atomics\.wait/.test(text) }).toEqual({ f, threads: false });
    // the dashboard's bundle never carries checkout code: billing opens on the relay's own page
    expect({ f, checkout: /paddle|checkout\.js/i.test(text) }).toEqual({ f, checkout: false });
  }
  const repo = join(import.meta.dir, "../../../..");
  for (const p of ["site/wrangler.jsonc", "relay/wrangler.jsonc", "apps/web/vite.config.ts", "packages/core/src/server.ts"]) {
    expect({ p, coep: /cross-origin-(embedder|opener)-policy/i.test(readFileSync(join(repo, p), "utf8")) }).toEqual({ p, coep: false });
  }
});
