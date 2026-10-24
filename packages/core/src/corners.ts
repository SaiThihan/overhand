/**
 * "Your agent cut a corner": reads an agent PR's diff against its base, without a model, for tests deleted, emptied,
 * skipped or focused, assertions removed, type and lint checks loosened, coverage thresholds and CI steps weakened,
 * snapshots rewritten wholesale, and secrets. It leans towards silence: a weak signal is missed rather than cried about,
 * and anything already on the base (a moved line, an edited line that already skipped) is never flagged.
 */
import { createHash } from "node:crypto";
import type { Corner, CornerKind } from "@overhand/contract";

interface Line {
  n: number;
  text: string;
  file: string;
}

interface FileDiff {
  path: string;
  status: "added" | "deleted" | "modified";
  adds: Line[];
  dels: Line[];
}

/** A unified diff (`gh pr diff`, `git diff`) as files with their added and removed lines and line numbers. */
export function diffFiles(diff: string): FileDiff[] {
  const out: FileDiff[] = [];
  let f: FileDiff | undefined;
  let inHunk = false;
  let o = 0;
  let n = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("diff --git ")) {
      f = { path: l.match(/ b\/(.+)$/)?.[1] ?? "", status: "modified", adds: [], dels: [] };
      out.push(f);
      inHunk = false;
      continue;
    }
    if (!f) continue;
    const hunk = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      inHunk = true;
      o = Number(hunk[1]);
      n = Number(hunk[2]);
      continue;
    }
    if (!inHunk) {
      if (l.startsWith("new file mode")) f.status = "added";
      else if (l.startsWith("deleted file mode")) f.status = "deleted";
      else if (l.startsWith("+++ b/")) f.path = l.slice(6);
      continue;
    }
    if (l.startsWith("+")) f.adds.push({ n: n++, text: l.slice(1), file: f.path });
    else if (l.startsWith("-")) f.dels.push({ n: o++, text: l.slice(1), file: f.path });
    else if (l.startsWith(" ") || l === "") {
      o++;
      n++;
    }
  }
  return out;
}

// ---------- what files are ----------

const TEST_FILE =
  /(^|\/)(__tests__|__test__|tests?|spec|e2e)\/|\.(test|spec|e2e)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go|rb)$|_spec\.rb$|Tests?\.(java|kt|cs|swift)$/;
const CODE_FILE = /\.([cm]?[jt]sx?|py|go|rb|rs|java|kt|swift|cs|php|vue|svelte)$/;
const CI_FILE =
  /^\.github\/workflows\/.+\.ya?ml$|(^|\/)\.gitlab-ci\.ya?ml$|^\.circleci\/|(^|\/)azure-pipelines\.ya?ml$|(^|\/)bitbucket-pipelines\.ya?ml$|(^|\/)Jenkinsfile$|^\.buildkite\//;
/** Files that run checks by command: CI, package scripts, Makefiles, shell scripts. */
const SCRIPT_FILE = /(^|\/)(package\.json|Makefile|justfile|Taskfile\.ya?ml)$|\.sh$/;
const COVERAGE_FILE =
  /(^|\/)((jest|vitest|vite|karma)\.config\.[cm]?[jt]s|\.nycrc(\.json)?|package\.json|pyproject\.toml|setup\.cfg|\.coveragerc|tox\.ini|codecov\.ya?ml|bunfig\.toml)$/;
const TS_CONFIG = /(^|\/)tsconfig[^/]*\.json$/;
const LINT_CONFIG = /(^|\/)(biome\.jsonc?|\.eslintrc(\.[a-z]+)?|eslint\.config\.[cm]?[jt]s|\.golangci\.ya?ml|ruff\.toml)$/;
const SNAPSHOT_FILE = /\.snap$|(^|\/)__snapshots__\/|\.ambr$/;
const ENV_FILE = /(^|\/)\.env(\.[\w.-]+)?$/;
const ENV_SAMPLE = /\.(example|sample|template|dist|defaults)$/;

// ---------- what lines say ----------

