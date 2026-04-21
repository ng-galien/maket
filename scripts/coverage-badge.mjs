#!/usr/bin/env node

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [, , summaryArg = "coverage/coverage-summary.json", outputArg] = process.argv;

const summaryPath = resolve(process.cwd(), summaryArg);
const outputPath = resolve(process.cwd(), outputArg ?? ".github/badges/coverage.json");

/** @typedef {{ pct?: number }} CoverageMetric */
/** @typedef {{ total?: { lines?: CoverageMetric, statements?: CoverageMetric, branches?: CoverageMetric, functions?: CoverageMetric } }} CoverageSummary */

/** @returns {CoverageSummary} */
function loadSummary(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function asPercent(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "0.0";
}

function badgeColor(linesPct) {
  if (linesPct >= 90) return "brightgreen";
  if (linesPct >= 80) return "green";
  if (linesPct >= 70) return "yellowgreen";
  if (linesPct >= 60) return "yellow";
  if (linesPct >= 50) return "orange";
  return "red";
}

const summary = loadSummary(summaryPath);
const linesPct = summary.total?.lines?.pct ?? 0;
const statementsPct = summary.total?.statements?.pct ?? 0;
const branchesPct = summary.total?.branches?.pct ?? 0;
const functionsPct = summary.total?.functions?.pct ?? 0;

const badge = {
  schemaVersion: 1,
  label: "coverage",
  message: `${asPercent(linesPct)}% lines`,
  color: badgeColor(linesPct),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(badge, null, 2)}\n`, "utf-8");

const rows = [
  ["Lines", linesPct],
  ["Statements", statementsPct],
  ["Branches", branchesPct],
  ["Functions", functionsPct],
];

process.stdout.write(rows.map(([label, pct]) => `${label}: ${asPercent(pct)}%`).join("\n") + "\n");

if (process.env.GITHUB_STEP_SUMMARY) {
  const markdown = [
    "## Coverage",
    "",
    "| Metric | % |",
    "| --- | ---: |",
    ...rows.map(([label, pct]) => `| ${label} | ${asPercent(pct)} |`),
    "",
  ].join("\n");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
}
