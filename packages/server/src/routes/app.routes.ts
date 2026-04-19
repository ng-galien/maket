/**
 * app routes — GET / (app shell HTML with config-driven title/subtitle).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Router as createRouter, type Router } from "express";
import type { Config } from "../services/config.js";

export interface AppRouterDeps {
	config: Config;
}

export function createAppRouter({ config }: AppRouterDeps): Router {
	const router = createRouter();

	router.get("/", (_req, res) => {
		const html = readFileSync(join(config.PUBLIC_DIR, "index.html"), "utf-8")
			.replace(/{{TITLE}}/g, config.APP_TITLE)
			.replace(/{{SUBTITLE}}/g, config.APP_SUBTITLE);
		res.setHeader("Cache-Control", "no-cache");
		res.type("html").send(html);
	});

	return router;
}