/** Assertion calls on a line: expect(), assert*, should, Go's t.Error/Fatal, testify and chai. */
const ASSERTION =
  /\bexpect\s*\(|\bassert(?:_\w+|[A-Z]\w*)?\s*\(|\bassert\s+[^\s=(]|\.should\b|\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(|\b(?:require|assert)\.\w+\s*\(/g;
/** A test case's declaration, skipped and focused ones included. */
const TEST_DECL =
  /^\s*[xf]?(?:it|test|specify)(?:\.(?:skip|only|todo|concurrent|each\b[^(]*))?\s*\(|^\s*(?:async\s+)?def\s+test\w*\s*\(|^\s*func\s+Test\w*\s*\(|^\s*@Test\b|^\s*#\[test\]/;
const SKIP =
  /\b(?:it|test|describe|context|suite|specify)\.(?:skip|todo)\b|\b(?:xit|xtest|xdescribe|xcontext|xspecify)\s*\(|@pytest\.mark\.(?:skip|skipif|xfail)\b|\bpytest\.skip\s*\(|@unittest\.(?:skip|skipIf|skipUnless|expectedFailure)\b|\bt\.Skip(?:Now|f)?\s*\(|@(?:Disabled|Ignore)\b/;
const FOCUS = /\b(?:it|test|describe|context|suite)\.only\s*\(|\b(?:fit|fdescribe|fcontext)\s*\(/;
/** Comments and casts that switch a type or lint check off; comment markers required, so a mention in a string isn't one. */
const LOOSEN =
  /(?:\/\/|\/\*)\s*@ts-(?:ignore|expect-error|nocheck)\b|(?:\/\/|\/\*)\s*eslint-disable|\/\/\s*biome-ignore|#\s*type:\s*ignore\b|#\s*noqa\b|#\s*pylint:\s*disable|\/\/\s*nolint\b|\bas\s+any\b|\bas\s+unknown\s+as\b/;
const TS_LOOSEN = /"(?:strict|noImplicitAny|strictNullChecks|noUncheckedIndexedAccess)"\s*:\s*false\b/;
const LINT_OFF = /["']off["']/;
const CI_SOFT = /^\s*(?:-\s+)?(?:continue-on-error|allow_failure)\s*:\s*true\b|^\s*(?:-\s+)?if\s*:\s*(?:false\b|\$\{\{\s*false\s*\}\})/;
/** A check command made to always pass: `bun test || true`. */
const ALWAYS_PASS =
  /\b(?:test|tests|lint|tsc|typecheck|type-check|check|pytest|jest|vitest|mocha|eslint|biome|mypy|ruff|rspec|vet)\b.*\|\|\s*(?:true\b|exit\s+0\b|:(?=\s|$|["']))/;
/** A CI line that runs a command, and the check it runs. */
const CI_COMMAND = /^\s*(?:-\s+)?(?:run|script|command|sh)\b|^\s*-\s+(?!(?:name|uses|with|if|id|needs|env)\s*:)/;
const CHECK_WORD =
  /\b(test|tests|lint|tsc|typecheck|type-check|pytest|jest|vitest|mypy|ruff|eslint|biome|rspec|cargo test|go test|go vet)\b/;
const THRESHOLD =
  /\b(branches|functions|lines|statements|fail_under|fail-under|cov-fail-under|min_coverage|coverageThreshold)\b["']?\s*[:=]?\s*(\d+(?:\.\d+)?)/;

/** High-confidence secret formats only: private keys and the token shapes of AWS, GitHub, Anthropic, OpenAI, Stripe and Slack. */
export const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{60,}/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/,
  /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}/,
  /\bsk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}/,
  /\b[rs]k_live_[A-Za-z0-9]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/,
];
/** Documentation placeholders that look like a token but aren't one. */
export const PLACEHOLDER = /EXAMPLE|x{6,}|X{6,}|0{12,}|your[_-]|<[^>]*>|\.\.\./;

/**
 * `text` with every secret blanked out: the token formats above, `KEY=value` and `--password value` for names that say
 * secret, and bearer tokens in headers. What the guardrail log keeps and the Review drawer quotes.
 */
export function redactSecrets(text: string): string {
  let t = text;
  for (const re of SECRET_PATTERNS) t = t.replace(new RegExp(re.source, "g"), "[redacted]");
  return t
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY[A-Z ]*-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY[A-Z ]*-----|$)/g, "[redacted]")
    .replace(/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 [redacted]")
    .replace(/(--?(?:password|passwd|token|secret|api-key|apikey)[= ])("[^"]*"|'[^']*'|\S+)/gi, "$1[redacted]")
    .replace(
      /\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gi,
      "$1=[redacted]",
    )
    .replace(/(:\/\/[^:/\s@]+:)[^@\s]+@/g, "$1[redacted]@");
}

/** The first real-looking secret token on a line, or "". */
function secretIn(text: string): string {
  for (const re of SECRET_PATTERNS) {
    const token = text.match(re)?.[0];
    if (token && !PLACEHOLDER.test(token)) return token;
  }
  return "";
}

// ---------- the detector ----------

const norm = (s: string): string => s.trim().replace(/\s+/g, " ");

/**
 * The added lines matching `re` that the base didn't already have: a removed line with the same text is a move, and as
 * many matching removed lines as remain are edits of a line that already did this. Diff-wide, so moving a test to
 * another file isn't news.
 */
function surplus(adds: Line[], dels: Line[], re: RegExp): Line[] {
  const a = adds.filter((l) => re.test(l.text));
  const d = dels.filter((l) => re.test(l.text));
  const left = [...a];
  const rest: Line[] = [];
  for (const l of d) {
    const i = left.findIndex((x) => norm(x.text) === norm(l.text));
    if (i >= 0) left.splice(i, 1);
    else rest.push(l);
  }
  return left.slice(rest.length);
}

const count = (lines: Line[], re: RegExp): number =>
  lines.reduce((n, l) => n + (re.global ? [...l.text.matchAll(re)].length : Number(re.test(l.text))), 0);

/** Removed lines with no identical added line (in the whole diff). */
function unmatchedDels(dels: Line[], adds: Line[]): Line[] {
  const pool = adds.map((l) => norm(l.text));
  return dels.filter((l) => {
    const i = pool.indexOf(norm(l.text));
    if (i < 0) return true;
    pool.splice(i, 1);
    return false;
  });
}

const BLOCK: ReadonlySet<CornerKind> = new Set<CornerKind>([
  "test-deleted",
  "test-skipped",
  "test-focused",
  "threshold-lowered",
  "ci-weakened",
  "secret",
]);

/** Every corner a diff may have cut, block-worthy ones first; at most 30. */
export function findCorners(diff: string): Corner[] {
  const files = diffFiles(diff);
  const out: Corner[] = [];
  const add = (kind: CornerKind, l: Line | { file: string; n: number; text: string }, sign: "+" | "-") =>
    out.push({
      kind,
      severity: BLOCK.has(kind) ? "block" : "warn",
      file: l.file,
      line: l.n,
      sign,
      text: redactSecrets(l.text.trim()).slice(0, 200),
    });
  const pick = (re: RegExp) => (f: FileDiff) => re.test(f.path);
  const adds = (fs: FileDiff[]) => fs.flatMap((f) => f.adds);
  const dels = (fs: FileDiff[]) => fs.flatMap((f) => f.dels);

  // tests and assertions, counted across every changed test file: a test moved between files isn't a test lost
  const tests = files.filter(pick(TEST_FILE));
  const tAdds = adds(tests);
  const tDels = dels(tests);
  const declDrop = count(tDels, TEST_DECL) - count(tAdds, TEST_DECL);
  if (declDrop > 0) {
    for (const f of tests.filter((f) => f.status === "deleted" && f.dels.some((l) => TEST_DECL.test(l.text))))
      add("test-deleted", { file: f.path, n: 0, text: "" }, "-");
    const gone = new Set(tests.filter((f) => f.status === "deleted").map((f) => f.path));
    for (const l of unmatchedDels(tDels, tAdds)
      .filter((l) => TEST_DECL.test(l.text) && !gone.has(l.file))
      .slice(0, declDrop))
      add("tests-removed", l, "-");
  }
  // a couple of assertions merged into one is a rewrite; two or more fewer, net, is a pattern worth a look
  const assertDrop = count(tDels, ASSERTION) - count(tAdds, ASSERTION);
  if (assertDrop >= 2) {
    const gone = new Set(out.filter((c) => c.kind === "test-deleted").map((c) => c.file));
    for (const l of unmatchedDels(tDels, tAdds)
      .filter((l) => new RegExp(ASSERTION.source).test(l.text) && !gone.has(l.file))
      .slice(0, 5))
      add("assertions-removed", l, "-");
  }
  for (const l of surplus(tAdds, tDels, SKIP)) add("test-skipped", l, "+");
  for (const l of surplus(tAdds, tDels, FOCUS)) add("test-focused", l, "+");

  // checks switched off in code, tsconfig and lint config
  const code = files.filter(pick(CODE_FILE));
  for (const l of surplus(adds(code), dels(code), LOOSEN)) add("check-loosened", l, "+");
  const ts = files.filter(pick(TS_CONFIG));
  for (const l of surplus(adds(ts), dels(ts), TS_LOOSEN)) add("check-loosened", l, "+");
  const lint = files.filter(pick(LINT_CONFIG));
  for (const l of surplus(adds(lint), dels(lint), LINT_OFF)) add("check-loosened", l, "+");

  // coverage thresholds: the same key, a lower number
  for (const f of files.filter(pick(COVERAGE_FILE))) {
    const before = new Map<string, number>();
    for (const l of f.dels) {
      const m = l.text.match(THRESHOLD);
      if (m?.[1] && m[2]) before.set(m[1], Number(m[2]));
    }
    for (const l of f.adds) {
      const m = l.text.match(THRESHOLD);
      const was = m?.[1] ? before.get(m[1]) : undefined;
      if (m?.[2] && was !== undefined && Number(m[2]) < was) add("threshold-lowered", l, "+");
    }
  }

  // CI: steps allowed to fail or switched off, checks made to always pass, check steps removed
  const ci = files.filter(pick(CI_FILE));
  for (const l of surplus(adds(ci), dels(ci), CI_SOFT)) add("ci-weakened", l, "+");
  const scripts = files.filter((f) => CI_FILE.test(f.path) || SCRIPT_FILE.test(f.path));
  for (const l of surplus(adds(scripts), dels(scripts), ALWAYS_PASS)) add("ci-weakened", l, "+");
  for (const f of ci) {
    const added = f.adds.map((l) => l.text).join("\n");
    for (const l of unmatchedDels(f.dels, f.adds)) {
      const word = CI_COMMAND.test(l.text) ? l.text.match(CHECK_WORD)?.[1] : undefined;
      if (word && !new RegExp(`\\b${word}\\b`).test(added)) add("ci-weakened", l, "-");
    }
  }

  // snapshots rewritten wholesale: three files or a hundred lines at once
  const snaps = files.filter((f) => SNAPSHOT_FILE.test(f.path) && f.status !== "added");
  const snapLines = snaps.reduce((n, f) => n + f.dels.length, 0);
  if (snaps.length >= 3 || snapLines >= 100) {
    const [first] = snaps;
    if (first) add("snapshots-rewritten", { file: first.path, n: 0, text: snaps.map((f) => f.path).join(", ") }, "-");
  }

  // secrets: token formats on added lines that weren't on the base, and env files added
  const removed = dels(files)
    .map((l) => l.text)
    .join("\n");
  for (const l of adds(files)) {
    const token = secretIn(l.text);
    if (token && !removed.includes(token)) add("secret", l, "+"); // a token the base had, moved, isn't new
  }
  for (const f of files.filter((f) => f.status === "added" && ENV_FILE.test(f.path) && !ENV_SAMPLE.test(f.path)))
    add("secret", { file: f.path, n: 0, text: "" }, "+");

  return out.sort((a, b) => Number(b.severity === "block") - Number(a.severity === "block")).slice(0, 30);
}

/** A finding set's identity, so a PR comment goes out once per set and never again for the same findings. */
export function cornerFingerprint(cs: readonly Corner[]): string {
  const rows = cs.map((c) => [c.kind, c.file, c.sign, c.text].join("|")).sort();
  return createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 16);
}

const SAY: Record<CornerKind, string> = {
  "test-deleted": "Test file deleted",
  "tests-removed": "Test removed",
  "assertions-removed": "Assertion removed",
  "test-skipped": "Test skipped",
  "test-focused": "Test focused (the others stop running)",
  "check-loosened": "Check switched off",
  "threshold-lowered": "Threshold lowered",
  "ci-weakened": "CI weakened",
  "snapshots-rewritten": "Snapshots rewritten",
  secret: "Possible secret",
};

/**
 * Refreshes a PR's findings from its diff and, with `post`, comments when a finding hasn't been listed before: the same
 * findings after a fix round, or fewer, never comment again. Returns whether it commented.
 */
export async function inspectCorners(
  pr: { corners?: Corner[]; cornersPosted?: string[] },
  diff: string,
  post?: (body: string) => Promise<boolean>,
): Promise<boolean> {
  const cs = findCorners(diff);
  pr.corners = cs;
  const posted = new Set(pr.cornersPosted ?? []);
  const ids = cs.map((c) => cornerFingerprint([c]));
  if (!post || ids.every((id) => posted.has(id)) || !(await post(cornerComment(cs)))) return false;
  pr.cornersPosted = [...new Set([...posted, ...ids])];
  return true;
}

/** The one PR comment that lists the findings, marked with their fingerprint so it's never posted twice. */
export function cornerComment(cs: readonly Corner[]): string {
  const where = (c: Corner) => (c.line ? `${c.file}:${c.line}` : c.file);
  const row = (c: Corner) =>
    [
      `- ${c.severity === "block" ? "**Check before merging**" : "Worth a look"}: ${SAY[c.kind]} in \`${where(c)}\``,
      c.text && c.kind !== "snapshots-rewritten" ? `\n  \`${c.sign} ${c.text.replaceAll("`", "'")}\`` : "",
    ].join("");
  return [
    "Overhand read this diff for corners an agent might cut, and found these:",
    "",
    ...cs.map(row),
    "",
    "Each may be right; read them before merging.",
    `<!-- overhand-corners ${cornerFingerprint(cs)} -->`,
  ].join("\n");
}
