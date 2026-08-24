/** MCP HTTP handler fully owned by the SDK v2. */

import {
	type CallToolResult,
	createMcpHandler,
	type McpHttpHandler,
	McpServer,
} from "@modelcontextprotocol/server";
import type { AwilixContainer } from "awilix";
import { resolveActivity } from "../core/activity-contract.js";
import { mountTools } from "../core/container.js";
import type { Config } from "../services/config.js";
import type { WsRegistry } from "../services/ws-registry.js";

export interface McpHttpHandlerDeps {
	config: Config;
	container: AwilixContainer;
	wsRegistry: WsRegistry;
}

export function createMcpHttpHandler({
	config,
	container,
	wsRegistry,
}: McpHttpHandlerDeps): McpHttpHandler {
	function broadcastActivity(
		name: string,
		args: Record<string, unknown>,
		result: CallToolResult,
	): void {
		if (result.isError === true) return;
		const activity = resolveActivity(name, args);
		if (!activity) return;
		const params: Record<string, string> = {};
		const cursorActivity =
			name === "maket_collection" && args.action === "cursor";
		if (!cursorActivity) {
			if (typeof args.filename === "string") params.name = args.filename;
			else if (typeof args.name === "string") params.name = args.name;
			else if (typeof args.doc === "string") params.name = args.doc;
			else params.name = "";
		}
		if (
			name === "maket_html" &&
			args.action === "set" &&
			typeof args.html === "string"
		) {
			params.count = String((args.html.match(/data-id=/g) || []).length);
		}
		wsRegistry.broadcast({
			type: "activity",
			key: activity.key,
			params,
			icon: activity.icon,
		});
	}

	return createMcpHandler(() => {
		const server = new McpServer(
			{ name: "maket", version: config.VERSION },
			{ capabilities: { tools: {} } },
		);
		mountTools(server, container, broadcastActivity);
		return server;
	});
}
