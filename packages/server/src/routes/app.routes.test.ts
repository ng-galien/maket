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
	let config: Config;

	beforeEach(async () => {
		publicDir = mkdtempSync(join(tmpdir(), "maket-app-route-"));
		writeFileSync(
			join(publicDir, "index.html"),
			"<html><head><title>{{TITLE}}</title></head><body>{{SUBTITLE}}</body></html>",
			"utf-8",
		);
		writeFileSync(join(publicDir, "manifest.webmanifest"), "{}", "utf-8");
		writeFileSync(join(publicDir, "service-worker.js"), "// worker", "utf-8");
		config = {
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

	it("serves the document reading deep link through the app shell", async () => {
		const res = await fetch(`${baseUrl}/documents/doc-123/read`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-cache");
		expect(await res.text()).toContain("<title>Maket Test</title>");
	});

	it("serves prefixed browser assets and reader routes through a stripping gateway", async () => {
		config.BASE_PATH = "/mobile/apps/maket";
		writeFileSync(
			join(publicDir, "index.html"),
			'<html><head><link rel="icon" href="/favicon.svg" /><link rel="manifest" href="/manifest.webmanifest" /><script src="./assets/app.js"></script></head><body>read</body></html>',
		);
		const res = await fetch(`${baseUrl}/documents/doc-123/read`);
		const html = await res.text();
		expect(html).toContain('<base href="/mobile/apps/maket/" />');
		expect(html).toContain(
			'<meta name="maket-base-path" content="/mobile/apps/maket" />',
		);
		expect(html).toContain('href="/mobile/apps/maket/favicon.svg"');
		expect(html).toContain('src="./assets/app.js"');
		expect(html).not.toContain('rel="manifest"');
	});

	it.each(["manifest.webmanifest", "service-worker.js"])(
		"serves %s without a stale application identity cache",
		async (filename) => {
			const res = await fetch(`${baseUrl}/${filename}`);
			expect(res.status).toBe(200);
			expect(res.headers.get("cache-control")).toBe("no-cache");
		},
	);
});
