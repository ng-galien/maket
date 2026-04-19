/**
 * chartes routes — read-only JSON endpoints exposing stored brand charters.
 */

import type {
	CharteGetResponse,
	ChartesListResponse,
	HttpErrorResponse,
} from "@maket/shared";
import type { Response } from "express";
import { Router as createRouter, type Router } from "express";
import type { Store } from "../services/store.js";

export interface ChartesRouterDeps {
	store: Store;
}

export function createChartesRouter({ store }: ChartesRouterDeps): Router {
	const router = createRouter();

	router.get(
		"/api/chartes",
		(_req, res: Response<ChartesListResponse | HttpErrorResponse>) => {
			try {
				res.json(store.loadAllChartes());
				// biome-ignore lint/suspicious/noExplicitAny: error shape varies
			} catch (e: any) {
				res.status(500).json({ error: e.message });
			}
		},
	);

	router.get("/api/charte/:name", (req, res: Response<CharteGetResponse>) => {
		try {
			const charte = store.loadCharte(req.params.name);
			if (!charte) return res.status(404).json({ error: "Charte not found" });
			res.json(charte);
			// biome-ignore lint/suspicious/noExplicitAny: error shape varies
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	});

	return router;
}
