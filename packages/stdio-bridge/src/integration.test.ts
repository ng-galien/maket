/**
 * Public-boundary test: SDK v2 stdio client → Maket stdio gateway → SDK v2
 * HTTP client → live Maket server. Protocol-era handling stays inside the SDK.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	Client,
	type VersionNegotiationMode,
} from "@modelcontextprotocol/client";
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/client/stdio";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
	createMcpHandler,
	fromJsonSchema,
	McpServer,
} from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waitForServer } from "./probe.ts";

const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);
const SERVER_ENTRY = join(REPO_ROOT, "packages/server/index.ts");
const BRIDGE_ENTRY = join(REPO_ROOT, "packages/stdio-bridge/src/index.ts");

function pickFreePort(): Promise<number> {
	return new Promise((res, rej) => {
		const srv = createNetServer();
		srv.once("error", rej);
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address();
			if (typeof addr === "object" && addr) {
				const port = addr.port;
				srv.close(() => res(port));
			} else rej(new Error("no address"));
		});
	});
}

async function connectStdioClient(
	port: number,
	dataDir: string,
	mode: VersionNegotiationMode,
): Promise<Client> {
	const client = new Client(
		{ name: "stdio-sdk-integration", version: "1" },
		{ versionNegotiation: { mode } },
	);
	await client.connect(
		new StdioClientTransport({
			command: "npx",
			args: ["tsx", BRIDGE_ENTRY, "bridge"],
			cwd: REPO_ROOT,
			stderr: "pipe",
			env: {
				...getDefaultEnvironment(),
				MAKET_PORT: String(port),
				MAKET_HOST: "127.0.0.1",
				MAKET_DATA_DIR: dataDir,
			},
		}),
	);
	return client;
}

describe("MCP v2 stdio gateway ↔ live Maket server", () => {
	let child: ChildProcess | null = null;
	let port = 0;
	let dataDir = "";

	beforeAll(async () => {
		port = await pickFreePort();
		dataDir = mkdtempSync(join(tmpdir(), "maket-bridge-it-"));

		child = spawn("npx", ["tsx", SERVER_ENTRY], {
			cwd: REPO_ROOT,
			stdio: ["ignore", "ignore", "pipe"],
			env: {
				...process.env,
				MAKET_PORT: String(port),
				MAKET_DATA_DIR: dataDir,
			},
		});
		child.stderr?.on("data", () => {
			/* failures surface through the readiness timeout */
		});

		const ready = await waitForServer(port, "127.0.0.1", 30_000, 250);
		if (!ready) throw new Error(`server never bound 127.0.0.1:${port}`);
	}, 40_000);

	afterAll(async () => {
		if (child?.exitCode === null) {
			const exited = new Promise<void>((resolve) =>
				child?.once("exit", () => resolve()),
			);
			child.kill("SIGTERM");
			await exited;
		}
		if (dataDir) rmSync(dataDir, { recursive: true, force: true });
	});

	for (const mode of ["legacy", "auto"] as const) {
		it(`lists and calls Maket tools through SDK-managed ${mode} stdio`, async () => {
			const client = await connectStdioClient(port, dataDir, mode);
			try {
				const listed = await client.listTools();
				const names = new Set(listed.tools.map((tool) => tool.name));
				expect(names.has("maket_state")).toBe(true);
				expect(names.has("maket_learn")).toBe(true);

				const result = await client.callTool({
					name: "maket_learn",
					arguments: {
						action: "topic",
						topic: "state",
						audience: "agent",
					},
				});
				const text = result.content
					.map((item) => (item.type === "text" ? item.text : ""))
					.join("\n");
				expect(text).toContain("maket_state action=init");
				expect(text).toContain("expected_revision");
			} finally {
				await client.close();
			}
		}, 30_000);
	}
});

it("propagates stdio cancellation to the upstream HTTP tool call", async () => {
	const port = await pickFreePort();
	const dataDir = mkdtempSync(join(tmpdir(), "maket-cancel-it-"));
	let markStarted: () => void = () => {};
	let markAborted: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		markStarted = resolve;
	});
	const aborted = new Promise<void>((resolve) => {
		markAborted = resolve;
	});
	const mcpHandler = createMcpHandler(() => {
		const server = new McpServer(
			{ name: "cancellation-upstream", version: "1" },
			{ capabilities: { tools: {} } },
		);
		server.registerTool(
			"wait_for_cancellation",
			{
				inputSchema: fromJsonSchema<Record<string, never>>({
					type: "object",
					additionalProperties: false,
				}),
			},
			async (_args, ctx) => {
				markStarted();
				await new Promise<void>((resolve) => {
					const cancel = () => {
						markAborted();
						resolve();
					};
					if (ctx.mcpReq.signal.aborted) cancel();
					else
						ctx.mcpReq.signal.addEventListener("abort", cancel, { once: true });
				});
				return { content: [{ type: "text", text: "cancelled" }] };
			},
		);
		return server;
	});
	const nodeHandler = toNodeHandler(mcpHandler);
	const httpServer = createHttpServer((req, res) => {
		void nodeHandler(req, res);
	});
	await new Promise<void>((resolve, reject) => {
		httpServer.once("error", reject);
		httpServer.listen(port, "127.0.0.1", resolve);
	});

	const client = await connectStdioClient(port, dataDir, "auto");
	try {
		await client.listTools();
		const controller = new AbortController();
		const call = client.callTool(
			{ name: "wait_for_cancellation", arguments: {} },
			{ signal: controller.signal },
		);
		await started;
		controller.abort();
		await expect(call).rejects.toThrow();
		await Promise.race([
			aborted,
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error("upstream call was not aborted")),
					2_000,
				),
			),
		]);
	} finally {
		await client.close();
		await mcpHandler.close();
		await new Promise<void>((resolve, reject) => {
			httpServer.close((error) => (error ? reject(error) : resolve()));
		});
		rmSync(dataDir, { recursive: true, force: true });
	}
}, 30_000);
