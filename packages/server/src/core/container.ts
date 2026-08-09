/**
 * container.ts — Awilix DI types for mcp-maket.
 *
 * Everything a plugin needs is injected: store, bus, documents, ws-registry, etc.
 * Dependencies are resolved by parameter name via Awilix PROXY mode.
 */

import type {
	CallToolResult,
	McpServer,
	ServerContext,
} from "@modelcontextprotocol/server";
import type { AwilixContainer } from "awilix";
import type { z } from "zod";

export interface ToolMetadata {
	name: string;
	description: string;
	schema: z.ZodObject<any>;
}

export interface ToolHandler {
	metadata: ToolMetadata;
	handler: (
		args: Record<string, unknown>,
		extra: ServerContext,
	) => Promise<CallToolResult>;
}

// ============================================================
// MCP mounting
// ============================================================

/**
 * Register every tool from the container's toolRegistry onto an McpServer.
 * Called per-request after a fresh McpServer is created (stateless transport).
 *
 * `onCall` observes the completed tool result — used by the Express server to
 * broadcast an activity bubble over WebSocket. Observer failures deliberately
 * propagate so contract drift cannot disappear behind a successful MCP call.
 */
export function mountTools(
	server: McpServer,
	container: AwilixContainer,
	onCall?: (
		name: string,
		args: Record<string, unknown>,
		result: CallToolResult,
	) => void,
): void {
	const registry: Map<string, ToolHandler> = container.resolve("toolRegistry");

	for (const [, tool] of registry) {
		server.registerTool(
			tool.metadata.name,
			{
				description: tool.metadata.description,
				inputSchema: tool.metadata.schema,
			},
			async (args, extra) => {
				const result = await tool.handler(args, extra);
				onCall?.(tool.metadata.name, args, result);
				return result;
			},
		);
	}
}
