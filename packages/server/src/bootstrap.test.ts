import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAppContainer } from "./bootstrap.js";
import { createConfig } from "./services/config.js";

describe("createAppContainer", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "maket-bootstrap-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function testConfig() {
		return createConfig({
			env: { MAKET_DATA_DIR: tmp },
			homedir: () => "/nowhere",
		});
	}

	it("wires the core services and resolves them", () => {
		const c = createAppContainer({ config: testConfig() });
		expect(c.resolve("config")).toBeDefined();
		expect(typeof c.resolve<{ emit: unknown }>("bus").emit).toBe("function");
		expect(typeof c.resolve<{ loadAll: unknown }>("store").loadAll).toBe(
			"function",
		);
		expect(typeof c.resolve<{ list: unknown }>("documents").list).toBe(
			"function",
		);
		expect(
			typeof c.resolve<{ hasClients: unknown }>("wsRegistry").hasClients,
		).toBe("function");
		expect(
			typeof c.resolve<{ isConnected: unknown }>("gmailClient").isConnected,
		).toBe("function");
		c.dispose();
	});

	it("services are singletons (same instance across resolves)", () => {
		const c = createAppContainer({ config: testConfig() });
		expect(c.resolve("bus")).toBe(c.resolve("bus"));
		expect(c.resolve("store")).toBe(c.resolve("store"));
		expect(c.resolve("documents")).toBe(c.resolve("documents"));
		c.dispose();
	});

	it("documents service is wired to the store singleton", () => {
		const c = createAppContainer({ config: testConfig() });
		const store = c.resolve<{ isEmpty: () => boolean }>("store");
		const documents = c.resolve<{ loadAll: () => void }>("documents");

		// Empty store + loadAll = empty registry
		expect(store.isEmpty()).toBe(true);
		documents.loadAll();
		c.dispose();
	});

	it("dispose() closes the SQLite store", async () => {
		const c = createAppContainer({ config: testConfig() });
		const store = c.resolve<{ loadAll: () => unknown[] }>("store");
		// Reading works pre-dispose
		expect(store.loadAll()).toEqual([]);

		await c.dispose();
		// After dispose, calling into the closed DB throws
		expect(() => store.loadAll()).toThrow();
	});
});
