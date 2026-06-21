import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
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
	/** Write the spawned PID to this file so `maket stop` can find it later. */
	pidFile?: string;
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
 * Three modes, in priority order:
 *  1. **Packaged** — `server.js` sits next to the bin entry (the npm tarball
 *     ships both). Run it directly with the host node — no tsx, no npx fetch.
 *  2. **Workspace** — `@maket/server` resolves via Node's module algorithm
 *     (works in the monorepo where workspaces symlink the package).
 *  3. **Last-resort fallback** — climb two levels and look for
 *     `server/index.ts`. Useful when called from oddly-nested layouts.
 *
 * Modes 2 and 3 use `npx tsx` because the source is TypeScript; mode 1 ships
 * compiled JS so we save the cold-start cost.
 */
export function defaultServerCmd(
	fromFile = fileURLToPath(import.meta.url),
): string[] {
	const sibling = resolve(dirname(fromFile), "server.js");
	if (existsSync(sibling)) {
		return [process.execPath, sibling];
	}

	const require = createRequire(fromFile);
	let serverEntry: string;
	try {
		const pkgJson = require.resolve("@maket/server/package.json");
		serverEntry = resolve(dirname(pkgJson), "index.ts");
	} catch {
		serverEntry = resolve(dirname(fromFile), "..", "..", "server", "index.ts");
	}
	return ["npx", "-y", "tsx", serverEntry];
}

export async function ensureServer(opts: EnsureServerOpts): Promise<{
	started: boolean;
	alreadyRunning: boolean;
	pid?: number;
}> {
	const { port, host = "127.0.0.1", dataDir } = opts;

	if (await probeServer(port, host, 300)) {
		return { started: false, alreadyRunning: true };
	}

	let cmd = opts.cmd ?? defaultServerCmd();
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
	if (bin !== process.execPath) delete env.ELECTRON_RUN_AS_NODE;

	const outPath = join(dataDir, "server-spawn.log");
	const outFd = openSync(outPath, "a");

	const child = spawn(bin, args, {
		detached: true,
		stdio: ["ignore", outFd, outFd],
		env,
	});
	child.on("error", () => {});
	child.unref();

	const ready = await waitForServer(port, host, opts.readyTimeoutMs ?? 45_000);
	if (!ready) {
		throw new Error(
			`stdio-bridge: server did not become ready on ${host}:${port}`,
		);
	}
	if (opts.pidFile && child.pid) {
		try {
			writeFileSync(opts.pidFile, `${child.pid}\n`, "utf-8");
		} catch {}
	}
	return { started: true, alreadyRunning: false, pid: child.pid };
}
