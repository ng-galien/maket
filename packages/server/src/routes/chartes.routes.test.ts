import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSQLiteStore, type Store } from "../services/store.js";
import { createChartesRouter } from "./chartes.routes.js";

describe("chartes routes", () => {
	let store: Store;
	let baseUrl: string;
	let close: () => Promise<void>;

	beforeEach(async () => {
		store = createSQLiteStore(":memory:");
		const app = express();
		app.use(createChartesRouter({ store }));
		const server = await new Promise<ReturnType<typeof app.listen>>(
			(resolve) => {
				const s = app.listen(0, () => resolve(s));
			},
		);
		const port = (server.address() as AddressInfo).port;
		baseUrl = `http://127.0.0.1:${port}`;
		close = () =>
			new Promise((resolve, reject) =>
				server.close((err) => (err ? reject(err) : resolve())),
			);
	});

	afterEach(async () => {
		await close();
		store.close();
	});

	it("GET /api/chartes returns [] on empty DB", async () => {
		const res = await fetch(`${baseUrl}/api/chartes`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([]);
	});

	it("GET /api/chartes returns every saved charte with its payload", async () => {
		store.saveCharte({
			name: "editorial",
			description: "minimalist editorial",
			tokens: { color: { primary: "#0F172A" } },
		});
		store.saveCharte({
			name: "pop",
			tokens: { color: { primary: "#FF0080" } },
		});

		const res = await fetch(`${baseUrl}/api/chartes`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Array<{
			name: string;
			description?: string;
			tokens?: { color?: Record<string, string> };
		}>;
		expect(body).toHaveLength(2);
		const editorial = body.find((c) => c.name === "editorial");
		expect(editorial?.description).toBe("minimalist editorial");
		expect(editorial?.tokens?.color?.primary).toBe("#0F172A");
	});

	it("GET /api/charte/:name returns the charte or 404", async () => {
		store.saveCharte({
			name: "editorial",
			tokens: { color: { primary: "#0F172A" } },
		});

		const hit = await fetch(`${baseUrl}/api/charte/editorial`);
		expect(hit.status).toBe(200);
		expect(await hit.json()).toMatchObject({
			name: "editorial",
			tokens: { color: { primary: "#0F172A" } },
		});

		const miss = await fetch(`${baseUrl}/api/charte/ghost`);
		expect(miss.status).toBe(404);
		expect(await miss.json()).toEqual({ error: "Charte not found" });
	});
});
