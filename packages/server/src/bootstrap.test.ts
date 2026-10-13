import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type BootstrapInputs, createAppContainer } from "./bootstrap.js";
import { assertActivityContract } from "./core/activity-contract.js";
import { registerToolPacks } from "./core/tool-pack-registry.js";
import { createConfig } from "./services/config.js";
import { isItemSourceError } from "./services/item-sources/item-source-error.js";
import type { ItemSources } from "./services/item-sources/item-sources.js";
import { createSQLiteStore } from "./services/store.js";
import type { StructuredWorkspaces } from "./services/structured-workspaces.js";
import { assetsPack } from "./tools/assets.js";
import { canvasPack } from "./tools/canvas.js";
import { chartesPack } from "./tools/chartes.js";
import { collectionsPack } from "./tools/collections.js";
import { documentsPack } from "./tools/documents.js";
import { gmailPack } from "./tools/gmail.js";
import { htmlPack } from "./tools/html.js";
import { learnPack } from "./tools/learn.js";
import { mermaidPack } from "./tools/mermaid.js";
import { pagesPack } from "./tools/pages.js";
import { pdfPack } from "./tools/pdf.js";
import { previewPack } from "./tools/preview.js";
import { statePack } from "./tools/state.js";
import { structuredWorkspacesPack } from "./tools/structured-workspaces.js";
import { workspacePack } from "./tools/workspace.js";

const browserPool = {
	async get(): Promise<never> {
		throw new Error("Browser rendering is not used by this test");
	},
	async dispose() {},
};

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

	function createTestContainer(inputs: BootstrapInputs = {}) {
		return createAppContainer({ browserPool, ...inputs });
	}

	it("wires the core services and resolves them", () => {
		const c = createTestContainer({ config: testConfig() });
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
		const c = createTestContainer({ config: testConfig() });
		expect(c.resolve("bus")).toBe(c.resolve("bus"));
		expect(c.resolve("store")).toBe(c.resolve("store"));
		expect(c.resolve("documents")).toBe(c.resolve("documents"));
		c.dispose();
	});

	it("documents service is wired to the store singleton", () => {
		const c = createTestContainer({ config: testConfig() });
		const store = c.resolve<{ isEmpty: () => boolean }>("store");
		const documents = c.resolve<{ loadAll: () => void }>("documents");

		// Empty store + loadAll = empty registry
		expect(store.isEmpty()).toBe(true);
		documents.loadAll();
		c.dispose();
	});

	it("dispose() closes the SQLite store", async () => {
		const c = createTestContainer({ config: testConfig() });
		const store = c.resolve<{ loadAll: () => unknown[] }>("store");
		// Reading works pre-dispose
		expect(store.loadAll()).toEqual([]);

		await c.dispose();
		// After dispose, calling into the closed DB throws
		expect(() => store.loadAll()).toThrow();
	});

	it("resolves every registered key (boot smoke)", () => {
		const c = createTestContainer({ config: testConfig() });
		// Every factory registered by bootstrap.ts must resolve without throwing.
		// Eager resolution catches factory bugs (throwing constructors, missing deps)
		// at test time rather than at production boot.
		for (const name of Object.keys(c.registrations)) {
			expect(() => c.resolve(name), `resolve "${name}"`).not.toThrow();
		}
		c.dispose();
	});

	it("serves each Structured Workspace through one item source, closed when the workspace is deleted", async () => {
		const store = createSQLiteStore(":memory:");
		const c = createTestContainer({ config: testConfig(), store });
		const workspaces = c.resolve<StructuredWorkspaces>("structuredWorkspaces");
		const itemSources = c.resolve<ItemSources>("itemSources");
		const workspace = workspaces.create({
			name: "Registry",
			dataSchema: { type: "object", properties: { title: { type: "string" } } },
		});
		workspaces.addItem({
			workspace: workspace.id,
			itemId: "one",
			collectionId: "items",
			bindingId: "item",
			documentName: "Registry one",
			data: { title: "One" },
		});
		const source = itemSources.sourceFor(workspace.id);
		expect(itemSources.sourceFor(workspace.id)).toBe(source);
		expect(source.get("one")?.data).toEqual({ title: "One" });
		workspaces.delete(workspace.id);
		let closedCode: string | undefined;
		try {
			source.get("one");
		} catch (error) {
			closedCode = isItemSourceError(error) ? error.code : String(error);
		}
		expect(closedCode).toBe("source_unreachable");
		expect(itemSources.sourceFor(workspace.id)).not.toBe(source);
		await c.dispose();
		store.close();
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
			browserPool,
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
		collectionsPack,
		statePack,
		structuredWorkspacesPack,
		learnPack,
		pagesPack,
		documentsPack,
		canvasPack,
		htmlPack,
		workspacePack,
		previewPack,
		pdfPack,
		gmailPack,
	];

	const manifestTools = {
		mermaid: {},
		assets: {},
		chartes: {},
		collections: {},
		state: {},
		"structured-workspaces": {},
		learn: {},
		pages: {},
		documents: {},
		canvas: {},
		html: {},
		workspace: {},
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

	it("holds the boot-time activity contract over the real tool registry", () => {
		const c = bootedContainer();
		const { toolRegistry } = registerToolPacks(
			c,
			{ packs: manifestTools },
			allPacks,
		);
		expect(() => assertActivityContract(toolRegistry)).not.toThrow();
		const workspaceTool = toolRegistry.get("maket_structured_workspace");
		if (!workspaceTool) throw new Error("Structured Workspace tool missing.");
		const actionSchema = workspaceTool.metadata.schema.shape.action as {
			options: string[];
		};
		const drifted = new Map(toolRegistry);
		drifted.set("maket_structured_workspace", {
			...workspaceTool,
			metadata: {
				...workspaceTool.metadata,
				schema: workspaceTool.metadata.schema.extend({
					action: z.enum(["unpoliced", ...actionSchema.options]),
				}),
			},
		});
		expect(() => assertActivityContract(drifted)).toThrow(
			"Activity contract drift — maket_structured_workspace: missing action policy for unpoliced",
		);
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
		assertActivityContract(toolRegistry);
		expect([...registryNames].sort()).toEqual([...manifestNames].sort());
		c.dispose();
	});
});
