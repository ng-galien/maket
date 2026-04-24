#!/usr/bin/env node
/**
 * bump-version — set the root + every workspace package.json to the same
 * version in one shot. Run before `chore(release): vX.Y.Z`.
 *
 * Usage:
 *   node scripts/bump-version.mjs 1.2.0
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
	process.stderr.write(
		"usage: node scripts/bump-version.mjs <semver>\n" +
			"       e.g. node scripts/bump-version.mjs 1.2.0\n",
	);
	process.exit(1);
}

/**
 * Rewrite `"version": "..."` in-place without touching key order or the
 * file's indent style. `JSON.stringify` would renormalize tabs → spaces and
 * lose trailing newlines, which would churn every release commit.
 */
function rewriteVersion(file) {
	const src = readFileSync(file, "utf-8");
	const next = src.replace(
		/("version"\s*:\s*")[^"]+(")/,
		`$1${version}$2`,
	);
	if (next === src) {
		process.stderr.write(`bump-version: no version field in ${file}\n`);
		process.exit(1);
	}
	writeFileSync(file, next);
}

const targets = [join(ROOT, "package.json")];
for (const d of readdirSync(join(ROOT, "packages"), { withFileTypes: true })) {
	if (d.isDirectory()) {
		targets.push(join(ROOT, "packages", d.name, "package.json"));
	}
}

for (const file of targets) {
	rewriteVersion(file);
	process.stdout.write(`bump-version: ${file} → ${version}\n`);
}
