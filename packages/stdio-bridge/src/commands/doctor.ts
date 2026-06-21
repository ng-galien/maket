/**
 * `maket doctor` — one-shot diagnostic. Prints one line per check with
 * ✓/⚠/✗ and a final summary. Exit 0 on all-green, 1 on any ✗. Warnings
 * don't fail the exit code.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { probeServer } from "../probe.ts";
import { hasBin } from "./_bin.ts";
import { type MaketEnvOverrides, readEnv } from "./_env.ts";
import { readGmailState } from "./_gmail-state.ts";
import { readVersion } from "./_version.ts";
import { compareVersions, fetchLatest } from "./update.ts";

type Level = "ok" | "warn" | "fail";
interface Check {
	level: Level;
	line: string;
}

const ICONS: Record<Level, string> = { ok: "✓", warn: "⚠", fail: "✗" };

function checkNode(): Check {
	const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
	if (major >= 22)
		return { level: "ok", line: `Node ${process.versions.node}` };
	return {
		level: "fail",
		line: `Node ${process.versions.node} — need ≥22.0.0 (see package.json engines)`,
	};
}

async function checkPort(port: number, host: string): Promise<Check> {
	if (await probeServer(port, host, 400)) {
		return {
			level: "ok",
			line: `Port ${port} — server responding on ${host}:${port}`,
		};
	}
	if (await isPortFree(port, host)) {
		return {
			level: "ok",
			line: `Port ${port} — free on ${host} (server not running)`,
		};
	}
	return {
		level: "fail",
		line: `Port ${port} — busy on ${host} but not answering MCP probe (another process is bound)`,
	};
}

function isPortFree(port: number, host: string): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.once("error", () => {
			server.close();
			resolve(false);
		});
		server.listen(port, host, () => {
			server.close(() => resolve(true));
		});
	});
}

function checkDataDir(dataDir: string): Check {
	try {
		mkdirSync(dataDir, { recursive: true });
		const probe = join(dataDir, `.doctor-${Date.now()}`);
		writeFileSync(probe, "");
		rmSync(probe);
		return { level: "ok", line: `Data dir ${dataDir} — writable` };
	} catch (e) {
		return {
			level: "fail",
			line: `Data dir ${dataDir} — not writable (${(e as Error).message})`,
		};
	}
}

function checkChromium(): Check {
	try {
		const require = createRequire(fileURLToPath(import.meta.url));
		const puppeteer = require("puppeteer") as {
			executablePath?: () => string;
			default?: { executablePath?: () => string };
		};
		const fn = puppeteer.executablePath ?? puppeteer.default?.executablePath;
		if (!fn) {
			return {
				level: "warn",
				line: "Chromium — puppeteer resolved but no executablePath() export",
			};
		}
		const path = fn();
		if (!existsSync(path)) {
			return {
				level: "warn",
				line: `Chromium — puppeteer expects ${path} but it's missing. Run: npx puppeteer browsers install chrome`,
			};
		}
		return { level: "ok", line: `Chromium — ${path}` };
	} catch (e) {
		return {
			level: "warn",
			line: `Chromium — puppeteer not resolvable (${(e as Error).message})`,
		};
	}
}

function checkGmail(dataDir: string): Check {
	const state = readGmailState(dataDir);
	if (!state.hasCredentials && !state.hasToken) {
		return { level: "warn", line: "Gmail — not configured (optional)" };
	}
	if (state.hasCredentials && !state.hasToken) {
		return {
			level: "warn",
			line: "Gmail — credentials present but no refresh token. Run: maket_gmail action=connect",
		};
	}
	if (!state.hasCredentials && state.hasToken) {
		return {
			level: "fail",
			line: `Gmail — refresh token but no credentials at ${state.credentialsPath}`,
		};
	}
	return {
		level: "ok",
		line: `Gmail — configured (read scope: ${state.withRead ? "yes" : "no"})`,
	};
}

function checkServerEntry(): Check {
	try {
		const require = createRequire(fileURLToPath(import.meta.url));
		require.resolve("@maket/server/package.json");
		return { level: "ok", line: "Server entry — @maket/server resolvable" };
	} catch {
		const here = fileURLToPath(new URL(".", import.meta.url));
		const sibling = join(here, "server.js");
		if (existsSync(sibling)) {
			return { level: "ok", line: `Server entry — ${sibling} (bundled)` };
		}
		return {
			level: "fail",
			line: "Server entry — @maket/server unresolvable and no bundled server.js sibling",
		};
	}
}

async function checkNpmLatest(): Promise<Check> {
	const current = readVersion();
	try {
		const latest = await fetchLatest();
		if (compareVersions(current, latest) < 0) {
			return {
				level: "warn",
				line: `Version ${current} — update available (${latest}). Run: maket update`,
			};
		}
		return { level: "ok", line: `Version ${current} — up to date` };
	} catch (e) {
		return {
			level: "warn",
			line: `npm registry — unreachable (${(e as Error).message})`,
		};
	}
}

function checkClaudeCli(): Check {
	if (hasBin("claude")) {
		return {
			level: "ok",
			line: "claude CLI — available (install/uninstall can delegate)",
		};
	}
	return {
		level: "warn",
		line: "claude CLI — not on PATH (install/uninstall fall back to JSON edit)",
	};
}

export async function runDoctor(
	overrides: MaketEnvOverrides = {},
): Promise<void> {
	const env = readEnv(overrides);

	const [portCheck, npmCheck] = await Promise.all([
		checkPort(env.port, env.host),
		checkNpmLatest(),
	]);

	const checks: Check[] = [
		checkNode(),
		portCheck,
		checkDataDir(env.dataDir),
		checkServerEntry(),
		checkChromium(),
		checkGmail(env.dataDir),
		checkClaudeCli(),
		npmCheck,
	];

	process.stdout.write("maket doctor\n");
	for (const c of checks)
		process.stdout.write(`  ${ICONS[c.level]} ${c.line}\n`);

	const fails = checks.filter((c) => c.level === "fail").length;
	const warns = checks.filter((c) => c.level === "warn").length;
	const oks = checks.filter((c) => c.level === "ok").length;

	process.stdout.write(`\nsummary: ${oks} ok, ${warns} warn, ${fails} fail\n`);
	if (fails > 0) process.exitCode = 1;
}
