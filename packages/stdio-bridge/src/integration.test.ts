/**
 * Integration test: spawns a real Maket server subprocess, then exercises the
 * JSON-RPC proxy end-to-end. Validates that a Claude Desktop stdio client
 * would receive correct MCP responses through the bridge.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waitForServer } from "./probe.ts";
import { createJsonRpcProxy } from "./proxy.ts";

const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);
const SERVER_ENTRY = join(REPO_ROOT, "packages/server/index.ts");

function pickFreePort(): Promise<number> {
	return new Promise((res, rej) => {
		const srv = createServer();
		srv.once("error", rej);
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address();
			if (typeof addr === "object" && addr) {
				const p = addr.port;
				srv.close(() => res(p));
			} else rej(new Error("no address"));
		});
	});
}

async function sendOne(
	url: string,
	msg: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const proxy = createJsonRpcProxy({
		url,
		stdin,
		stdout,
		stderr: new PassThrough(),
	});
	stdin.write(`${JSON.stringify(msg)}\n`);
	stdin.end();
	await proxy.done;
	stdout.end();
	const chunks: Buffer[] = [];
	for await (const c of stdout) chunks.push(Buffer.from(c));
	const body = Buffer.concat(chunks).toString("utf-8").trim();
	if (!body) throw new Error("no response from server");
	// Server may return multiple framed events — the last non-empty line is
	// the one carrying the result payload.
	const lines = body.split("\n").filter((l) => l.trim());
	return JSON.parse(lines[lines.length - 1] as string);
}

describe.skipIf(process.env.MAKET_RUN_NETWORK_TESTS !== "1")(
	"stdio-bridge ↔ live Maket server",
	() => {
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
				/* swallow noisy boot logs; failures surface via probe timeout */
			});

			const ready = await waitForServer(port, "127.0.0.1", 30_000, 250);
			if (!ready) {
				throw new Error(
					`server never bound 127.0.0.1:${port} (data dir ${dataDir})`,
				);
			}
		}, 40_000);

		afterAll(() => {
			if (child && !child.killed) child.kill("SIGTERM");
			if (dataDir) rmSync(dataDir, { recursive: true, force: true });
		});

		it("answers initialize with maket server info", async () => {
			const res = await sendOne(`http://127.0.0.1:${port}/mcp`, {
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "it-test", version: "0" },
				},
			});
			expect(res.jsonrpc).toBe("2.0");
			expect(res.id).toBe(1);
			const result = res.result as { serverInfo: { name: string } };
			expect(result.serverInfo.name).toBe("maket");
		}, 20_000);

		it("lists the 12 maket tools via tools/list", async () => {
			const res = await sendOne(`http://127.0.0.1:${port}/mcp`, {
				jsonrpc: "2.0",
				id: 2,
				method: "tools/list",
				params: {},
			});
			const result = res.result as { tools: { name: string }[] };
			const names = new Set(result.tools.map((t) => t.name));
			for (const expected of [
				"maket_doc",
				"maket_page",
				"maket_canvas",
				"maket_html",
				"maket_workspace",
				"maket_charte",
				"maket_collection",
				"maket_image",
				"maket_preview",
				"maket_mermaid",
				"maket_pdf",
				"maket_gmail",
			]) {
				expect(names.has(expected)).toBe(true);
			}
		}, 20_000);
	},
);
