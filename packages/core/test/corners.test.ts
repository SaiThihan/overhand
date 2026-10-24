import { expect, test } from "bun:test";
import { BOOK88_CORNERS, BOOK88_TEST_DIFF } from "@overhand/contract/fixtures/trust";
import { cornerComment, cornerFingerprint, diffFiles, findCorners, inspectCorners, redactSecrets } from "../src/corners";

test("the demo's findings are what the detector reports for the demo's diff", () => {
  expect(findCorners(BOOK88_TEST_DIFF.join("\n"))).toEqual(BOOK88_CORNERS);
});

/** One file's diff with a single hunk; `lines` are hunk lines (`+`, `-` or ` `). */
function file(path: string, lines: string[], status: "modified" | "added" | "deleted" = "modified"): string {
  const head =
    status === "added"
      ? ["new file mode 100644", "--- /dev/null", `+++ b/${path}`]
      : status === "deleted"
        ? ["deleted file mode 100644", `--- a/${path}`, "+++ /dev/null"]
        : [`--- a/${path}`, `+++ b/${path}`];
  return [`diff --git a/${path} b/${path}`, ...head, "@@ -10,20 +10,20 @@", ...lines].join("\n");
}
const diff = (...files: string[]): string => files.join("\n");
const kinds = (d: string): string[] => findCorners(d).map((c) => c.kind);

// secrets are assembled at runtime, so this file never holds a real-looking token
const AWS = ["AKIA", "Q7RZ".repeat(4)].join("");
const GITHUB = ["ghp", "_", "a1B2c3D4e5".repeat(4)].join("");
const ANTHROPIC = ["sk", "-ant-", "api03-", "Zx9".repeat(10)].join("");
const STRIPE = ["sk", "_live_", "51Hq".repeat(6)].join("");
const SLACK = ["xox", "b-", "1234567890-abcdefghij"].join("");
const KEY = ["-----BEGIN ", "RSA PRIVATE KEY-----"].join("");

test("the diff parser keeps line numbers on both sides and file status", () => {
  const [f] = diffFiles(file("a.ts", [" keep", "-old", "+new", "+more"]));
  expect(f?.dels).toEqual([{ n: 11, text: "old", file: "a.ts" }]);
  expect(f?.adds.map((l) => l.n)).toEqual([11, 12]);
  expect(diffFiles(file("x.test.ts", ["-a"], "deleted"))[0]?.status).toBe("deleted");
});

test("a deleted test file is block-worthy; one whose tests moved to a new file isn't", () => {
  const body = ['-test("adds", () => {', "-  expect(add(1, 2)).toBe(3);", "-});"];
  const gone = findCorners(file("src/add.test.ts", body, "deleted"));
  expect(gone.map((c) => [c.kind, c.severity])).toEqual([["test-deleted", "block"]]);
  const moved = diff(
    file("src/add.test.ts", body, "deleted"),
    file("src/math/add.test.ts", ['+test("adds", () => {', "+  expect(add(1, 2)).toBe(3);", "+});"], "added"),
  );
  expect(kinds(moved)).toEqual([]);
});

test("removed test cases and emptied test files are found, quoting the removed line", () => {
  const d = file("api/users.test.ts", [
    ' test("lists users", () => {',
    "   expect(list()).toHaveLength(2);",
    " });",
    '-test("rejects a bad id", () => {',
    '-  expect(() => get("x")).toThrow();',
    "-});",
  ]);
  const [c] = findCorners(d);
  expect(c).toMatchObject({ kind: "tests-removed", severity: "warn", file: "api/users.test.ts", line: 13, sign: "-" });
  expect(c?.text).toBe('test("rejects a bad id", () => {');
});

test("assertions removed: two or more fewer, net, across the test files; a rewrite with the same count is quiet", () => {
  const cut = file("api/tenants.test.ts", [
    ' test("reads the tenant once a minute", async () => {',
    '   await getTenant("t1");',
    "-  expect(db.tenant.find).toHaveBeenCalledTimes(1);",
    "-  expect(queries()).toBe(1);",
    " });",
  ]);
  const found = findCorners(cut);
  expect(found.map((c) => c.kind)).toEqual(["assertions-removed", "assertions-removed"]);
  expect(found[0]?.text).toBe("expect(db.tenant.find).toHaveBeenCalledTimes(1);");

  const rewritten = file("api/tenants.test.ts", [
    "-  expect(db.tenant.find).toHaveBeenCalledTimes(1);",
    "-  expect(queries()).toBe(1);",
    "+  expect(db.tenant.find).toHaveBeenCalledOnce();",
    "+  expect(queries()).toEqual(1);",
  ]);
  expect(kinds(rewritten)).toEqual([]);
  // one fewer is a merge of two checks into one, not a pattern
  expect(
    kinds(file("a.test.ts", ["-  expect(a).toBe(1);", "-  expect(b).toBe(2);", "+  expect({ a, b }).toEqual({ a: 1, b: 2 });"])),
  ).toEqual([]);
  // Python and Go count too
  expect(kinds(file("tests/test_api.py", ["-    assert r.status == 200", "-    self.assertEqual(r.json(), {})"]))).toEqual([
    "assertions-removed",
    "assertions-removed",
  ]);
  expect(kinds(file("api_test.go", ['-\tt.Errorf("got %d", n)', "-\tt.Fatal(err)"]))).toHaveLength(2);
});

