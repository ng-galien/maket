/** MCP route — adapt the SDK v2 web-standard handler to Express. */

import { toNodeHandler } from "@modelcontextprotocol/node";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { Router as createRouter, type Router } from "express";

export interface McpRouterDeps {
	mcpHttpHandler: McpHttpHandler;
}

export function createMcpRouter({ mcpHttpHandler }: McpRouterDeps): Router {
	const router = createRouter();
	const nodeHandler = toNodeHandler(mcpHttpHandler);

	router.all("/mcp", (req, res) => {
		void nodeHandler(req, res, req.body);
	});

	return router;
}
