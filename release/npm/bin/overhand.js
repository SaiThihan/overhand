#!/usr/bin/env node
// `npx overhand` / `bunx overhand`: on first run downloads this version's release package for the machine (the same file
// the curl installer gets), checks its SHA-256 against the release's SHA256SUMS, unpacks it into
// ~/.overhand/npm/<version>, then runs it with the given arguments. It downloads here rather than in a postinstall
// script because bunx skips those. OVERHAND_DOWNLOAD points at another copy of the release files.
// ~/.overhand/npm/current links to the newest version fetched; the login service runs it from there.
// ponytail: older versions stay in ~/.overhand/npm; prune if anyone asks.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const os = { darwin: "darwin", linux: "linux" }[process.platform];
const arch = { arm64: "arm64", x64: "x64" }[process.arch];
const home = join(homedir(), ".overhand");
const dir = join(home, "npm", version);
const bin = join(dir, "overhand");

/** Prints why and exits non-zero. */
function fail(message) {
  console.error(`overhand: ${message}`);
  process.exit(1);
}

/** Fetches one release file, failing with its URL when it doesn't answer 200. */
async function get(url) {
  const r = await fetch(url).catch(() => undefined);
  if (!r?.ok) fail(`download failed: ${url}${r ? ` (${r.status})` : ""}`);
  return Buffer.from(await r.arrayBuffer());
}

if (!os || !arch) fail(`there's no Overhand build for ${process.platform}/${process.arch}; it runs on macOS and Linux.`);
if (!existsSync(bin)) {
  const pkg = `overhand-${os}-${arch}.tar.gz`;
  const base = process.env.OVERHAND_DOWNLOAD ?? `https://get.overhand.dev/download/v${version}`;
  console.error(`overhand: downloading ${pkg} (v${version}), once`);
  const [tar, sums] = await Promise.all([get(`${base}/${pkg}`), get(`${base}/SHA256SUMS`)]);
  const want = sums
    .toString()
    .split("\n")
    .find((l) => l.endsWith(`  ${pkg}`))
    ?.split(" ")[0];
  if (!want || want !== createHash("sha256").update(tar).digest("hex")) fail(`checksum mismatch for ${pkg}; not installing.`);
  // unpack beside the target and rename, so a half-written folder never looks installed
  const tmp = `${dir}.${process.pid}`;
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, pkg), tar);
  const x = spawnSync("tar", ["-xzf", pkg], { cwd: tmp, stdio: "inherit" });
  rmSync(join(tmp, pkg));
  if (x.status !== 0) fail("couldn't unpack the package (is tar installed?)");
  if (existsSync(bin)) rmSync(tmp, { recursive: true });
  else renameSync(tmp, dir);
}
// the login service runs npm/current/overhand, so it moves on to the newest version any run fetched (and never back
// to an older one run by name); the daemon notices and restarts on it
const current = join(home, "npm", "current");
let at = "";
try {
  at = readlinkSync(current);
} catch {}
if (!at || version.localeCompare(at, undefined, { numeric: true }) > 0) {
  const link = `${current}.${process.pid}`;
  symlinkSync(version, link);
  renameSync(link, current); // replaces the old link in one step
}
const run = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
process.exit(run.status ?? 1);
