#!/usr/bin/env node
// Print a draft [Unreleased] section for CHANGELOG.md, built from the git
// log since the last tag (or since a given ref). Commits are grouped by
// conventional-commit type and mapped to Keep-a-Changelog sections. Nothing
// is written — paste the output into CHANGELOG.md and edit.
//
// Usage:
//   node scripts/changelog-draft.mjs              # since last tag
//   node scripts/changelog-draft.mjs v1.0.1       # since given ref
//   node scripts/changelog-draft.mjs HEAD~20      # arbitrary range

import { execSync } from "node:child_process";

const sinceArg = process.argv[2];

function run(cmd) {
  return execSync(cmd, { encoding: "utf-8" }).trim();
}

function lastTag() {
  try {
    return run("git describe --tags --abbrev=0");
  } catch {
    return null;
  }
}

const since = sinceArg ?? lastTag();
if (!since) {
  console.error("No tag found and no ref given. Pass a ref, e.g.:");
  console.error("  node scripts/changelog-draft.mjs HEAD~20");
  process.exit(1);
}

const range = `${since}..HEAD`;
const raw = run(`git log --pretty=format:%s%x09%h ${range}`);

if (!raw) {
  console.log(`(no commits since ${since})`);
  process.exit(0);
}

/** Conventional-commit type → Keep-a-Changelog bucket. */
const SECTION = {
  feat: "Added",
  fix: "Fixed",
  security: "Security",
  perf: "Changed",
  refactor: "Changed",
  revert: "Changed",
  // Not user-facing by default — bucketed under Internal.
  chore: "Internal",
  ci: "Internal",
  docs: "Internal",
  test: "Internal",
  style: "Internal",
  build: "Internal",
  deps: "Internal",
};

const order = ["Added", "Changed", "Fixed", "Security", "Internal"];
const buckets = Object.fromEntries(order.map((k) => [k, []]));

for (const line of raw.split("\n")) {
  const [subject, sha] = line.split("\t");
  const match = subject.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
  if (!match) {
    buckets.Internal.push({ scope: null, text: subject, sha });
    continue;
  }
  const [, type, scope, text] = match;
  const section = SECTION[type] ?? "Changed";
  buckets[section].push({ scope, text, sha });
}

const out = [`## [Unreleased]`, ""];
for (const section of order) {
  const items = buckets[section];
  if (!items.length) continue;
  out.push(`### ${section}`);
  for (const { scope, text, sha } of items) {
    const prefix = scope ? `**${scope}** — ` : "";
    out.push(`- ${prefix}${text} (${sha})`);
  }
  out.push("");
}

process.stdout.write(out.join("\n"));
