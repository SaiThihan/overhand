import { expect, test } from "bun:test";
import type { Run } from "../src/ship";
import { repoAdvisories } from "../src/status/dependabot";

const gh =
  (r: { ok: boolean; out?: string; err?: string }): Run =>
  async () => ({ ok: r.ok, out: r.out ?? "", err: r.err ?? "" });

test("a repo's open Dependabot alerts become advisories, each with the smallest version that fixes it", async () => {
  const out = [
    { number: 3, url: "u3", package: "axios", ecosystem: "npm", severity: "high", summary: "SSRF", fix: "1.12.0" },
    { number: 4, url: "u4", package: "cookie", ecosystem: "npm", severity: "low", summary: "names", fix: "" },
  ]
    .map((x) => JSON.stringify(x))
    .join("\n");
  const got = await repoAdvisories("Shop", "acme/shop", gh({ ok: true, out }));
  expect(got.map((a) => [a.client, a.repo, a.package, a.fix])).toEqual([
    ["Shop", "shop", "axios", "1.12.0"],
    ["Shop", "shop", "cookie", ""],
  ]);
});

test("alerts switched off or out of reach are no work there, not an error; anything else is said", async () => {
  // GitHub answers 404 when Dependabot alerts are off, 403 when the signed-in account can't read them
  expect(await repoAdvisories("Shop", "acme/shop", gh({ ok: false, err: "gh: Not Found (HTTP 404)" }))).toEqual([]);
  expect(await repoAdvisories("Shop", "acme/shop", gh({ ok: false, err: "gh: Resource not accessible (HTTP 403)" }))).toEqual([]);
  await expect(repoAdvisories("Shop", "acme/shop", gh({ ok: false, err: "error connecting to api.github.com" }))).rejects.toThrow(
    "acme/shop",
  );
});
