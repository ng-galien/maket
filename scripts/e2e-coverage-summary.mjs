#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rows = [];
for (const side of ["client", "server"]) {
	const directory = path.join(ROOT, "coverage/e2e", side);
	const summary = JSON.parse(
		await readFile(path.join(directory, "coverage-summary.json"), "utf8"),
	).total;
	const inventory = JSON.parse(
		await readFile(path.join(directory, "inventory.json"), "utf8"),
	);
	rows.push({ side, summary, inventory });
}

const markdown = [
	"## Playwright E2E coverage baseline",
	"",
	"| Runtime | Lines | Branches | Functions | Files with executed lines | Zero-line files |",
	"| --- | ---: | ---: | ---: | ---: | ---: |",
	...rows.map(
		({ side, summary, inventory }) =>
			`| ${side} | ${summary.lines.pct}% | ${summary.branches.pct}% | ${summary.functions.pct}% | ${inventory.covered.length}/${inventory.inScope} | ${inventory.uncovered.length} |`,
	),
	"",
	"Informational baseline only; no E2E threshold is enforced.",
	"",
].join("\n");

process.stdout.write(markdown);
if (process.env.GITHUB_STEP_SUMMARY) {
	await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
}
