/**
 * container.ts — Awilix DI types for mcp-maket.
 *
 * Everything a plugin needs is injected: store, bus, documents, ws-registry, etc.
 * Dependencies are resolved by parameter name via Awilix PROXY mode.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	CallToolResult,
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { AwilixContainer } from "awilix";
import type { z } from "zod";

/** MCP extra context passed to tool handlers (signal, sendNotification, etc.). */
export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** Re-export the SDK's tool result type so handlers don't depend on SDK paths. */
export type ToolResult = CallToolResult;

export interface ToolMetadata {
	name: string;
	description: string;
	schema: z.ZodObject<any>;
}

export interface ToolHandler {
	metadata: ToolMetadata;
	handler: (
		args: Record<string, unknown>,
		extra: ToolExtra,
	) => Promise<ToolResult>;
}

// ============================================================
// MCP mounting
// ============================================================

/**
 * Register every tool from the container's toolRegistry onto an McpServer.
 * Called per-request after a fresh McpServer is created (stateless transport).
 *
 * `onCall` fires after every successful tool invocation — used by the Express
 * server to broadcast an activity bubble over WebSocket.
 */
export function mountTools(
	server: McpServer,
	container: AwilixContainer,
	onCall?: (name: string, args: Record<string, unknown>) => void,
): void {
	const registry: Map<string, ToolHandler> = container.resolve("toolRegistry");

	for (const [, tool] of registry) {
		server.tool(
			tool.metadata.name,
			tool.metadata.description,
			tool.metadata.schema.shape,
			async (args: Record<string, unknown>, extra: ToolExtra) => {
				const result = await tool.handler(args, extra);
				try {
					onCall?.(tool.metadata.name, args);
				} catch {}
				return result;
			},
		);
	}
}
