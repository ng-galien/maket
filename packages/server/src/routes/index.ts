/**
 * routes — orchestrates Express router mounting from the Awilix container.
 *
 * Each route module exports a `create*Router(deps): Router` factory registered
 * in `bootstrap.ts`. `mountRoutes` resolves them in order and calls `app.use`.
 * Order matters for Express: `/` before static middleware, MCP last.
 */

import type { AwilixContainer } from "awilix";
import type { Express, Router } from "express";

const ROUTER_NAMES = [
	"appRouter",
	"assetsRouter",
	"chartesRouter",
	"exportRouter",
	"thumbnailRouter",
	"oauthRouter",
	"gmailRouter",
	"mcpRouter",
] as const;

export function mountRoutes(app: Express, container: AwilixContainer): void {
	for (const name of ROUTER_NAMES) {
		app.use(container.resolve<Router>(name));
	}
}

export { createAppRouter } from "./app.routes.js";
export { createAssetsRouter } from "./assets.routes.js";
export { createChartesRouter } from "./chartes.routes.js";
export { createExportRouter } from "./export.routes.js";
export { createGmailRouter } from "./gmail.routes.js";
export { createMcpRouter } from "./mcp.routes.js";
export { createOAuthRouter } from "./oauth.routes.js";
export { createThumbnailRouter } from "./thumbnail.routes.js";
