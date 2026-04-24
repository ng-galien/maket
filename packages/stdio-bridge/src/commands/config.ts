/**
 * `maket config` — print the resolved runtime config after the full
 * precedence chain (CLI flag > env var > default) has been applied. No
 * mutation; useful when the user is unsure which MAKET_* variable won.
 */

import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { defaultServerCmd } from "../spawn.ts";
import { type MaketEnvOverrides, readEnv } from "./_env.ts";
import { readGmailState } from "./_gmail-state.ts";
import { readVersion } from "./_version.ts";

/**
 * Resolve the server spawn command that `maket bridge` / `maket start` would
 * actually use. MAKET_SERVER_ENTRY wins when set to a valid absolute path;
 * otherwise `defaultServerCmd()` locates either the packaged `server.js`
 * sibling or the workspace `@maket/server/index.ts`.
 */
function resolvedServerEntry(): string {
	const entry = process.env.MAKET_SERVER_ENTRY;
	if (entry && isAbsolute(entry) && existsSync(entry)) {
		return `${entry} (MAKET_SERVER_ENTRY)`;
	}
	return defaultServerCmd().join(" ");
}

export function runConfig(overrides: MaketEnvOverrides = {}): void {
	const env = readEnv(overrides);
	const gmail = readGmailState(env.dataDir);
	const gmailLine =
		gmail.hasCredentials && gmail.hasToken
			? `configured (read: ${gmail.withRead ? "yes" : "no"})`
			: "not configured";

	const lines: [string, string][] = [
		["version", readVersion()],
		["node", process.version.replace(/^v/, "")],
		["host", env.host],
		["port", String(env.port)],
		["dataDir", env.dataDir],
		["serverEntry", resolvedServerEntry()],
		["bridgeLog", env.bridgeLog],
		["serverLog", env.serverSpawnLog],
		["gmail", gmailLine],
	];

	const pad = Math.max(...lines.map(([k]) => k.length));
	for (const [k, v] of lines) {
		process.stdout.write(`${k.padEnd(pad)}  ${v}\n`);
	}
}