test("skips and focuses added in tests are found, in every framework", () => {
  for (const [path, line] of [
    ["src/x.test.ts", '+test.skip("expires after a minute", async () => {'],
    ["src/x.spec.js", '+  it.skip("works", () => {});'],
    ["src/x.test.ts", '+xit("works", () => {});'],
    ["tests/test_x.py", "+@pytest.mark.skip(reason='flaky')"],
    ["x_test.go", '+\tt.Skip("later")'],
    ["src/test/java/CartTest.java", "+  @Disabled"],
  ] as const)
    expect(kinds(file(path, [line]))).toEqual(["test-skipped"]);
  expect(findCorners(file("src/x.test.ts", ['+describe.only("cart", () => {'])).map((c) => [c.kind, c.severity])).toEqual([
    ["test-focused", "block"],
  ]);
});

test("a skip that was already on the base isn't new: context, moved, or edited", () => {
  // context line: the diff only touched the test around it
  expect(kinds(file("src/x.test.ts", [' test.skip("old flaky one", () => {', "-  const a = 1;", "+  const a = 2;"]))).toEqual([]);
  // the same line moved
  expect(kinds(file("src/x.test.ts", ['-test.skip("old", () => {});', " ", '+test.skip("old", () => {});']))).toEqual([]);
  // renamed while skipped
  expect(kinds(file("src/x.test.ts", ['-test.skip("old name", () => {});', '+test.skip("new name", () => {});']))).toEqual([]);
  // `.skip` outside a test file (a parser's own skip()) is nobody's business
  expect(kinds(file("src/parser.ts", ["+  if (c === ' ') return this.skip();"]))).toEqual([]);
});

test("type and lint checks switched off are found; mentions in strings and existing ones aren't", () => {
  for (const line of [
    "+  // @ts-ignore",
    "+  // @ts-expect-error the types are wrong",
    "+/* eslint-disable no-console */",
    "+  // biome-ignore lint/suspicious/noExplicitAny: later",
    "+  const x = y as any;",
    "+  const x = y as unknown as Tenant;",
  ])
    expect(kinds(file("src/a.ts", [line]))).toEqual(["check-loosened"]);
  expect(kinds(file("app/a.py", ["+import os  # noqa: F401", "+x = f()  # type: ignore"]))).toEqual(["check-loosened", "check-loosened"]);
  expect(kinds(file("tsconfig.json", ['-    "strict": true,', '+    "strict": false,']))).toEqual(["check-loosened"]);
  expect(kinds(file("biome.json", ['+        "noExplicitAny": "off"']))).toEqual(["check-loosened"]);
  // not a comment: a word in a string, a doc, a cast that was already there and only moved
  expect(kinds(file("src/a.ts", ['+  const tip = "never use as-any or ts-ignore";']))).toEqual([]);
  expect(kinds(file("docs/style.md", ["+Avoid `// @ts-ignore`."]))).toEqual([]);
  expect(kinds(file("src/a.ts", ["-  const x = y as any;", "+  const x = y as any; // moved"]))).toEqual([]);
});

test("coverage thresholds lowered and CI weakened are block-worthy; raised thresholds and renamed steps aren't", () => {
  expect(findCorners(file("vitest.config.ts", ["-      lines: 90,", "+      lines: 70,"]))[0]).toMatchObject({
    kind: "threshold-lowered",
    severity: "block",
    text: "lines: 70,",
  });
  expect(kinds(file("pyproject.toml", ["-fail_under = 80", "+fail_under = 60"]))).toEqual(["threshold-lowered"]);
  expect(kinds(file("vitest.config.ts", ["-      lines: 70,", "+      lines: 90,"]))).toEqual([]);

  const wf = ".github/workflows/ci.yml";
  expect(kinds(file(wf, ["       - run: bun test", "+        continue-on-error: true"]))).toEqual(["ci-weakened"]);
  expect(kinds(file(wf, ["-      - run: bun test", "+      - run: bun test || true"]))).toEqual(["ci-weakened"]);
  expect(kinds(file("package.json", ['-    "test": "vitest run",', '+    "test": "vitest run || true",']))).toEqual(["ci-weakened"]);
  expect(findCorners(file(wf, ["-      - run: bunx tsc --noEmit", "       - run: bun test"]))[0]).toMatchObject({
    kind: "ci-weakened",
    sign: "-",
    text: "- run: bunx tsc --noEmit",
  });
  // the step still runs, just differently; a job renamed; a non-check step removed
  expect(kinds(file(wf, ["-      - run: bun test", "+      - run: bun test --coverage"]))).toEqual([]);
  expect(kinds(file(wf, ["-    name: Run tests", "+    name: Tests"]))).toEqual([]);
  expect(kinds(file(wf, ["-      - run: bun install --frozen-lockfile"]))).toEqual([]);
});

