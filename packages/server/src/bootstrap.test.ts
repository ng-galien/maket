import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAppContainer } from "./bootstrap.js";
import { registerToolPacks } from "./core/tool-pack-registry.js";
import { createConfig } from "./services/config.js";
import { assetsPack } from "./tools/assets.js";
import { canvasPack } from "./tools/canvas.js";
import { chartesPack } from "./tools/chartes.js";
import { documentsPack } from "./tools/documents.js";
import { gmailPack } from "./tools/gmail.js";
import { htmlPack } from "./tools/html.js";
import { mermaidPack } from "./tools/mermaid.js";
import { messagesPack } from "./tools/messages.js";
import { pagesPack } from "./tools/pages.js";
import { pdfPack } from "./tools/pdf.js";
import { previewPack } from "./tools/preview.js";

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

	it("resolves every registered key (boot smoke)", () => {
		const c = createAppContainer({ config: testConfig() });
		// Every factory registered by bootstrap.ts must resolve without throwing.
		// Eager resolution catches factory bugs (throwing constructors, missing deps)
		// at test time rather than at production boot.
		for (const name of Object.keys(c.registrations)) {
			expect(() => c.resolve(name), `resolve "${name}"`).not.toThrow();
		}
		c.dispose();
	});
});

describe("registerToolPacks", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "maket-bootstrap-packs-"));
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function bootedContainer() {
		return createAppContainer({
			config: createConfig({
				env: { MAKET_DATA_DIR: tmp },
				homedir: () => "/nowhere",
			}),
		});
	}

	const allPacks = [
		mermaidPack,
		assetsPack,
		chartesPack,
		pagesPack,
		documentsPack,
		canvasPack,
		htmlPack,
		messagesPack,
		previewPack,
		pdfPack,
		gmailPack,
	];

	const manifestTools = {
		mermaid: {},
		assets: {},
		chartes: {},
		pages: {},
		documents: {},
		canvas: {},
		html: {},
		messages: {},
		preview: {},
		pdf: {},
		gmail: {},
	};

	it("throws when a declared tool fails to register", () => {
		const c = bootedContainer();
		const brokenPack = {
			id: "broken",
			name: "Broken",
			declaresTools: ["maket_doc_typo"],
			// biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op
			register() {},
		};
		expect(() =>
			registerToolPacks(c, { packs: { ...manifestTools, broken: {} } }, [
				...allPacks,
				brokenPack,
			]),
		).toThrow(/did not register/);
		c.dispose();
	});

	it("registry matches manifest.json tool list", () => {
		const c = bootedContainer();
		const { toolRegistry } = registerToolPacks(
			c,
			{ packs: manifestTools },
			allPacks,
		);
		const manifestPath = join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"..",
			"..",
			"manifest.json",
		);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
			tools: { name: string }[];
		};
		const manifestNames = new Set(manifest.tools.map((t) => t.name));
		const registryNames = new Set(toolRegistry.keys());
		expect([...registryNames].sort()).toEqual([...manifestNames].sort());
		c.dispose();
	});
});
