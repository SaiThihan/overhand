# Contributing

Thanks for helping. Overhand is TypeScript end to end, run with [Bun](https://bun.sh).

## Licence

Overhand is fair source ([FSL-1.1-ALv2](LICENSE.md)); `packages/contract` and `packages/themes` are Apache-2.0. By
opening a pull request you agree to the [contributor licence agreement](CLA.md): you keep your copyright, and the
project can ship your change under the FSL, a commercial licence, and Apache-2.0 when a release converts. Tick the box
in the pull request template to confirm. The docs, the agent skill and the llms files are [CC0 1.0](LICENSE-docs).

## Layout

`packages/contract` is the typed API between daemon and dashboard, `packages/core` the daemon, `packages/themes` every
theme's colours, type and words, `apps/web` the React dashboard, `site/` the public site and docs, and `release/` the
packages and the installer.

## Setup

```sh
bun install
bun run --filter web build
bun run.ts daemon        # dashboard on http://127.0.0.1:4317
```

Running from a checkout keeps config and state in the checkout. To try a clean first run, point `OVERHAND_HOME` at an empty
folder and `OVERHAND_PORT` at a free port: `OVERHAND_HOME=$(mktemp -d) OVERHAND_PORT=4320 bun run.ts daemon`.

## Before a pull request

```sh
bunx tsc --noEmit && (cd apps/web && bunx tsc --noEmit)
bun run lint
bun run test             # uses a scratch OVERHAND_HOME; it never touches your own state
bash release/smoke.sh    # builds the release binary and pokes a daemon on a free port with a scratch home
```

CI runs the same checks, the web build and the smoke test on every pull request to `main` (and on pushes to it).

For a change to the dashboard or the landing page, also run the responsive sweep:

```sh
bun run shots            # builds the web app, then every screen × 16 sizes (320px phone to 5120px ultra-wide) × 5 themes
bun run shots --viewports 390x844,1440x900 --themes observatory --screens now,work --no-build   # a quick subset
```

It serves the landing page and the demo locally, screenshots each frame and checks the DOM: the page scrolling
sideways, controls overlapping and, on the site (swept in light and dark), text under WCAG AA contrast are hard
failures (exit 1); clipped text, tap targets under 32px on touch sizes,
text under 11px, reading lines over ~95 characters and badly used ultra-wide width are listed as soft findings. Open
`release/out/shots/index.html` for the contact sheet; `report.json` has every finding. It uses `playwright-core` (a dev
dependency) and its Chromium: `bunx playwright-core install chromium-headless-shell` once, or point
`PLAYWRIGHT_BROWSERS_PATH` at an existing install. The release preflight runs it and blocks on hard failures.

- One change per pull request, with a test for any logic it adds.
- TypeScript strict: no `any`, no non-null `!`, no double casts.
- Commit messages follow Conventional Commits: `feat(scope): …`, `fix(scope): …`.
- Every dashboard label comes from the plain words (`packages/themes/src/words.ts`); worlds don't reword them.

## Done means everywhere

Overhand is built by agents, so nothing may go stale. A change ships in one pull request with every place it shows:

| Update | Where | What fails when it's stale |
| :-- | :-- | :-- |
| The app | `apps/web`, its words in `packages/themes/src/words.ts` | `bunx tsc --noEmit`, `bun run test` |
| Demo data | `apps/web/src/demo` (the sample night and month) | `bun run test`: every minute of the night is a valid dashboard state |
| Site pages | `site/pages`, claims through `site/site.ts` slots | `bun run test` (`site/build.test.ts`), `bun run brand` + `git diff --exit-code` in CI |
| Site colours, light and dark | `packages/themes/src/system.ts` only (the site follows the computer; pages read `var(--…)`) | `site/build.test.ts`, `packages/themes/test/one-source.test.ts`, `bun run shots` (site in both, contrast) |
| Docs | `site/pages/docs`; controls as `{{w.key}}`, defaults as `{{cfg.path}}`, commands and messages as the code has them | `site/build.test.ts`: unknown slots, commands the CLI lacks, `<samp>` messages the code doesn't print, broken links |
| Setup guide | `site/pages/setup.md` | `site/build.test.ts`: only commands the CLI has |
| Features | `packages/contract/src/features.ts` | `site/build.test.ts`: each feature built, its docs anchor real |
| Claims | `packages/contract/src/guard.ts` and the other `CLAIMS` sources | `packages/core/test/guard-parity.test.ts`, `site/build.test.ts` |
| llms files and Markdown pages | built by `site/build.ts` from the docs | `site/build.test.ts`: each `.md` page matches its HTML page |
| The agent skill | `skills/overhand/SKILL.md` | `site/build.test.ts`: frontmatter, install command and every command it names |
| Words said once | everything above | `release/dupes.test.ts`: no sentence of 8+ words twice |

## Themes

A theme is a `defineTheme()` in `packages/themes/src/<id>/`: colours (each text colour must reach WCAG AA, which the
tests check), fonts, the scene it draws the world as and, at most, its own greeting and flavour lines
(`FLAVOUR_KEYS`); every other word is the house's. Copy `observatory` to start, and add its world to `apps/web/src/map/worlds`.

## Releasing

Maintainers only. Bump `version` in the root `package.json` in a pull request, merge it, then on an up-to-date `main`:

```sh
bun release/launch.ts --dry-run   # reads state and prints every step; changes nothing
bun release/launch.ts
```

It runs preflight (the repo and `origin` are `craftly-io/overhand`, on `main`, clean tree, CI green on HEAD, leakcheck, tests, version not yet tagged, the `NPM_TOKEN`
secret, the tap repo, wrangler signed in, the responsive sweep has no hard failures), then: makes the repo public if it isn't yet, tags `vX.Y.Z` and waits for the
release workflow (which builds the packages and, from a public repo, publishes the `overhand` npm launcher in
`release/npm`), deploys the site and the installer, installs from `get.overhand.dev` into a scratch HOME and
checks the version, checks `npx overhand@X.Y.Z`, writes the Homebrew formula from the release's `SHA256SUMS`
(`release/formula.ts`) and pushes it to `craftly-io/homebrew-tap`, and prints the announcement. Each step skips itself
once done, so after a failure, fix the cause and run it again.

The first release is the same command. The installer and the landing page need no edit for it: both check whether the
latest release downloads without a login (the installer on every request, the landing page's `live.css` on every
deploy), and show "not public yet" until it does.

One secret: `NPM_TOKEN`, an npm access token that can publish `overhand`
(`gh secret set NPM_TOKEN -R craftly-io/overhand`).
