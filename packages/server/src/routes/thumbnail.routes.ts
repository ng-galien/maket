/**
 * thumbnail route — GET /api/thumb?name=<doc>&page=<1-based>&w=<px>
 *
 * Returns a PNG snapshot of the document's page, rendered by
 * ThumbnailService. The `t` query (passed by the client) carries the
 * doc's `updatedAt` and is fed into the cache key + cache headers so
 * the browser short-circuits repeat requests until the doc changes.
 */

import { Router as createRouter, type Router } from "express";
import type { Documents } from "../services/documents.js";
import type { Store } from "../services/store.js";
import type { ThumbnailService } from "../services/thumbnail.js";

export interface ThumbnailRouterDeps {
	documents: Documents;
	store: Store;
	thumbnailService: ThumbnailService;
}

export function createThumbnailRouter({
	documents,
	store,
	thumbnailService,
}: ThumbnailRouterDeps): Router {
	const router = createRouter();

	router.get("/api/thumb", async (req, res) => {
		try {
			const name = req.query.name as string | undefined;
			if (!name)
				return res.status(400).json({ error: "Missing ?name= parameter" });
			const doc = documents.resolveOrLoad(name);
			if (!doc)
				return res.status(404).json({ error: `Document "${name}" not found` });

			const page1based = Math.max(1, Number(req.query.page) || 1);
			const widthPx = Math.max(60, Math.min(2000, Number(req.query.w) || 400));
			const updatedAt =
				(typeof req.query.t === "string" ? req.query.t : undefined) ??
				store.listTimestamps().get(doc.name);

			const buf = await thumbnailService.render(doc, {
				page: page1based - 1,
				widthPx,
				updatedAt,
			});

			res.setHeader("Content-Type", "image/png");
			if (req.query.t) {
				res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
			} else {
				res.setHeader("Cache-Control", "no-cache");
			}
			return res.send(buf);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return res.status(500).json({ error: msg });
		}
	});

	return router;
}
