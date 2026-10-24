// Renders og.html to public/og.png. Needs playwright-core and Chrome; serve site/ on :4601 first.
import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--headless=new", "--mute-audio"] });
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
// test browsers never talk: speechSynthesis uses the OS voice even headless
await p.addInitScript(() => {
    try {
      Object.defineProperty(window, "speechSynthesis", { value: { speak() {}, cancel() {}, pause() {}, resume() {}, getVoices: () => [], speaking: false, pending: false, paused: false, addEventListener() {}, removeEventListener() {} }, configurable: true });
    } catch {}
  });
await p.goto("http://localhost:4601/og/og.html");
await p.waitForTimeout(4000);
await p.screenshot({ path: new URL("../public/og.png", import.meta.url).pathname });
await b.close();
