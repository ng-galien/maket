import type { Client, Tool } from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import {
	listAllTools,
	MCP_DISCOVERY_TIMEOUT_MS,
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
