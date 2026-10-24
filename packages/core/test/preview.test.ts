import { expect, test } from "bun:test";
import { pickPreview } from "../src/preview";

test("a PR's preview comes from its preview deployment, then a preview commit status, never production", () => {
  // Vercel / Cloudflare / Render: a deployment per environment; production is skipped, the first successful preview wins
  expect(
    pickPreview(
      [
        { environment: "Production", statuses: [{ state: "success", environment_url: "https://shop.com" }] },
        {
          environment: "Preview",
          statuses: [
            { state: "in_progress", environment_url: "" },
            { state: "success", environment_url: "https://shop-git-agent-pot-41.vercel.app" },
          ],
        },
      ],
      [],
    ),
  ).toBe("https://shop-git-agent-pot-41.vercel.app");
  // Netlify: no deployment, a commit status whose target is the deploy preview
  expect(
    pickPreview(
      [],
      [
        { state: "success", context: "ci/test", target_url: "https://ci.example.com/run/1" },
        { state: "success", context: "netlify/shop/deploy-preview", target_url: "https://deploy-preview-41--shop.netlify.app" },
      ],
    ),
  ).toBe("https://deploy-preview-41--shop.netlify.app");
  // still building, failed, or only production: nothing yet
  expect(pickPreview([{ environment: "Preview", statuses: [{ state: "pending" }] }], [])).toBe("");
  expect(pickPreview([], [{ state: "failure", context: "netlify/shop/deploy-preview", target_url: "https://x.netlify.app" }])).toBe("");
  expect(pickPreview([{ environment: "production", statuses: [{ state: "success", target_url: "https://shop.com" }] }], [])).toBe("");
});
