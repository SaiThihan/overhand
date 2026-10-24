/** release/install.sh against a fake release in a scratch folder. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const INSTALLER = resolve(import.meta.dir, "..", "..", "..", "release", "install.sh");
const os = process.platform === "darwin" ? "darwin" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";

test("the installer checks the package, puts the binary on ~/.local/bin, and honours OVERHAND_NO_START", () => {
  const root = mkdtempSync(join(tmpdir(), "overhand-install-"));
  // the release: a package whose binary prints "new", and its SHA256SUMS
  const pkgDir = join(root, "pkg");
  mkdirSync(join(pkgDir, "web"), { recursive: true });
  writeFileSync(join(pkgDir, "overhand"), "#!/bin/sh\necho new\n");
  chmodSync(join(pkgDir, "overhand"), 0o755);
  const rel = join(root, "release");
  mkdirSync(rel);
  const pkg = `overhand-${os}-${arch}.tar.gz`;
  expect(Bun.spawnSync(["tar", "-czf", join(rel, pkg), "-C", pkgDir, "overhand", "web"]).exitCode).toBe(0);
  const sum = createHash("sha256")
    .update(readFileSync(join(rel, pkg)))
    .digest("hex");
  writeFileSync(join(rel, "SHA256SUMS"), `${sum}  ${pkg}\n`);

  const home = join(root, "home");
  mkdirSync(home);
  const r = Bun.spawnSync(["sh", INSTALLER], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, OVERHAND_NO_START: "1", OVERHAND_DOWNLOAD: `file://${rel}` },
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString()).toContain("Overhand is installed"); // installed, not started
  expect(
    Bun.spawnSync([join(home, ".local", "bin", "overhand")])
      .stdout.toString()
      .trim(),
  ).toBe("new");
});
