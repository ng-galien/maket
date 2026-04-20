/**
 * mcp route — POST /mcp (Streamable HTTP, stateless: one McpServer per request).
 *
 * Activity bubbles are broadcast to WS clients after every successful tool
 * invocation — the icon map lives here because it's MCP-specific and has no
 * home in the DI service layer.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AwilixContainer } from "awilix";
import { Router as createRouter, type Router } from "express";
import { mountTools } from "../core/container.js";
import type { WsRegistry } from "../services/ws-registry.js";

export interface McpRouterDeps {
	container: AwilixContainer;
	wsRegistry: WsRegistry;
}

// Icons for the activity bubbles broadcast to the client. One per compound
// tool — the action is shown in the bubble text, not the icon.
const ACTIVITY_ICONS: Record<string, string> = {
	maket_doc: "folder-open",
	maket_page: "file-plus-2",
	maket_canvas: "ruler",
	maket_html: "file-pen",
	maket_workspace: "pin",
	maket_charte: "palette",
	maket_image: "images",
	maket_preview: "eye",
	maket_mermaid: "git-branch",
	maket_pdf: "download",
	maket_gmail: "send",
};

export function createMcpRouter({
	container,
	wsRegistry,
}: McpRouterDeps): Router {
	const router = createRouter();

	function broadcastActivity(
		name: string,
		args: Record<string, unknown>,
	): void {
		const icon = ACTIVITY_ICONS[name] || "zap";
		const params: Record<string, string> = {};
		if (typeof args.filename === "string") params.name = args.filename;
		else if (typeof args.name === "string") params.name = args.name;
		else params.name = name;
		if (
			name === "maket_html" &&
			args.action === "set" &&
			typeof args.html === "string"
		) {
			params.count = String((args.html.match(/data-id=/g) || []).length);
		}
		wsRegistry.broadcast({
			type: "activity",
			key: `bubble_${name}`,
			params,
			icon,
		});
	}

	function createMcpServer(): McpServer {
		const server = new McpServer(
			{ name: "maket", version: "1.0.0" },
			{ capabilities: { tools: {} } },
		);
		mountTools(server, container, broadcastActivity);
		return server;
	}

	router.post("/mcp", async (req, res) => {
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
		});
		const server = createMcpServer();
		let closed = false;

		const closeAll = async () => {
			if (closed) return;
			closed = true;
			await transport.close().catch(() => {});
			await server.close().catch(() => {});
		};

		res.on("close", () => {
			void closeAll();
		});

		try {
			await server.connect(transport);
			await transport.handleRequest(req, res, req.body);
			// biome-ignore lint/suspicious/noExplicitAny: error shape varies
		} catch (e: any) {
			if (!res.headersSent) {
				res.status(500).json({
					jsonrpc: "2.0",
					error: { code: -32603, message: e.message },
					id: null,
				});
			}
		} finally {
			await closeAll();
		}
	});

	return router;
}
