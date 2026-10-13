import { Client, type Tool } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import {
	listAllResources,
	listAllTools,
	MCP_DISCOVERY_TIMEOUT_MS,
	registerProxyResources,
	registerProxyTools,
} from "./proxy-tools.ts";

const firstTool = {
	name: "first",
	description: "First tool",
	inputSchema: { type: "object" },
} as Tool;
const secondTool = {
	name: "second",
	inputSchema: { type: "object" },
} as Tool;

describe("stdio proxy tools", () => {
	it("paginates tool discovery with the same bounded timeout", async () => {
		const listTools = vi
			.fn()
			.mockResolvedValueOnce({ tools: [firstTool], nextCursor: "next" })
			.mockResolvedValueOnce({ tools: [secondTool] });

		await expect(
			listAllTools({ listTools } as unknown as Client),
		).resolves.toEqual([firstTool, secondTool]);
		expect(listTools).toHaveBeenNthCalledWith(1, undefined, {
			timeout: MCP_DISCOVERY_TIMEOUT_MS,
		});
		expect(listTools).toHaveBeenNthCalledWith(
			2,
			{ cursor: "next" },
			{
				timeout: MCP_DISCOVERY_TIMEOUT_MS,
			},
		);
	});

	it("forwards through the currently active client and preserves cancellation", async () => {
		let callback:
			| ((
					args: Record<string, unknown>,
					ctx: { mcpReq: { signal: AbortSignal } },
			  ) => Promise<unknown>)
			| undefined;
		const server = {
			registerTool: vi.fn((_name, _definition, handler) => {
				callback = handler;
				return { remove: vi.fn() };
			}),
		} as unknown as McpServer;
		const signal = new AbortController().signal;
		const callTool = vi.fn(async () => ({ content: [] }));
		let client: Client | undefined = { callTool } as unknown as Client;
		registerProxyTools(server, [firstTool], () => client);

		await callback?.({ value: 42 }, { mcpReq: { signal } });
		expect(callTool).toHaveBeenCalledWith(
			{ name: "first", arguments: { value: 42 } },
			{ signal },
		);

		client = undefined;
		await expect(callback?.({}, { mcpReq: { signal } })).rejects.toThrow(
			"Maket App is not open",
		);
	});
});

describe("stdio proxy resources", () => {
	async function connected(server: McpServer, name: string): Promise<Client> {
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		const client = new Client({ name, version: "1" });
		await server.connect(serverSide);
		await client.connect(clientSide);
		return client;
	}

	it("relays resources/list and resources/read of an MCP Apps view and keeps the tool _meta.ui", async () => {
		const ui = {
			csp: {
				resourceDomains: ["https://fonts.gstatic.com"],
				connectDomains: [],
			},
			prefersBorder: true,
		};
		const upstream = new McpServer(
			{ name: "maket", version: "1" },
			{ capabilities: { tools: {}, resources: {} } },
		);
		upstream.registerResource(
			"maket_page",
			"ui://maket/page",
			{
				mimeType: "text/html;profile=mcp-app",
				description: "view",
				_meta: { ui },
			},
			async (uri) => ({
				contents: [
					{
						uri: uri.href,
						mimeType: "text/html;profile=mcp-app",
						text: "<!DOCTYPE html><html><body>view</body></html>",
						_meta: { ui },
					},
				],
			}),
		);
		upstream.registerTool(
			"maket_preview",
			{
				description: "preview",
				_meta: { ui: { resourceUri: "ui://maket/page" } },
			},
			async () => ({ content: [{ type: "text", text: "ok" }] }),
		);
		const app = await connected(upstream, "bridge-upstream");

		const bridge = new McpServer(
			{ name: "maket", version: "1" },
			{ capabilities: { tools: {}, resources: {} } },
		);
		registerProxyTools(bridge, await listAllTools(app), () => app);
		registerProxyResources(bridge, await listAllResources(app), () => app);
		const host = await connected(bridge, "host");

		expect((await host.listTools()).tools[0]?._meta).toEqual({
			ui: { resourceUri: "ui://maket/page" },
		});
		expect((await host.listResources()).resources).toEqual([
			expect.objectContaining({
				uri: "ui://maket/page",
				name: "maket_page",
				mimeType: "text/html;profile=mcp-app",
				_meta: { ui },
			}),
		]);
		expect(
			(await host.readResource({ uri: "ui://maket/page" })).contents,
		).toEqual([
			{
				uri: "ui://maket/page",
				mimeType: "text/html;profile=mcp-app",
				text: "<!DOCTYPE html><html><body>view</body></html>",
				_meta: { ui },
			},
		]);
		await host.close();
		await app.close();
	});
});
