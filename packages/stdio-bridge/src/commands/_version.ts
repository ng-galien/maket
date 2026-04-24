import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Walk from the current module (or bundled entry) and return the first
 * `package.json.version` found. Candidates, in order:
 *
 *   1. `./package.json`              — bundled tarball sibling. In npm mode
 *                                      esbuild inlines every helper into
 *                                      `index.js`, so `import.meta.url`
 *                                      resolves to `dist/npm/index.js` and
 *                                      the sibling is the staged manifest.
 *   2. `../../package.json`          — dev workspace from `commands/`
 *                                      (packages/stdio-bridge/package.json).
 *   3. `../../../../package.json`    — dev monorepo root, last-resort
 *                                      fallback if a release forgot to bump
 *                                      a workspace.
 *
 * The fallback guards against the class of bug where root and workspace
 * package.json versions drift (cf. `scripts/check-versions.mjs`).
 */
let cached: string | undefined;

export function readVersion(): string {
	if (cached !== undefined) return cached;
	const here = dirname(fileURLToPath(import.meta.url));
	for (const rel of [
		["package.json"],
		["..", "..", "package.json"],
		["..", "..", "..", "..", "package.json"],
	]) {
		try {
			const pkg = JSON.parse(readFileSync(join(here, ...rel), "utf-8"));
			if (pkg?.version) {
				cached = pkg.version as string;
				return cached;
			}
		} catch {}
	}
	cached = "unknown";
	return cached;
}