test("snapshots rewritten wholesale: three files at once, not one updated snapshot", () => {
  const snap = (n: number) => file(`src/__snapshots__/c${n}.test.ts.snap`, ["-  <div>old</div>", "+  <div>new</div>"]);
  expect(kinds(diff(snap(1), snap(2), snap(3)))).toEqual(["snapshots-rewritten"]);
  expect(kinds(snap(1))).toEqual([]);
});

test("secrets: high-confidence formats and added env files, redacted when quoted; placeholders and samples aren't", () => {
  for (const s of [AWS, GITHUB, ANTHROPIC, STRIPE, SLACK, KEY]) {
    const [c] = findCorners(file("src/config.ts", [`+const k = "${s}";`]));
    expect(c).toMatchObject({ kind: "secret", severity: "block" });
    expect(c?.text).not.toContain(s);
  }
  expect(kinds(file(".env", ["+DATABASE_URL=postgres://localhost/app"], "added"))).toEqual(["secret"]);
  expect(kinds(file(".env.example", ["+DATABASE_URL="], "added"))).toEqual([]);
  expect(kinds(file("docs/aws.md", ['+aws_access_key_id = "AKIAIOSFODNN7EXAMPLE"']))).toEqual([]);
  expect(kinds(file("src/a.ts", ['+const key = process.env.STRIPE_KEY ?? "";']))).toEqual([]);
  // a secret already on the base, moved, isn't new; one rotated in place is
  expect(kinds(file("src/config.ts", [`-const k = "${AWS}";`, `+const k = "${AWS}"; // moved`]))).toEqual([]);
  expect(kinds(file("src/config.ts", [`-const k = "${AWS}";`, `+const k = "${AWS.replace("Q", "W")}";`]))).toEqual(["secret"]);
});

test("redaction blanks tokens, secret-named variables, flags and URL passwords, and leaves the command readable", () => {
  expect(redactSecrets(`GITHUB_TOKEN=${GITHUB} gh pr list`)).toBe("GITHUB_TOKEN=[redacted] gh pr list");
  expect(redactSecrets(`curl -H "Authorization: Bearer abcdefghijklmnop123" https://x`)).toBe(
    'curl -H "Authorization: Bearer [redacted]" https://x',
  );
  expect(redactSecrets("mysql --password hunter22 -h db")).toBe("mysql --password [redacted] -h db");
  expect(redactSecrets("psql postgres://app:s3cr3tpw@db.example.com/app")).toBe("psql postgres://app:[redacted]@db.example.com/app");
  expect(redactSecrets(`echo ${ANTHROPIC}`)).toBe("echo [redacted]");
  expect(redactSecrets("git push origin main")).toBe("git push origin main");
});

test("the PR comment goes out once per new finding: not again for the same set, a subset, or a clean diff", async () => {
  const bodies: string[] = [];
  const post = async (b: string) => {
    bodies.push(b);
    return true;
  };
  const skip = file("src/x.test.ts", ['+test.skip("x", () => {});']);
  const focus = file("src/y.test.ts", ['+test.only("y", () => {});']);
  const pr: { corners?: ReturnType<typeof findCorners>; cornersPosted?: string[] } = {};
  expect(await inspectCorners(pr, skip, post)).toBe(true);
  expect(await inspectCorners(pr, skip, post)).toBe(false); // the next fix round left it as it was
  expect(await inspectCorners(pr, diff(skip, focus), post)).toBe(true); // a new corner
  expect(await inspectCorners(pr, focus, post)).toBe(false); // one fixed: nothing new to say
  expect(await inspectCorners(pr, file("a.ts", ["+ok"]), post)).toBe(false);
  expect(pr.corners).toEqual([]);
  expect(bodies).toHaveLength(2);
  // the setting off: findings are kept, nothing is posted; a failed post is tried again next time
  const quiet: typeof pr = {};
  expect(await inspectCorners(quiet, skip)).toBe(false);
  expect(quiet.corners).toHaveLength(1);
  expect(await inspectCorners(quiet, skip, async () => false)).toBe(false);
  expect(quiet.cornersPosted).toBeUndefined();
});

test("a clean diff has no findings, block-worthy ones sort first, and the comment carries the set's fingerprint", () => {
  expect(kinds(file("src/a.ts", ["-const a = 1;", "+const a = 2;"]))).toEqual([]);
  const d = diff(file("src/a.ts", ["+  // @ts-ignore"]), file("src/x.test.ts", ['+test.skip("x", () => {});']));
  const cs = findCorners(d);
  expect(cs.map((c) => c.severity)).toEqual(["block", "warn"]);
  const body = cornerComment(cs);
  expect(body).toContain("Test skipped in `src/x.test.ts:10`");
  expect(body).toContain(`overhand-corners ${cornerFingerprint(cs)}`);
  expect(cornerFingerprint([...cs].reverse())).toBe(cornerFingerprint(cs));
});
