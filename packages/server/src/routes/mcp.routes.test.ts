import { createServer } from "node:http";
import {
	Client,
	StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { asValue, createContainer } from "awilix";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import { createMcpRouter } from "./mcp.routes.js";
import { createMcpHttpHandler } from "./mcp-handler.js";

describe("mcp routes", () => {
	let baseUrl: string;
	let closeApp: () => Promise<void>;
	let closeHandler: () => Promise<void>;
	let wsRegistry: { broadcast: ReturnType<typeof vi.fn> };
	let clients: Client[];

	beforeEach(async () => {
		clients = [];
		wsRegistry = { broadcast: vi.fn() };
		const toolRegistry = new Map<string, ToolHandler>([
			[
				"maket_html",
				createTool("maket_html", async (args) => {
					if (args.action === "error") {
						return {
							content: [{ type: "text", text: "invalid html" }],
							isError: true,
						};
					}
					return { content: [{ type: "text", text: "ok" }] };
				}),
			],
			[
				"maket_collection",
				createTool("maket_collection", async () => ({
					content: [{ type: "text", text: "ok" }],
				})),
			],
		]);
		const container = createContainer().register({
			toolRegistry: asValue(toolRegistry),
		});
		const mcpHttpHandler = createMcpHttpHandler({
			config: { VERSION: "9.9.9" } as never,
			container,
			wsRegistry: wsRegistry as never,
		});
		closeHandler = () => mcpHttpHandler.close();

		const app = express();
		app.use(express.json());
		app.use(createMcpRouter({ mcpHttpHandler }));
		({ baseUrl, close: closeApp } = await startNetworkApp(app));
	});

	afterEach(async () => {
		for (const client of clients) await client.close();
		await closeHandler();
		await closeApp();
	});

	it("serves strict MCP v2 clients and broadcasts successful tool activity", async () => {
		const client = await connectClient();
		expect(client.getProtocolEra()).toBe("modern");

		const listed = await client.listTools();
		expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
			"maket_collection",
			"maket_html",
		]);

		const result = await client.callTool({
			name: "maket_html",
			arguments: {
				action: "set",
				doc: "poster",
				html: '<div data-id="a"></div><div data-id="b"></div>',
			},
		});

		expect(result.isError).toBeUndefined();
		expect(wsRegistry.broadcast).toHaveBeenCalledWith({
			type: "activity",
			key: "bubble_maket_html_set",
			params: { name: "poster", count: "2" },
			icon: "file-pen",
		});
	});

	it("lets the SDK serve a 2025 client from the same tool factory", async () => {
		const client = new Client(
			{ name: "maket-sdk-compat-test", version: "1.0.0" },
			{ versionNegotiation: { mode: "legacy" } },
		);
		clients.push(client);
		await client.connect(
			new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)),
		);

		expect(client.getProtocolEra()).toBe("legacy");
		const listed = await client.listTools();
		expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
			"maket_collection",
			"maket_html",
		]);
	});

	it("rejects non-JSON MCP posts at the SDK boundary", async () => {
		const response = await fetch(`${baseUrl}/mcp`, {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: "not json",
		});

		expect(response.status).toBe(415);
	});

	it("does not broadcast a success activity for an error tool result", async () => {
		const client = await connectClient();
		const result = await client.callTool({
			name: "maket_html",
			arguments: { action: "error", doc: "poster" },
		});

		expect(result.isError).toBe(true);
		expect(wsRegistry.broadcast).not.toHaveBeenCalled();
	});

	it("keeps cursor reads silent and labels cursor mutations without a false collection name", async () => {
		const client = await connectClient();

		await client.callTool({
			name: "maket_collection",
			arguments: { action: "cursor", doc: "poster", page: 1 },
		});
		expect(wsRegistry.broadcast).not.toHaveBeenCalled();

		await client.callTool({
			name: "maket_collection",
			arguments: {
				action: "cursor",
				doc: "poster",
				page: 1,
				mode: "rendered",
			},
		});
		expect(wsRegistry.broadcast).toHaveBeenCalledWith({
			type: "activity",
			key: "bubble_maket_collection_cursor",
			params: {},
			icon: "table",
		});
	});

	it("surfaces activity contract drift as an MCP tool error", async () => {
		const client = await connectClient();
		const result = await client.callTool({
			name: "maket_html",
			arguments: { action: "unknown", doc: "poster" },
		});

		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain(
			"Missing activity policy for call: maket_html action=unknown",
		);
		expect(wsRegistry.broadcast).not.toHaveBeenCalled();
	});

	async function connectClient(): Promise<Client> {
		const client = new Client(
			{ name: "maket-v2-test", version: "1.0.0" },
			{ versionNegotiation: { mode: "auto" } },
		);
		clients.push(client);
		await client.connect(
			new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)),
		);
		return client;
	}
});

function createTool(
	name: string,
	handler: (args: Record<string, unknown>) => Promise<CallToolResult>,
): ToolHandler {
	return {
		metadata: {
			name,
			description: `${name} test tool`,
			schema: z
				.object({
					action: z.string(),
					doc: z.string().optional(),
					page: z.number().optional(),
					html: z.string().optional(),
					mode: z.string().optional(),
				})
				.strict(),
		},
		handler,
	};
}

function resultText(result: CallToolResult): string {
	const item = result.content[0];
	if (item?.type !== "text") throw new Error("Expected MCP text result");
	return item.text;
}

async function startNetworkApp(app: express.Express): Promise<{
	baseUrl: string;
	close(): Promise<void>;
}> {
	const server = createServer(app);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Expected a TCP test server address");
	}
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}
