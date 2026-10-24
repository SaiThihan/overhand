## What and why

<!-- One or two sentences. -->

## Done means everywhere

<!-- Tick what this change touches, or strike out what it doesn't. See CONTRIBUTING.md#done-means-everywhere. -->

- [ ] App and its words (`apps/web`, `packages/themes/src/words.ts`)
- [ ] Demo data (`apps/web/src/demo`)
- [ ] Site pages and claims (`site/pages`, `site/site.ts`, `packages/contract`)
- [ ] Site colours in light and dark (`packages/themes/src/system.ts`; `bun run shots` sweeps both)
- [ ] Docs pages (`site/pages/docs`), through slots, not retyped text
- [ ] Setup guide (`site/pages/setup.md`)
- [ ] Feature registry (`packages/contract/src/features.ts`)
- [ ] llms files and the agent skill (`site/build.ts`, `skills/overhand/SKILL.md`)

## Checks

- [ ] `bunx tsc --noEmit`, `bun run lint` and `bun run test` pass
- [ ] I agree to the [contributor licence agreement](../CLA.md) for this contribution
