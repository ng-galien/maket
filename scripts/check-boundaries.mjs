import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SOURCE_EXTS = new Set([".ts", ".tsx", ".mts", ".cts", ".mjs"]);

const zones = [
  {
    name: "shared",
    root: "packages/shared/src",
    forbidden: [
      "@maket/client",
      "@maket/server",
      "@maket/stdio-bridge",
      "react",
      "react-dom",
      "zustand",
      "express",
      "ws",
      "node:",
      "../client",
      "../server",
      "../stdio-bridge",
    ],
  },
  {
    name: "client",
    root: "packages/client/src",
    forbidden: ["@maket/server", "@maket/stdio-bridge", "../server", "../stdio-bridge"],
  },
  {
    name: "server",
    root: "packages/server/src",
    forbidden: ["@maket/client", "../client"],
  },
  {
    name: "stdio-bridge",
    root: "packages/stdio-bridge/src",
    forbidden: ["@maket/client"],
  },
];

const errors = [];

for (const zone of zones) {
  for (const file of sourceFiles(join(ROOT, zone.root))) {
    const imports = importedSpecifiers(readFileSync(file, "utf8"));
    for (const specifier of imports) {
      if (zone.forbidden.some((rule) => violates(specifier, rule))) {
        errors.push(`${relative(ROOT, file)} imports forbidden boundary "${specifier}"`);
      }
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(`Boundary check failed:\n${errors.map((e) => `- ${e}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Boundary check passed.\n");

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...sourceFiles(path));
      continue;
    }
    const ext = entry.name.slice(entry.name.lastIndexOf("."));
    if (SOURCE_EXTS.has(ext)) out.push(path);
  }
  return out;
}

function importedSpecifiers(source) {
  const specs = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?[^'"]*?\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specs.push(match[1]);
    }
  }
  return specs;
}

function violates(specifier, rule) {
  if (rule.endsWith(":")) return specifier.startsWith(rule);
  if (!specifier.startsWith(".")) {
    return specifier === rule || specifier.startsWith(`${rule}/`);
  }
  if (!rule.startsWith(".")) return false;
  return specifier.split("/").join(sep).includes(rule.split("/").join(sep));
}
