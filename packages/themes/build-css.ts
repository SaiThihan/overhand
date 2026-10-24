/** Writes system.css from src/system.ts: bun packages/themes/build-css.ts (root script: `bun run build:css`). */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { systemCss } from "./src/system";

writeFileSync(join(import.meta.dir, "system.css"), systemCss());
