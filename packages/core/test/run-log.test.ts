import { expect, test } from "bun:test";
import { exitLine } from "../src/leads";
import { stamped } from "../src/notify";
import { countRefusals, sandboxRefusals } from "../src/sandbox";

test("each daemon log line starts with the local time, and the first line of a day with the date too", () => {
  const at = (h: number, m: number, s: number, day = 24) => new Date(2026, 9, day, h, m, s);
  expect(stamped("⚡ started", at(9, 5, 7))).toBe("2026-10-24 09:05:07 ⚡ started");
  expect(stamped("next", at(9, 5, 8))).toBe("09:05:08 next");
  expect(stamped("after midnight", at(0, 0, 1, 25))).toBe("2026-10-25 00:00:01 after midnight");
  expect(stamped("same day", at(0, 0, 2, 25))).toBe("00:00:02 same day");
});

test("a lead's exit line says how it ran, and a failed sandboxed run the sandbox's refusals", () => {
  expect(exitLine("Shop lead", "1", 12.4, "sandboxed", 3)).toBe("⚡ Shop lead exited (1, sandboxed, 3 sandbox refusals) after 12 min");
  expect(exitLine("K", "1", 1, "sandboxed", 1)).toBe("⚡ K exited (1, sandboxed, 1 sandbox refusal) after 1 min");
  expect(exitLine("K", "1", 1, "sandboxed")).toBe("⚡ K exited (1, sandboxed) after 1 min");
  expect(exitLine("K", "0", 1, "guard only")).toBe("⚡ K exited (0, guard only) after 1 min");
  expect(exitLine("K", "0", 1, "unsandboxed")).toBe("⚡ K exited (0, unsandboxed) after 1 min");
  // state from before this field: as before
  expect(exitLine("K", "code 0", 1)).toBe("⚡ K exited (code 0) after 1 min");
});

test("only refused writes count as the sandbox's refusals, not the system's refused reads and lookups", () => {
  const log = [
    "2026-10-24 01:28:05.739 E  kernel[0:55cd5a] (Sandbox) Sandbox: bash(4121) deny(1) file-write-create /Users/x/.zshrc",
    "2026-10-24 01:28:05.740 E  kernel[0:55cd5a] (Sandbox) Sandbox: git(4122) deny(1) file-write-data /Users/x/repo/.git/config",
    "2026-10-24 01:28:05.741 E  kernel[0:55cd5a] (Sandbox) Sandbox: logd_helper(405) deny(1) file-read-data /Users/x/a.node",
    "2026-10-24 01:28:05.742 E  kernel[0:55cd5a] (Sandbox) Sandbox: imagent(77) deny(1) mach-lookup com.apple.x",
    "2026-10-24 01:28:05.743 E  kernel[0:55cd5a] (Sandbox) Sandbox: bash(4121) allow file-write-create /Users/x/.zshrc",
  ].join("\n");
  expect(countRefusals(log)).toBe(2);
  expect(countRefusals("")).toBe(0);
});

test("off macOS the refusals can't be read, so the exit line keeps just the mode", async () => {
  expect(await sandboxRefusals(Date.now(), "linux")).toBeNull();
});
