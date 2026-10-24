import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveOnTailnet, tailscale } from "../src/phone";

const dir = mkdtempSync(join(tmpdir(), "overhand-ts-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const STATUS = { BackendState: "Running", Self: { DNSName: "mac.tail1.ts.net." } };
/** A stand-in tailscale CLI: answers status and serve status from files, and records what `serve` was asked to do. */
function fake(serve: object): string {
  writeFileSync(join(dir, "status.json"), JSON.stringify(STATUS));
  writeFileSync(join(dir, "serve.json"), JSON.stringify(serve));
  const bin = join(dir, "tailscale");
  writeFileSync(
    bin,
    [
      "#!/bin/sh",
      `if [ "$1" = status ]; then cat "${dir}/status.json"; exit 0; fi`,
      `if [ "$2" = status ]; then cat "${dir}/serve.json"; exit 0; fi`,
      `echo "$@" > "${dir}/ran"`,
      // what a real serve leaves behind: the dashboard on the port it was given
      `printf '{"TCP":{"8443":{"HTTPS":true}},"Web":{"mac.tail1.ts.net:8443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:4664"}}}}}' > "${dir}/serve.json"`,
    ].join("\n"),
  );
  chmodSync(bin, 0o755);
  return bin;
}

test("no tailscale, and tailscale not running, say so", async () => {
  expect(await tailscale(4664, null)).toMatchObject({ installed: false, command: "" });
  const bin = fake({});
  writeFileSync(join(dir, "status.json"), JSON.stringify({ BackendState: "Stopped" }));
  expect(await tailscale(4664, bin)).toMatchObject({ installed: true, running: false });
});

test("an existing serve of the dashboard is found, with Funnel flagged", async () => {
  const bin = fake({
    TCP: { "443": { HTTPS: true } },
    Web: { "mac.tail1.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4664" } } } },
    AllowFunnel: { "mac.tail1.ts.net:443": true },
  });
  expect(await tailscale(4664, bin)).toMatchObject({ host: "mac.tail1.ts.net", served: "https://mac.tail1.ts.net", funnel: true });
  const r = await serveOnTailnet(4664, bin);
  expect(r.ok).toBe(true);
});

test("set up serves on a free port, never over something already served, and never Funnel", async () => {
  const bin = fake({
    TCP: { "443": { HTTPS: true } },
    Web: { "mac.tail1.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4100" } } } },
  });
  const before = await tailscale(4664, bin);
  expect(before.served).toBe("");
  expect(before.command).toBe("tailscale serve --bg --https=8443 http://127.0.0.1:4664");
  const r = await serveOnTailnet(4664, bin);
  expect(r).toMatchObject({ ok: true, ts: { served: "https://mac.tail1.ts.net:8443", funnel: false } });
  expect(readFileSync(join(dir, "ran"), "utf8").trim()).toBe("serve --bg --https=8443 http://127.0.0.1:4664");
});
