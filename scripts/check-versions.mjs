#!/usr/bin/env node
/**
 * check-versions — fail if any workspace package.json version drifts from
 * the root. Wired into `npm run quality` so a release bump that forgets a
 * workspace can't land.
 *
 * Usage:
 *   node scripts/check-versions.mjs
 *
 * Exit codes:
 *   0 — all aligned
 *   1 — drift detected
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
const expected = rootPkg.version;

const workspaces = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => join(ROOT, "packages", d.name, "package.json"));

const drift = [];
for (const file of workspaces) {
	const pkg = JSON.parse(readFileSync(file, "utf-8"));
	if (pkg.version !== expected) {
		drift.push({ file, version: pkg.version, name: pkg.name });
	}
}

if (drift.length === 0) {
	process.stdout.write(`check-versions: ok (all packages at ${expected})\n`);
	process.exit(0);
}

process.stderr.write(
	`check-versions: drift — root is ${expected}, but:\n`,
);
for (const d of drift) {
	process.stderr.write(`  ${d.name}: ${d.version}  (${d.file})\n`);
}
process.stderr.write(
	"\nFix: node scripts/bump-version.mjs <version>\n",
);
process.exit(1);
