# Credits and licences: world.html

Everything in world.html is drawn in code for this project (objects, characters, worlds, rings, motion), except the assets below. Only open-licence sources are used.

## Assets in use

| Asset | Used for | Source | Licence |
| --- | --- | --- | --- |
| DiceBear “Constellation” (4 SVGs, seeded by project: Honeycrust, Fernway, Bluekite, Potluck) | Observatory: each project’s constellation | https://api.dicebear.com/10.x/constellation/svg?seed=… (style by DiceBear, https://www.dicebear.com) | CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/), stated in each SVG’s metadata and on https://www.dicebear.com/licenses/ |

The originals are kept unmodified in `assets/dicebear/`. world.html inlines a recoloured copy (the stroke colour is replaced with `currentColor`, the background is dropped); the build step is `build_assets.py` in the scratchpad.

## Fonts (Google Fonts)

| Font | Used for | Licence |
| --- | --- | --- |
| Atkinson Hyperlegible Next, Atkinson Hyperlegible Mono (Braille Institute) | Every world: words and headings; data | SIL Open Font Licence 1.1 |
| Cormorant Garamond | Observatory's greeting | SIL Open Font Licence 1.1 |
| Overpass | Transit's greeting | SIL Open Font Licence 1.1 |
| Zen Old Mincho | Koi's greeting | SIL Open Font Licence 1.1 |
| Fraunces | Catnap's greeting (Archivo Narrow for Brigade, after launch) | SIL Open Font Licence 1.1 |

## Planned (not yet in the file)

| Asset | For | Source | Licence |
| --- | --- | --- | --- |
| Quaternius animated cat models (glTF), rendered to sprite sheets | Catnap cats (after launch) | https://quaternius.com (Ultimate Animated Animal Pack and related packs) | CC0 1.0: confirm on the pack page at download |
| Generated ground art | Each world’s ground layer | Z-Image Turbo, Qwen-Image-2512 via mflux, vectorised with vtracer | Model weights Apache-2.0; mflux MIT; vtracer MIT |
