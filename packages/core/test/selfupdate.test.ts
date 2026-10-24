import { expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { INSTALLER } from "@overhand/contract";
import { installKind, moveOnce, stableExec } from "../src/env";
import * as self from "../src/selfupdate";

const git = (dir: string, ...args: string[]): string => {
  const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
};

/** origin (bare), ops (the checkout being updated) and dev (pushes new commits to origin). */
function scratch(): { ops: string; dev: string } {
  const root = mkdtempSync(join(tmpdir(), "overhand-update-"));
  const origin = join(root, "origin.git");
  const ops = join(root, "ops");
  const dev = join(root, "dev");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, dev);
  writeFileSync(join(dev, "a.txt"), "1");
  git(dev, "add", ".");
  git(dev, "commit", "-qm", "one");
  git(dev, "push", "-q", "origin", "HEAD:main");
  git(root, "clone", "-q", origin, ops);
  return { ops, dev };
}

const push = (dev: string, msg: string): void => {
  writeFileSync(join(dev, "a.txt"), msg);
  git(dev, "commit", "-qam", msg);
  git(dev, "push", "-q", "origin", "HEAD:main");
};

test("checkOpsUpdate counts commits behind; updateOps fast-forwards them", async () => {
  const { ops, dev } = scratch();
  push(dev, "two");
  await self.checkOpsUpdate(ops);
  expect(self.opsBehind).toBe(1);
  const r = self.updateOps(ops);
  expect(r).toEqual({ ok: true, message: "Updated 1 commit(s). Overhand restarts as soon as no agent is running." });
  expect(self.opsBehind).toBe(0);
  expect(git(ops, "rev-parse", "HEAD")).toBe(git(dev, "rev-parse", "HEAD"));
});

test("updateOps refuses a dirty checkout or one off main, and leaves it untouched", () => {
  const { ops, dev } = scratch();
  push(dev, "two");
  const head = git(ops, "rev-parse", "HEAD");
  writeFileSync(join(ops, "a.txt"), "local edit");
  expect(self.updateOps(ops)).toEqual({ ok: false, message: "ops has uncommitted changes; commit or discard them first" });
  git(ops, "checkout", "-q", "--", "a.txt");
  git(ops, "switch", "-qc", "feature");
  expect(self.updateOps(ops).message).toBe("ops isn't on main; switch back before updating");
  expect(git(ops, "rev-parse", "HEAD")).toBe(head);
});

test("a requested restart exits between work passes, but waits while an agent holds the lock", () => {
  // a child process, because restartIfRequested calls process.exit
  const run = (locked: boolean): { code: number | null; out: string } => {
    const home = mkdtempSync(join(tmpdir(), "overhand-home-"));
    copyFileSync(resolve(import.meta.dir, "../../../overhand.config.example.json"), join(home, "overhand.config.json"));
    if (locked) writeFileSync(join(home, ".lock"), "");
    const script = [
      `const s = await import(${JSON.stringify(resolve(import.meta.dir, "../src/selfupdate"))});`,
      "s.requestStop(false); s.restartIfRequested();",
      `setTimeout(() => { console.log("alive"); process.exit(3); }, 1500);`,
    ].join("\n");
    const r = Bun.spawnSync(["bun", "-e", script], { env: { ...process.env, OVERHAND_HOME: home, XPC_SERVICE_NAME: "" } });
    return { code: r.exitCode, out: r.stdout.toString() };
  };
  const free = run(false);
  expect(free.code).toBe(0);
  expect(free.out).not.toContain("alive");
  expect(run(true)).toEqual({ code: 3, out: "alive\n" });
});

test("each install kind is told apart by where its binary lives, and updates its own way", () => {
  const home = "/Users/u";
  const kinds = {
    "/Users/u/.overhand/app/overhand": "curl",
    "/opt/homebrew/Cellar/overhand/0.2.0/libexec/overhand": "brew",
    "/opt/homebrew/opt/overhand/libexec/overhand": "brew",
    "/home/linuxbrew/.linuxbrew/Cellar/overhand/0.2.0/libexec/overhand": "brew",
    "/Users/u/.overhand/npm/0.2.0/overhand": "npx",
    "/Users/u/.overhand/npm/current/overhand": "npx",
    "/opt/overhand/overhand": "curl", // unpacked by hand: the installer's way
  };
  for (const [exec, kind] of Object.entries(kinds)) expect([exec, installKind(exec, true, home)]).toEqual([exec, kind]);
  expect(installKind("/Users/u/.bun/bin/bun", false, home)).toBe("checkout");

  // the service runs a path that follows updates, never a versioned folder
  expect(stableExec("/opt/homebrew/Cellar/overhand/0.2.0/libexec/overhand", home)).toBe("/opt/homebrew/opt/overhand/libexec/overhand");
  expect(stableExec("/Users/u/.overhand/npm/0.2.0/overhand", home)).toBe("/Users/u/.overhand/npm/current/overhand");
  expect(stableExec("/Users/u/.overhand/app/overhand", home)).toBe("/Users/u/.overhand/app/overhand");

  // never a second copy: only the curl install runs the installer
  expect(self.updateRoute("curl")).toEqual({ run: ["sh", "-c", `curl -fsSL ${INSTALLER} | sh`], say: "overhand update" });
  expect(self.updateRoute("brew")).toEqual({ run: ["brew", "upgrade", "overhand"], say: "brew upgrade overhand" });
  expect(self.updateRoute("npx", true)).toEqual({ run: ["npx", "-y", "overhand@latest", "version"], say: "npx overhand@latest update" });
  expect(self.updateRoute("npx", false)).toEqual({ run: ["bunx", "overhand@latest", "version"], say: "bunx overhand@latest update" });
});

test("a stable path that moves on to another binary (brew upgrade, a newer npx) asks for a restart", () => {
  const npm = mkdtempSync(join(tmpdir(), "overhand-npm-"));
  for (const v of ["0.2.0", "0.3.0"]) {
    mkdirSync(join(npm, v));
    writeFileSync(join(npm, v, "overhand"), v);
  }
  symlinkSync("0.2.0", join(npm, "current"));
  const stable = join(npm, "current", "overhand");
  const boot = realpathSync(stable);
  expect(self.binaryMoved(stable, boot)).toBe(false);
  rmSync(join(npm, "current"));
  symlinkSync("0.3.0", join(npm, "current"));
  expect(self.binaryMoved(stable, boot)).toBe(true);
  expect(self.binaryMoved(join(npm, "gone", "overhand"), boot)).toBe(false); // mid-upgrade: wait
});

test("slack-mcp.json moves from beside the binary to the config folder once, and never over one already there", () => {
  const dir = mkdtempSync(join(tmpdir(), "overhand-slack-"));
  const [from, to] = [join(dir, "app", "slack-mcp.json"), join(dir, "home", "slack-mcp.json")];
  mkdirSync(join(dir, "app"));
  mkdirSync(join(dir, "home"));
  writeFileSync(from, "old");
  moveOnce(from, to);
  expect([existsSync(from), readFileSync(to, "utf8")]).toEqual([false, "old"]);
  writeFileSync(from, "stale");
  moveOnce(from, to);
  expect(readFileSync(to, "utf8")).toBe("old");
});
