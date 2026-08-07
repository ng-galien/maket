/**
 * `maket doctor` — one-shot diagnostic. Prints one line per check with
 * ✓/⚠/✗ and a final summary. Exit 0 on all-green, 1 on any ✗. Warnings
 * don't fail the exit code.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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

interface HeadlessBrowser {
	version(): Promise<string>;
	close(): Promise<void>;
}

interface PuppeteerLauncher {
	launch(options: {
		headless: "shell";
		args: string[];
	}): Promise<HeadlessBrowser>;
}

const ICONS: Record<Level, string> = { ok: "✓", warn: "⚠", fail: "✗" };
const GMAIL_PROBE_TIMEOUT_MS = 5_000;

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

function chromiumArgs(env = process.env): string[] {
	if (env.MAKET_FORCE_NO_SANDBOX === "1") return ["--no-sandbox"];
	if (process.platform !== "linux") return [];
	if (env.GITHUB_ACTIONS === "true" || env.CI === "true" || env.CI === "1") {
		return ["--no-sandbox"];
	}
	if (typeof process.getuid === "function" && process.getuid() === 0) {
		return ["--no-sandbox"];
	}
	return [];
}

function resolvePuppeteer(): PuppeteerLauncher {
	const require = createRequire(fileURLToPath(import.meta.url));
	const module = require("puppeteer") as {
		launch?: PuppeteerLauncher["launch"];
		default?: PuppeteerLauncher;
	};
	const launch = module.default?.launch ?? module.launch;
	if (typeof launch !== "function") {
		throw new Error("puppeteer resolved but has no launch() export");
	}
	return { launch };
}

export async function checkChromium(
	launcher: PuppeteerLauncher = resolvePuppeteer(),
): Promise<Check> {
	let browser: HeadlessBrowser | undefined;
	try {
		browser = await launcher.launch({
			headless: "shell",
			args: chromiumArgs(),
		});
		return {
			level: "ok",
			line: `Chromium headless — ${await browser.version()}`,
		};
	} catch (e) {
		const detail = (e as Error).message.split("\n")[0];
		return {
			level: "fail",
			line:
				`Chromium headless — unavailable (${detail}). ` +
				"Reinstall with: npm install -g --allow-scripts=puppeteer @ng-galien/maket",
		};
	} finally {
		await browser?.close().catch(() => {});
	}
}

export async function checkGmail(
	dataDir: string,
	env: Record<string, string | undefined> = process.env,
	fetchImpl: typeof fetch = fetch,
): Promise<Check> {
	const state = readGmailState(dataDir);
	const hasEnvCredentials = Boolean(
		env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
	);
	const hasCredentials = state.hasCredentials || hasEnvCredentials;
	if (!hasCredentials && !state.hasToken) {
		return { level: "warn", line: "Gmail — not configured (optional)" };
	}
	if (hasCredentials && !state.hasToken) {
		return {
			level: "warn",
			line: "Gmail — credentials present but no refresh token. Run: maket_gmail action=connect",
		};
	}
	if (!hasCredentials && state.hasToken) {
		return {
			level: "fail",
			line: `Gmail — refresh token but no credentials at ${state.credentialsPath}`,
		};
	}
	try {
		const credentials = hasEnvCredentials
			? {
					client_id: env.GOOGLE_CLIENT_ID as string,
					client_secret: env.GOOGLE_CLIENT_SECRET as string,
				}
			: (() => {
					const file = JSON.parse(readFileSync(state.credentialsPath, "utf-8"));
					return file.installed || file.web;
				})();
		const token = JSON.parse(readFileSync(state.tokenPath, "utf-8"));
		const response = await fetchImpl("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			signal: AbortSignal.timeout(GMAIL_PROBE_TIMEOUT_MS),
			body: new URLSearchParams({
				client_id: credentials.client_id,
				client_secret: credentials.client_secret,
				refresh_token: token.refresh_token,
				grant_type: "refresh_token",
			}),
		});
		const result = (await response.json()) as {
			access_token?: unknown;
			error?: unknown;
		};
		if (response.ok && typeof result.access_token === "string") {
			return {
				level: "ok",
				line: `Gmail — connected (read scope: ${state.withRead ? "yes" : "no"})`,
			};
		}
		if (result.error === "invalid_grant") {
			return {
				level: "fail",
				line: "Gmail — refresh token expired or revoked. Reconnect with: maket_gmail action=connect",
			};
		}
		return {
			level: "fail",
			line: `Gmail — OAuth validation failed (HTTP ${response.status})`,
		};
	} catch (error) {
		return {
			level: "warn",
			line: `Gmail — configured but validation unavailable (${(error as Error).message})`,
		};
	}
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

	const [portCheck, chromiumCheck, gmailCheck, npmCheck] = await Promise.all([
		checkPort(env.port, env.host),
		checkChromium(),
		checkGmail(env.dataDir),
		checkNpmLatest(),
	]);

	const checks: Check[] = [
		checkNode(),
		portCheck,
		checkDataDir(env.dataDir),
		checkServerEntry(),
		chromiumCheck,
		gmailCheck,
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
