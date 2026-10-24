import { expect, test } from "bun:test";
import { guideCode, guideDrift, makeTargets, type RepoFacts } from "../src/index";

const BUN_REPO: RepoFacts = {
  dirs: ["apps", "packages", "docs"],
  files: ["package.json", "bun.lock", "README.md", "ONBOARDING.md"],
  scripts: { dev: "vite", test: "bun test", lint: "biome check .", build: "vite build" },
  makeTargets: null,
};

const GOOD = `# Onboarding

## Install and run

\`\`\`sh
bun install
bun run dev
\`\`\`

## Test

Run \`bun test\` and \`bun run lint\`. The app lives in \`apps/web/\`, shared code in \`packages/\`.
See \`docs/design.md\`. It renders with \`react-dom/client\`.
`;

test("a guide that matches the repo has no drift", () => {
  expect(guideDrift(GOOD, BUN_REPO)).toEqual([]);
});

test("it says npm, the repo uses bun", () => {
  const text = "## Run\n\n```\nnpm install\nnpm run dev\n```\n\nThen `npx vitest`.";
  expect(guideDrift(text, BUN_REPO)).toEqual([{ kind: "pm", said: "npm", actual: "bun" }]);
  // naming the right one anywhere is enough: a global npm install alongside bun isn't drift
  expect(guideDrift("`npm i -g vercel` then `bun run dev`", BUN_REPO)).toEqual([]);
  // prose doesn't count, only commands in code
  expect(guideDrift("We moved off npm last year.", BUN_REPO)).toEqual([]);
  // Python lockfiles are read the same way
  const py: RepoFacts = { dirs: ["src"], files: ["pyproject.toml", "uv.lock"], scripts: null, makeTargets: null };
  expect(guideDrift("```\npoetry install\npoetry run pytest\n```", py)).toEqual([{ kind: "pm", said: "poetry", actual: "uv" }]);
  // no lockfile, no claim about the package manager
  expect(guideDrift("`npm install`", { ...BUN_REPO, files: ["package.json"] })).toEqual([]);
});

test("scripts and make targets the guide runs must exist", () => {
  const text = "```\nbun run e2e\nbun dev\nbun test\nbun x.ts\nmake deploy\n```\n`yarn storybook` and `npm start`";
  const repo: RepoFacts = { ...BUN_REPO, files: [...BUN_REPO.files, "Makefile"], makeTargets: ["build", "lint"] };
  // bun is named too, so yarn alone isn't package manager drift; its missing script still is
  expect(guideDrift(text, repo)).toEqual([
    { kind: "script", said: "bun run e2e", actual: "package.json" },
    { kind: "script", said: "make deploy", actual: "Makefile" },
    { kind: "script", said: "yarn storybook", actual: "package.json" },
    { kind: "script", said: "npm start", actual: "package.json" },
  ]);
  // a tool whose manifest isn't in the repo at all
  expect(guideDrift("`cargo test` then `make lint`", BUN_REPO)).toEqual([
    { kind: "missing", said: "cargo test", actual: "Cargo.toml" },
    { kind: "missing", said: "make lint", actual: "Makefile" },
  ]);
});

test("top-level folders the guide names that are gone", () => {
  const text = [
    "The API is in `server/routes/` and the old UI in `client/src/index.tsx`.",
    "`packages/core` is fine, `lodash/fp` is a package, `node_modules/` and `dist/` are local.",
    "```",
    "apps/",
    "legacy/   # the old site",
    "```",
  ].join("\n");
  expect(guideDrift(text, BUN_REPO)).toEqual([
    { kind: "folder", said: "server/", actual: "" },
    { kind: "folder", said: "client/", actual: "" },
    { kind: "folder", said: "legacy/", actual: "" },
  ]);
});

test("code is read from fences and inline spans, not from prose", () => {
  const { lines, spans } = guideCode("Use `bun test`.\n\n```sh\n$ bun install && bun run dev\n```\nnpm run nothing");
  expect(lines).toEqual(["$ bun install && bun run dev"]);
  expect(spans).toEqual(["bun test"]);
  expect(guideDrift("```sh\n$ bun install && bun run nope\n```", BUN_REPO)).toEqual([
    { kind: "script", said: "bun run nope", actual: "package.json" },
  ]);
});

test("makeTargets reads rules, not assignments or special targets", () => {
  expect(makeTargets("VERSION := 1\n.PHONY: build test\nbuild test: deps\n\tgo build\nlint:\n\tgolangci-lint run\n")).toEqual([
    "build",
    "test",
    "lint",
  ]);
});
