import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Collection } from "@maket/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderCollectionDocument } from "../lib/collection-render.js";
import type { AssetsService } from "../services/assets.js";
import type { BrowserPool } from "../services/browser-pool.js";
import type { CollectionCursors } from "../services/collection-cursor.js";
import type { Config } from "../services/config.js";
import type { DocumentRenderer } from "../services/document-renderer.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketPreviewTool, previewPack } from "./preview.js";

const previewMocks = vi.hoisted(() => {
	const page = {
		setViewport: vi.fn(async () => {}),
		setContent: vi.fn(async () => {}),
		waitForNetworkIdle: vi.fn(async () => {}),
		evaluate: vi.fn(async () => undefined),
		screenshot: vi.fn(async () => Buffer.from("png")),
		pdf: vi.fn(async () => Buffer.from("pdf")),
		close: vi.fn(async () => {}),
	};
	const browser = {
		newPage: vi.fn(async () => page),
		connected: true,
		on: vi.fn(),
		close: vi.fn(async () => {}),
	};
	return {
		execFile: vi.fn(),
		inlineImages: vi.fn(async (html: string) => html),
		installNetworkGuard: vi.fn(async () => {}),
		page,
		browser,
		get: vi.fn(async () => browser),
	};
});

vi.mock("../lib/image-inline.js", () => ({
	inlineImages: previewMocks.inlineImages,
}));

vi.mock("../lib/page-network-guard.js", () => ({
	installNetworkGuard: previewMocks.installNetworkGuard,
}));

vi.mock("node:child_process", () => ({
	execFile: previewMocks.execFile,
}));

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return { ...actual, platform: () => "darwin" };
});

function fixture() {
	const tmp = mkdtempSync(join(tmpdir(), "maket-preview-"));
	const store = createSQLiteStore(":memory:");
	const documents = createDocuments({ store });
	const config = {
		EXPORTS_DIR: tmp,
		ASSETS_DIR: tmp,
		PORT: 3333,
	} as unknown as Config;
	const assets = {
		mimeFromExt: () => "image/png",
	} as unknown as AssetsService;
	const browserPool = {
		get: previewMocks.get,
		dispose: vi.fn(async () => {}),
	} as unknown as BrowserPool;
	const documentRenderer = {
		render: (doc: import("../types.js").Document) => doc,
	} as Pick<DocumentRenderer, "render">;
	const collectionCursors = {
		resolve: () => null,
	} as Pick<CollectionCursors, "resolve">;
	return {
		store,
		documents,
		config,
		assets,
		browserPool,
		documentRenderer,
		collectionCursors,
		cleanup: () => {
			store.close();
			rmSync(tmp, { recursive: true, force: true });
		},
	};
}

const NO_EXTRA = {} as any;

beforeEach(() => {
	previewMocks.execFile.mockClear();
	previewMocks.inlineImages.mockClear();
	previewMocks.installNetworkGuard.mockClear();
	previewMocks.page.setViewport.mockClear();
	previewMocks.page.setContent.mockClear();
	previewMocks.page.waitForNetworkIdle.mockClear();
	previewMocks.page.evaluate.mockClear();
	previewMocks.page.screenshot.mockClear();
	previewMocks.page.close.mockClear();
	previewMocks.browser.newPage.mockClear();
	previewMocks.browser.close.mockClear();
	previewMocks.get.mockClear();
});

describe("previewPack — registration", () => {
	it("declares id and deps", () => {
		expect(previewPack.id).toBe("preview");
		expect(previewPack.requires).toEqual([
			"documents",
			"config",
			"assets",
			"documentRenderer",
			"collectionCursors",
			"browserPool",
		]);
	});
});

