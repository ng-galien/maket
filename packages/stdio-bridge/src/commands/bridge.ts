/**
 * `maket bridge` — MCP v2 stdio gateway for the Maket HTTP server.
 *
 * Probes the Maket HTTP server on MAKET_PORT; spawns one if absent, then
 * exposes its tools through the SDK's stdio server. The SDK's HTTP client
 * delegates tool calls to the server's /mcp endpoint. This is the default
 * command when the binary is invoked with no arguments.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
	Client,
	StreamableHTTPClientTransport,
	type Tool,
} from "@modelcontextprotocol/client";
import {
	fromJsonSchema,
	type JsonSchemaType,
	McpServer,
} from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ensureServer } from "../spawn.ts";
import { type MaketEnvOverrides, readEnv } from "./_env.ts";
import { readVersion } from "./_version.ts";

/**
 * Resolve a spawn command from the environment, with strict validation to
 * shut the door on env-var injection attacks.
 *
 * - `MAKET_SERVER_ENTRY` must be an absolute path to an existing `.js`/`.mjs`
 *   file. We never accept a shell string or relative path.
 * - The legacy `MAKET_SERVER_CMD` (space-split) is no longer honoured —
 *   it allowed argument injection (`MAKET_SERVER_CMD="bash -c '…'"`).
 *   Override the spawn from code if you need a custom command.
 *
 * Returns `undefined` to let `ensureServer` fall back to the packaged
 * `defaultServerCmd()` (sibling `server.js` for npm installs, workspace
 * resolution in dev).
 */
function resolveServerCmd(): string[] | undefined {
	const entry = process.env.MAKET_SERVER_ENTRY;
	if (!entry) return undefined;
	if (!isAbsolute(entry) || !/\.(?:m?js)$/.test(entry) || !existsSync(entry)) {
		process.stderr.write(
			`maket: ignoring MAKET_SERVER_ENTRY="${entry}" — must be an absolute path to an existing .js or .mjs file.\n`,
		);
		return undefined;
	}
	return [process.execPath, entry];
}

async function listAllTools(client: Client): Promise<Tool[]> {
	const tools: Tool[] = [];
	let cursor: string | undefined;
	do {
		const page = await client.listTools(cursor ? { cursor } : undefined);
		tools.push(...page.tools);
		cursor = page.nextCursor;
	} while (cursor !== undefined);
	return tools;
}

function createStdioServer(client: Client, tools: Tool[]): McpServer {
	const server = new McpServer(
		{ name: "maket", version: readVersion() },
		{ capabilities: { tools: {} } },
	);

	for (const tool of tools) {
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: fromJsonSchema<Record<string, unknown>>(
					tool.inputSchema as JsonSchemaType,
				),
				...(tool.outputSchema
					? {
							outputSchema: fromJsonSchema(tool.outputSchema as JsonSchemaType),
						}
					: {}),
				annotations: tool.annotations,
				icons: tool.icons,
				_meta: tool._meta,
			},
			async (args, ctx) =>
				client.callTool(
					{
						name: tool.name,
						arguments: args,
					},
					{ signal: ctx.mcpReq.signal },
				),
		);
	}

	return server;
}

async function waitForStdioClose(close: () => Promise<void>): Promise<void> {
	return new Promise((resolve, reject) => {
		let stopping = false;
		const stop = () => {
			if (stopping) return;
			stopping = true;
			process.off("SIGINT", stop);
			process.off("SIGTERM", stop);
			process.stdin.off("close", stop);
			process.stdin.off("end", stop);
			close().then(resolve, reject);
		};

		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
		process.stdin.once("close", stop);
		process.stdin.once("end", stop);
	});
}

// code-moniker: ignore[smell-feature-envy-local]
// Process-level composition intentionally coordinates the server lifecycle and both SDK transports.
export async function runBridge(
	overrides: MaketEnvOverrides = {},
): Promise<void> {
	const { port, host, dataDir, bridgeLog, pidFile } = readEnv(overrides);
	const cmd = resolveServerCmd();

	const log = (msg: string) => {
		const line = `${new Date().toISOString()} ${msg}\n`;
		process.stderr.write(line);
		try {
			mkdirSync(dataDir, { recursive: true });
			appendFileSync(bridgeLog, line);
		} catch {}
	};

	log(
		`boot pid=${process.pid} port=${port} host=${host} dataDir=${dataDir} cmd=${cmd ? JSON.stringify(cmd) : "(default)"}`,
	);

	try {
		const { started, alreadyRunning } = await ensureServer({
			port,
			host,
			dataDir,
			cmd,
			pidFile,
		});
		log(`ensureServer ok started=${started} alreadyRunning=${alreadyRunning}`);
	} catch (e) {
		log(`fatal ensureServer: ${(e as Error).stack ?? (e as Error).message}`);
		process.exitCode = 1;
		return;
	}

	const client = new Client(
		{ name: "maket-stdio-gateway", version: readVersion() },
		{ versionNegotiation: { mode: "auto" } },
	);

	try {
		await client.connect(
			new StreamableHTTPClientTransport(new URL(`http://${host}:${port}/mcp`)),
		);
		const tools = await listAllTools(client);
		log(`connected MCP v2 client; exposing ${tools.length} tools over stdio`);

		const handle = serveStdio(() => createStdioServer(client, tools), {
			onerror: (error) => log(`stdio: ${error.stack ?? error.message}`),
		});
		await waitForStdioClose(() => handle.close());
		log("stdio closed; exiting");
	} finally {
		await client.close();
	}
}
