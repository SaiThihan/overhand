import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INSTALLER = join(import.meta.dir, "install.sh");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];

/** A scratch release: per platform, a package whose `overhand` prints that platform, plus SHA256SUMS. */
function fakeRelease(): string {
  const dir = mkdtempSync(join(tmpdir(), "overhand-release-"));
  const sums = PLATFORMS.map((p) => {
    const pkg = join(dir, p);
    mkdirSync(join(pkg, "web"), { recursive: true });
    writeFileSync(join(pkg, "web", "index.html"), "");
    writeFileSync(join(pkg, "overhand"), `#!/bin/sh\necho ${p}\n`);
    chmodSync(join(pkg, "overhand"), 0o755);
    const tar = `overhand-${p}.tar.gz`;
    Bun.spawnSync(["tar", "-czf", join(dir, tar), "-C", pkg, "overhand", "web"]);
    return `${new Bun.CryptoHasher("sha256").update(readFileSync(join(dir, tar))).digest("hex")}  ${tar}`;
  });
  writeFileSync(join(dir, "SHA256SUMS"), `${sums.join("\n")}\n`);
  return dir;
}

/** Runs the installer as a machine whose `uname -s` and `uname -m` say `os` and `machine`, in a scratch HOME. */
function install(release: string, os: string, machine: string): { code: number; out: string; home: string } {
  const home = mkdtempSync(join(tmpdir(), "overhand-install-"));
  const bin = join(home, "fakebin");
  mkdirSync(bin);
  writeFileSync(join(bin, "uname"), `#!/bin/sh\ncase "$1" in -s) echo ${os} ;; -m) echo ${machine} ;; esac\n`);
  chmodSync(join(bin, "uname"), 0o755);
  const r = Bun.spawnSync(["sh", INSTALLER], {
    cwd: home,
    env: {
      PATH: [bin, process.env.PATH].join(":"),
      HOME: home,
      OVERHAND_DOWNLOAD: `file://${release}`,
      OVERHAND_NO_START: "1",
      NO_COLOR: "1",
    },
  });
  return { code: r.exitCode, out: `${r.stdout.toString()}${r.stderr.toString()}`, home };
}

test("the installer installs the package for each OS and CPU name uname reports", () => {
  const release = fakeRelease();
  for (const [os, machine, want] of [
    ["Darwin", "arm64", "darwin-arm64"],
    ["Darwin", "x86_64", "darwin-x64"],
    ["Linux", "aarch64", "linux-arm64"],
    ["Linux", "arm64", "linux-arm64"],
    ["Linux", "x86_64", "linux-x64"],
    ["Linux", "amd64", "linux-x64"],
  ] as const) {
    const r = install(release, os, machine);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("Checksum verified");
    const ran = Bun.spawnSync([join(r.home, ".local", "bin", "overhand")])
      .stdout.toString()
      .trim();
    expect(ran, `${os} ${machine}`).toBe(want);
  }
}, 30_000); // six installer runs (curl, tar, a checksum each) outlast the 5 s default under the full suite

test("the installer refuses other systems and CPUs, and a package whose checksum doesn't match", () => {
  const release = fakeRelease();
  expect(install(release, "FreeBSD", "amd64").out).toContain("Overhand runs on macOS and Linux");
  expect(install(release, "Linux", "i686").out).toContain("No Overhand build for i686");
  writeFileSync(join(release, "overhand-linux-x64.tar.gz"), "tampered");
  const r = install(release, "Linux", "x86_64");
  expect(r.code).not.toBe(0);
  expect(r.out).toContain("Checksum mismatch");
}, 30_000);
