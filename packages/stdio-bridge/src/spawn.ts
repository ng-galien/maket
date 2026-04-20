import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probeServer, waitForServer } from "./probe.ts";

export interface EnsureServerOpts {
	port: number;
	host?: string;
	dataDir: string;
	/** Override the spawn argv (useful for tests or production binaries). */
	cmd?: string[];
	/** Max total wait for readiness after spawn. */
	readyTimeoutMs?: number;
}

/**
 * Resolve a real `node` binary when the current process is Electron running
 * with ELECTRON_RUN_AS_NODE=1 (Claude Desktop case). Spawning the server with
 * Electron would trigger a 10-15s cold start from helper-app/crashpad spam;
 * falling back to system Node boots in <1s.
 *
 * Returns null when no system Node is found; caller should then fall back to
 * `process.execPath` (the Electron binary) and accept the slow cold start.
 */
export function findSystemNode(env = process.env): string | null {
	if (env.MAKET_NODE_BIN && existsSync(env.MAKET_NODE_BIN)) {
		return env.MAKET_NODE_BIN;
	}
	if (existsSync("/usr/bin/which")) {
		try {
			const out = execFileSync("/usr/bin/which", ["node"], {
				env,
				encoding: "utf-8",
			})
				.split("\n")[0]
				?.trim();
			if (out && existsSync(out) && !/Helper|Electron/i.test(out)) return out;
		} catch {}
	}
	for (const p of [
		"/opt/homebrew/bin/node",
		"/usr/local/bin/node",
		"/usr/bin/node",
	]) {
		if (existsSync(p)) return p;
	}
	return null;
}

/**
 * True when process.execPath is NOT a real `node` binary — signals that the
 * server child must be spawned with a system Node to avoid slow/flaky
 * Electron/Claude-Helper cold starts. Desktop does not reliably set
 * ELECTRON_RUN_AS_NODE in the child env, so path-name matching is used.
 */
function isNonNodeHost(): boolean {
	const base = process.execPath.split("/").pop()?.toLowerCase() ?? "";
	return base !== "node";
}

/**
 * Resolve the default server spawn command.
 *
 * Walks up from this file to the monorepo root and targets
 * `packages/server/index.ts` via `npx tsx`. In a published `.mcpb` the entry
 * will be compiled JS — callers should then pass `cmd: [node, bundledJs]`.
 */
export function defaultServerCmd(
	fromFile = fileURLToPath(import.meta.url),
): string[] {
	const require = createRequire(fromFile);
	// Resolve @maket/server's package.json to find its directory. Workspaces
	// symlink it into node_modules; this works from any sibling package.
	let serverEntry: string;
	try {
		const pkgJson = require.resolve("@maket/server/package.json");
		serverEntry = resolve(dirname(pkgJson), "index.ts");
	} catch {
		// Fallback: climb to monorepo root from this file.
		serverEntry = resolve(dirname(fromFile), "..", "..", "server", "index.ts");
	}
	return ["npx", "-y", "tsx", serverEntry];
}

export async function ensureServer(opts: EnsureServerOpts): Promise<{
	started: boolean;
	alreadyRunning: boolean;
}> {
	const { port, host = "127.0.0.1", dataDir } = opts;

	if (await probeServer(port, host, 300)) {
		return { started: false, alreadyRunning: true };
	}

	let cmd = opts.cmd ?? defaultServerCmd();
	// When the bridge runs under a non-Node host (Claude Desktop's Electron
	// helper), spawning the server with the same binary triggers slow/flaky
	// Electron cold starts. Swap to a real system Node — instant boot.
	if (isNonNodeHost() && cmd[0] === process.execPath) {
		const sysNode = findSystemNode();
		if (!sysNode) {
			throw new Error(
				"stdio-bridge: host is not a standard `node` binary and no system node was found. Install Node or set MAKET_NODE_BIN.",
			);
		}
		cmd = [sysNode, ...cmd.slice(1)];
	}
	const [bin, ...args] = cmd;
	if (!bin) throw new Error("stdio-bridge: empty server spawn command");

	mkdirSync(dataDir, { recursive: true });

	const env: Record<string, string> = {
		...process.env,
		MAKET_PORT: String(port),
		MAKET_DATA_DIR: dataDir,
	};
	// When the child is real Node (not Electron), drop ELECTRON_RUN_AS_NODE —
	// it's harmless on Node but signals intent more clearly.
	if (bin !== process.execPath) delete env.ELECTRON_RUN_AS_NODE;

	// Capture the detached server's stdio to disk — Desktop drops it otherwise,
	// and we need to see boot errors when the child crashes before listening.
	const outPath = join(dataDir, "server-spawn.log");
	const outFd = openSync(outPath, "a");

	const child = spawn(bin, args, {
		detached: true,
		stdio: ["ignore", outFd, outFd],
		env,
	});
	child.on("error", () => {});
	child.unref();

	// Electron cold start (under ELECTRON_RUN_AS_NODE) is slow: helper-app
	// FATALs + crashpad warnings consume ~10-15s before the Node server gets
	// to bind the port. Give it plenty of headroom.
	const ready = await waitForServer(port, host, opts.readyTimeoutMs ?? 45_000);
	if (!ready) {
		throw new Error(
			`stdio-bridge: server did not become ready on ${host}:${port}`,
		);
	}
	return { started: true, alreadyRunning: false };
}
