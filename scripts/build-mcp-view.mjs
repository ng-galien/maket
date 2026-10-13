#!/usr/bin/env node
// Builds the Maket reader for MCP Apps hosts into one self-contained HTML
// file, mcp-views/maket-reader.html: the client is built in the mcp-view
// mode, then its script and style are inlined. The page's own CSP allows
// only that script, by hash, so no inline handler or javascript: URL of a
// page can run; styles and fonts come from the charte font hosts only.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const views = join(root, "mcp-views");
const build = join(views, ".build");

// A production build whoever runs it: a test runner sets NODE_ENV=test,
// which would ship React's development build.
execFileSync("npx", ["vite", "build", "--mode", "mcp-view"], {
  cwd: join(root, "packages", "client"),
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});

const html = readFileSync(join(build, "mcp-view.html"), "utf8");
const assets = join(build, "assets");
const files = readdirSync(assets);
const scripts = files.filter((file) => file.endsWith(".js"));
const styles = files.filter((file) => file.endsWith(".css"));
if (scripts.length !== 1) throw new Error(`Expected one script chunk, found ${scripts.join(", ")}`);

const script = readFileSync(join(assets, scripts[0]), "utf8").replaceAll("</script", "<\\/script");
const style = styles
  .map((file) => readFileSync(join(assets, file), "utf8"))
  .join("\n")
  .replaceAll("</style", "<\\/style");
const hash = createHash("sha256").update(script).digest("base64");
const fontHosts = "https://fonts.googleapis.com https://fonts.gstatic.com https://fonts.bunny.net";
const csp = [
  "default-src 'none'",
  `script-src 'sha256-${hash}'`,
  `style-src 'unsafe-inline' ${fontHosts}`,
  `font-src data: ${fontHosts}`,
  "img-src data:",
  "media-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const page = html
  .replace(/<script type="module"[^>]*src="[^"]+"[^>]*><\/script>\s*/g, "")
  .replace(/<link rel="stylesheet"[^>]*>\s*/g, "")
  .replace(/<link rel="modulepreload"[^>]*>\s*/g, "")
  .replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`)
  .replace("</head>", () => `    <style>${style}</style>\n  </head>`)
  .replace("</body>", () => `    <script type="module">${script}</script>\n  </body>`);
if (page.includes('src="./assets/') || page.includes('href="./assets/'))
  throw new Error("The reader still references a built asset file.");

writeFileSync(join(views, "maket-reader.html"), page);
rmSync(build, { recursive: true, force: true });
console.log(
  `mcp-views/maket-reader.html: ${Buffer.byteLength(page)} bytes (script ${Buffer.byteLength(script)}, style ${Buffer.byteLength(style)})`,
);
