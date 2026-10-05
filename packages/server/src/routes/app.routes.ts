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

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// This HTTP adapter combines the app shell, browser prefix, and static delivery.
export function createAppRouter({ config }: AppRouterDeps): Router {
	const router = createRouter();

	router.get(["/", "/documents/:documentId/read"], (req, res) => {
		let html = readFileSync(join(config.PUBLIC_DIR, "index.html"), "utf-8")
			.replace(/{{TITLE}}/g, config.APP_TITLE)
			.replace(/{{SUBTITLE}}/g, config.APP_SUBTITLE);
		const basePath = config.BASE_PATH ?? "";
		if (basePath) {
			html = html.replace(/(\b(?:href|src)=["'])\/(?!\/)/g, `$1${basePath}/`);
			html = html.replace(/<link\s+rel=["']manifest["'][^>]*>/i, "");
		}
		if (basePath || req.path !== "/") {
			html = html.replace(
				"<head>",
				`<head><base href="${basePath}/" /><meta name="maket-base-path" content="${basePath}" />`,
			);
		}
		res.setHeader("Cache-Control", "no-cache");
		res.type("html").send(html);
	});

	for (const filename of ["manifest.webmanifest", "service-worker.js"]) {
		router.get(`/${filename}`, (_req, res) => {
			res.setHeader("Cache-Control", "no-cache");
			res.sendFile(join(config.PUBLIC_DIR, filename));
		});
	}

	return router;
}
