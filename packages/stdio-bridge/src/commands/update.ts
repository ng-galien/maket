/**
 * `maket update` — upgrade the headless CLI. We don't try to detect the active
 * runtime (npx vs `npm -g` vs Homebrew); if `npm install -g` fails, npm's
 * own error message is more informative than anything we'd reinvent.
 */

import { spawnSync } from "node:child_process";
import { PKG } from "./_codex-toml.ts";
import { readVersion } from "./_version.ts";

const REGISTRY_URL = `https://registry.npmjs.org/${PKG}/latest`;

export interface UpdateOpts {
	check?: boolean;
	version?: string;
}

/**
 * Fetch the latest published version. Default Accept (`application/json`) is
 * what the registry serves on `/{pkg}/latest`; the `vnd.npm.install-v1+json`
 * variant is valid on the packument route (`/{pkg}`) but returns 406 here.
 */
export async function fetchLatest(): Promise<string> {
	const r = await fetch(REGISTRY_URL);
	if (!r.ok) {
		throw new Error(`npm registry returned ${r.status} ${r.statusText}`);
	}
	const data = (await r.json()) as { version?: string };
	if (!data.version) {
		throw new Error("npm registry response missing `version` field");
	}
	return data.version;
}

/**
 * Semver comparison limited to the `X.Y.Z[-prerelease]` shape we publish.
 * Returns `<0` if `a < b`, `0` if equal, `>0` if `a > b`. Prereleases are
 * treated as "earlier than" the plain release of the same X.Y.Z (matching
 * npm's own tag-resolution default).
 */
export function compareVersions(a: string, b: string): number {
	const [aCore, aPre] = a.split("-", 2);
	const [bCore, bPre] = b.split("-", 2);
	const aParts = (aCore ?? "0")
		.split(".")
		.map((n) => Number.parseInt(n, 10) || 0);
	const bParts = (bCore ?? "0")
		.split(".")
		.map((n) => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < 3; i++) {
		const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
		if (diff !== 0) return diff;
	}
	if (aPre && !bPre) return -1;
	if (!aPre && bPre) return 1;
	if (aPre && bPre) return aPre.localeCompare(bPre);
	return 0;
}

async function runCheck(): Promise<void> {
	const current = readVersion();
	let latest: string;
	try {
		latest = await fetchLatest();
	} catch (e) {
		process.stderr.write(
			`maket update --check: failed to reach npm registry — ${(e as Error).message}\n`,
		);
		process.exitCode = 1;
		return;
	}
	process.stdout.write(`current: ${current}\nlatest:  ${latest}\n`);
	const cmp = compareVersions(current, latest);
	if (cmp < 0) {
		process.stdout.write(`\nUpdate available. Run: maket update\n`);
		process.exitCode = 1;
	} else {
		process.stdout.write("\nUp to date.\n");
	}
}

export function updateInstallArgs(target: string): string[] {
	return ["install", "-g", "--allow-scripts=puppeteer", `${PKG}@${target}`];
}

function runInstall(target: string): void {
	const npm = process.platform === "win32" ? "npm.cmd" : "npm";
	const args = updateInstallArgs(target);
	process.stdout.write(`maket: running \`npm ${args.join(" ")}\`\n`);
	const r = spawnSync(npm, args, { stdio: "inherit" });
	if (r.status !== 0) {
		process.exitCode = r.status ?? 1;
	}
}

export async function runUpdate(opts: UpdateOpts = {}): Promise<void> {
	if (opts.check) {
		await runCheck();
		return;
	}
	runInstall(opts.version ?? "latest");
}