describe("maket_preview — action=snapshot", () => {
	it("renders a snapshot, writes the PNG, and returns inline image content", async () => {
		const {
			store,
			documents,
			config,
			assets,
			browserPool,
			documentRenderer,
			collectionCursors,
			cleanup,
		} = fixture();
		store.saveDoc(
			createDocument({
				name: "d",
				canvas: {
					format: "A4",
					orientation: "portrait",
					w: 210,
					h: 297,
					bg: "#fff",
				},
				pages: [
					{ name: "P1", elements: [], html: `<div data-id="x">Hi</div>` },
				],
			}),
		);
		documents.loadAll();

		const tool = createMaketPreviewTool({
			documents,
			config,
			assets,
			browserPool,
			documentRenderer,
			collectionCursors,
		});
		const res = await tool.handler(
			{ action: "snapshot", doc: "d", page: 1 },
			NO_EXTRA,
		);

		expect(previewMocks.inlineImages).toHaveBeenCalledWith(
			`<div data-id="x">Hi</div>`,
			expect.objectContaining({ assetsDir: config.ASSETS_DIR }),
		);
		expect(previewMocks.installNetworkGuard).toHaveBeenCalledWith(
			previewMocks.page,
			"offline",
		);
		expect(previewMocks.get).toHaveBeenCalledOnce();
		expect(previewMocks.page.close).toHaveBeenCalledOnce();
		expect(readFileSync(join(config.EXPORTS_DIR, "d.png"))).toEqual(
			Buffer.from("png"),
		);
		expect((res.content[0] as any).text).toMatch(/Snapshot saved:/);
		expect((res.content[1] as any).data).toBe(
			Buffer.from("png").toString("base64"),
		);
		cleanup();
	});

	it("renders the collection row selected by the shared cursor", async () => {
		const { store, documents, config, assets, browserPool, cleanup } =
			fixture();
		const collection: Collection = {
			name: "clients",
			schema: {
				type: "object",
				properties: { client: { type: "string" } },
				required: ["client"],
				additionalProperties: false,
			},
			members: [
				{ id: "member_1", position: 0, data: { client: "Helios" } },
				{ id: "member_2", position: 1, data: { client: "Acme" } },
			],
		};
		store.saveCollection(collection);
		store.saveDoc(
			createDocument({
				name: "merge",
				dataModel: "collection",
				canvas: {
					format: "A5",
					orientation: "portrait",
					w: 148,
					h: 210,
					bg: "#fff",
				},
				pages: [
					{
						id: "offer",
						name: "Offer",
						elements: [],
						collection: { name: "clients" },
						html: '<div data-id="client">{{client}}</div>',
					},
				],
			}),
		);
		documents.loadAll();

		const documentRenderer = {
			render: (
				doc: import("../types.js").Document,
				options?: import("../services/document-renderer.js").DocumentRenderOptions,
			) =>
				renderCollectionDocument(
					doc,
					new Map([[collection.name, collection]]),
					options?.collection,
				),
		} as Pick<DocumentRenderer, "render">;
		const resolveCursor = vi.fn((docName: string, pageIndex: number) =>
			docName === "merge" && pageIndex === 0
				? {
						docName: "merge",
						pageIndex: 0,
						collection: "clients",
						mode: "rendered" as const,
						memberId: "member_2",
					}
				: null,
		);
		const collectionCursors = {
			resolve: resolveCursor,
		} as Pick<CollectionCursors, "resolve">;
		const tool = createMaketPreviewTool({
			documents,
			config,
			assets,
			browserPool,
			documentRenderer,
			collectionCursors,
		});

		await tool.handler({ action: "snapshot", doc: "merge", page: 1 }, NO_EXTRA);

		expect(resolveCursor).toHaveBeenCalledOnce();
		expect(resolveCursor).toHaveBeenCalledWith("merge", 0);
		expect(previewMocks.inlineImages).toHaveBeenCalledWith(
			'<div data-id="client">Acme</div>',
			expect.objectContaining({ assetsDir: config.ASSETS_DIR }),
		);
		expect(previewMocks.inlineImages).not.toHaveBeenCalledWith(
			expect.stringContaining("{{client}}"),
			expect.anything(),
		);
		cleanup();
	});

	it("errors when document is missing", async () => {
		const {
			documents,
			config,
			assets,
			browserPool,
			documentRenderer,
			collectionCursors,
			cleanup,
		} = fixture();
		const tool = createMaketPreviewTool({
			documents,
			config,
			assets,
			browserPool,
			documentRenderer,
			collectionCursors,
		});
		const res = await tool.handler(
			{ action: "snapshot", doc: "ghost", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("errors when page is out of range", async () => {
		const {
			store,
			documents,
			config,
			assets,
			browserPool,
			documentRenderer,
			collectionCursors,
			cleanup,
		} = fixture();
		store.saveDoc(
			createDocument({
				name: "d",
				canvas: {
					format: "A4",
					orientation: "portrait",
					w: 210,
					h: 297,
					bg: "#fff",
				},
				pages: [{ name: "P1", elements: [], html: "<p>.</p>" }],
			}),
		);
		documents.loadAll();
		const tool = createMaketPreviewTool({
			documents,
			config,
			assets,
			browserPool,
			documentRenderer,
			collectionCursors,
		});
		const res = await tool.handler(
			{ action: "snapshot", doc: "d", page: 99 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("errors when page has no HTML", async () => {
		const {
			store,
			documents,
			config,
			assets,
			browserPool,
			documentRenderer,
			collectionCursors,
			cleanup,
		} = fixture();
		store.saveDoc(
			createDocument({
				name: "d",
				canvas: {
					format: "A4",
					orientation: "portrait",
					w: 210,
					h: 297,
					bg: "#fff",
				},
				pages: [{ name: "P1", elements: [] }],
			}),
		);
		documents.loadAll();
		const tool = createMaketPreviewTool({
			documents,
			config,
			assets,
			browserPool,
			documentRenderer,
			collectionCursors,
		});
		const res = await tool.handler(
			{ action: "snapshot", doc: "d", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("errors when doc/page args are missing", async () => {
		const {
			documents,
			config,
			assets,
			browserPool,
			documentRenderer,
			collectionCursors,
			cleanup,
		} = fixture();
		const tool = createMaketPreviewTool({
			documents,
			config,
			assets,
			browserPool,
			documentRenderer,
			collectionCursors,
		});
		const res = await tool.handler({ action: "snapshot" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		cleanup();
	});
});

describe("maket_preview — action=open", () => {
	it("opens the live preview URL in the system browser", async () => {
		const {
			documents,
			config,
			assets,
			browserPool,
			documentRenderer,
			collectionCursors,
			cleanup,
		} = fixture();
		const tool = createMaketPreviewTool({
			documents,
			config,
			assets,
			browserPool,
			documentRenderer,
			collectionCursors,
		});

		const res = await tool.handler({ action: "open" }, NO_EXTRA);

		expect(previewMocks.execFile).toHaveBeenCalledWith("open", [
			"http://localhost:3333",
		]);
		expect((res.content[0] as any).text).toBe(
			"Opened http://localhost:3333 in browser",
		);
		cleanup();
	});
});
