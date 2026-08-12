import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "./coverage-test";

const ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
const SERVER_ENTRY = path.join(ROOT, "packages/server/index.ts");
const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;

interface IsolatedServer {
	process: ChildProcess;
	url: string;
}

export const test = base.extend({
	baseURL: async (
		// Playwright requires an object destructuring pattern for fixture deps.
		// biome-ignore lint/correctness/noEmptyPattern: no fixture dependency is needed here
		{},
		use,
	) => {
		const dataDir = await mkdtemp(path.join(tmpdir(), "maket-playwright-"));
		const server = await startServer(dataDir);
		try {
			await use(server.url);
		} finally {
			await stopServer(server.process);
			await rm(dataDir, { recursive: true, force: true });
		}
	},
});

export { expect };

async function startServer(dataDir: string): Promise<IsolatedServer> {
	const child = spawn(process.execPath, [TSX_CLI, SERVER_ENTRY], {
		cwd: ROOT,
		env: {
			...process.env,
			MAKET_PORT: "0",
			MAKET_DATA_DIR: dataDir,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	let output = "";
	const listening = new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(
				new Error(`Timed out waiting for isolated Maket server.\n${output}`),
			);
		}, START_TIMEOUT_MS);
		const capture = (chunk: Buffer) => {
			output += chunk.toString();
			const match = output.match(/HTTP listening on 127\.0\.0\.1:(\d+)/);
			if (!match?.[1]) return;
			clearTimeout(timer);
			resolve(`http://127.0.0.1:${match[1]}`);
		};
		child.stdout?.on("data", capture);
		child.stderr?.on("data", capture);
		child.once("exit", (code, signal) => {
			clearTimeout(timer);
			reject(
				new Error(
					`Isolated Maket server exited before listening (${signal ?? code}).\n${output}`,
				),
			);
		});
	});

	try {
		return { process: child, url: await listening };
	} catch (error) {
		child.kill("SIGTERM");
		throw error;
	}
}

async function stopServer(child: ChildProcess): Promise<void> {
	if (child.exitCode != null || child.signalCode != null) return;
	child.kill("SIGTERM");
	const exited = once(child, "exit").then(() => undefined);
	const timedOut = new Promise<void>((resolve) => {
		setTimeout(resolve, STOP_TIMEOUT_MS);
	});
	await Promise.race([exited, timedOut]);
	if (child.exitCode == null && child.signalCode == null) {
		child.kill("SIGKILL");
		await once(child, "exit");
	}
}
