/**
 * Renders the social card for every theme at both sizes from the demo's data, through the real Share drawer, and saves
 * the PNGs: `bun release/cards.ts <out-dir> [--no-build]`. A visual check of the card; it needs the same Chromium as
 * `bun run shots`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { themes } from "../packages/themes/src/index";

const ROOT = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(ROOT, "release", "out", "cards"));
mkdirSync(out, { recursive: true });
if (!process.argv.includes("--no-build")) {
  const b = Bun.spawnSync(["bun", "run", "build"], { cwd: join(ROOT, "apps", "web"), stdout: "inherit", stderr: "inherit" });
  if (b.exitCode !== 0) process.exit(1);
}
const dist = join(ROOT, "apps", "web", "dist");
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname).replace(/^\/demo/, "");
    const file = normalize(join(dist, path === "" || path.endsWith("/") ? `${path}/index.html` : path));
    if (!file.startsWith(dist)) return new Response("no", { status: 403 });
    const f = Bun.file(file);
    return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
  },
});
const { chromium } = await import("playwright-core");
const browser = await chromium.launch();
try {
  for (const theme of themes) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, baseURL: `http://127.0.0.1:${server.port}` });
    await page.addInitScript((id) => localStorage.setItem("overhand-theme", id), theme.id);
    await page.goto("/demo/?demo", { waitUntil: "load" });
    await page.waitForSelector(".hud-pane", { timeout: 20_000 });
    await page.keyboard.press("Control+k");
    await page.waitForSelector("[cmdk-input]");
    await page.keyboard.type("share");
    await page.keyboard.press("Enter");
    const dialog = page.locator("[role=dialog]");
    for (const [size, label] of [
      ["wide", theme.words.shareWide],
      ["square", theme.words.shareSquare],
    ] as const) {
      await dialog.getByRole("button", { name: label, exact: true }).click();
      await dialog.getByRole("button", { name: theme.words.shareCopy, exact: true }).and(page.locator(":not([disabled])")).waitFor();
      await page.waitForTimeout(300);
      const png = await page.evaluate(
        () => document.querySelector<HTMLCanvasElement>("[role=dialog] canvas")?.toDataURL("image/png") ?? "",
      );
      writeFileSync(join(out, `card-${theme.id}-${size}.png`), Buffer.from(png.split(",")[1] ?? "", "base64"));
      console.log(`card-${theme.id}-${size}.png`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.stop(true);
}
