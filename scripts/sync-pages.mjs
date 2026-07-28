/**
 * Copy the deterministic starter bundles next to the GitHub Pages app build.
 * GitHub Pages serves docs/ at /maket/, so viewer links can open these through
 * `?src=../starters/<name>.maket` without any server or cross-origin request.
 */

import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "starters");
const TARGET = join(ROOT, "docs", "starters");

mkdirSync(TARGET, { recursive: true });
for (const filename of readdirSync(SOURCE).filter((name) => name.endsWith(".maket"))) {
  copyFileSync(join(SOURCE, filename), join(TARGET, filename));
}
