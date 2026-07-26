#!/usr/bin/env node

import { readFileSync } from "node:fs";

const version = process.argv[2]?.replace(/^v/, "");

if (!version) {
  console.error("Usage: node scripts/release-notes.mjs <version>");
  process.exit(1);
}

const lines = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").split(/\r?\n/);
const heading = `## [${version}]`;
const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));

if (start === -1) {
  console.error(`No CHANGELOG.md section found for ${version}`);
  process.exit(1);
}

const nextHeading = lines.findIndex((line, index) => index > start && /^## \[.+\]/.test(line));
const end = nextHeading === -1 ? lines.length : nextHeading;
const notes = lines
  .slice(start + 1, end)
  .join("\n")
  .trim();

if (!notes) {
  console.error(`CHANGELOG.md section for ${version} is empty`);
  process.exit(1);
}

process.stdout.write(`${notes}\n`);
