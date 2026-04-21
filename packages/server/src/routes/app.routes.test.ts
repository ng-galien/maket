import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApp } from "../../tests/helpers.js";
import type { Config } from "../services/config.js";
import { createAppRouter } from "./app.routes.js";

describe("app routes", () => {
	let publicDir: string;
	let baseUrl: string;
	let close: () => Promise<void>;

	beforeEach(async () => {
		publicDir = mkdtempSync(join(tmpdir(), "maket-app-route-"));
		writeFileSync(
			join(publicDir, "index.html"),
			"<html><head><title>{{TITLE}}</title></head><body>{{SUBTITLE}}</body></html>",
			"utf-8",
		);
		const config = {
			PUBLIC_DIR: publicDir,
			APP_TITLE: "Maket Test",
			APP_SUBTITLE: "Design faster",
		} as Config;
		const app = express();
		app.use(createAppRouter({ config }));
		({ baseUrl, close } = await startTestApp(app));
	});

	afterEach(async () => {
		await close();
		rmSync(publicDir, { recursive: true, force: true });
	});

	it("GET / injects the configured title and subtitle", async () => {
		const res = await fetch(`${baseUrl}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-cache");
		const html = await res.text();
		expect(html).toContain("<title>Maket Test</title>");
		expect(html).toContain("Design faster");
	});
});
