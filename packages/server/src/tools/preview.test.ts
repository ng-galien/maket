import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Collection } from "@maket/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderCollectionDocument } from "../lib/collection-render.js";
import { selectedPages } from "../lib/maket-reader.js";
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
	const onePixelPng = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
		"base64",
	);
	const page = {
		setViewport: vi.fn(async () => {}),
		setContent: vi.fn(async () => {}),
		waitForNetworkIdle: vi.fn(async () => {}),
		evaluate: vi.fn(async (_script?: unknown): Promise<unknown> => undefined),
		screenshot: vi.fn(async (_options?: unknown) => onePixelPng),
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
		onePixelPng,
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
			previewMocks.onePixelPng,
		);
		const answer = (res.content[0] as any).text as string;
		expect(answer).toMatch(/^Snapshot of "d" page 1 saved: .*d\.png/);
		expect(answer).toContain("Inline image 794×1123 px.");
		expect(answer).toContain(
			`Read it in Maket: /documents/${documents.resolve("d")?.id}/read (a relative path: it opens in the Maket app, or in a browser on the Maket server origin).`,
		);
		expect(res.content[1]).toEqual({
			type: "image",
			data: previewMocks.onePixelPng.toString("base64"),
			mimeType: "image/png",
		});
		cleanup();
	});

	/** Snapshot a one-page document, the full screenshot being `full`, while
	 * measuring the longest stall of the event loop. */
	async function snapshotOf(
		canvas: Parameters<typeof createDocument>[0]["canvas"],
		full: Buffer,
	) {
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
				name: "big",
				canvas,
				pages: [
					{ name: "P1", elements: [], html: `<div data-id="x">Big</div>` },
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
		previewMocks.page.screenshot.mockImplementation(
			async (options?: unknown) =>
				(options as { clip?: unknown } | undefined)?.clip
					? previewMocks.onePixelPng
					: (full as typeof previewMocks.onePixelPng),
		);
		let longest = 0;
		let last = performance.now();
		const monitor = setInterval(() => {
			const now = performance.now();
			longest = Math.max(longest, now - last);
			last = now;
		}, 5);
		try {
			const res = await tool.handler(
				{ action: "snapshot", doc: "big", page: 1 },
				NO_EXTRA,
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
			return {
				res,
				longest,
				saved: readFileSync(join(config.EXPORTS_DIR, "big.png")),
				clips: previewMocks.page.screenshot.mock.calls.flatMap(([options]) => {
					const clip = (options as { clip?: unknown } | undefined)?.clip;
					return clip ? [clip] : [];
				}),
			};
		} finally {
			clearInterval(monitor);
			previewMocks.page.screenshot.mockImplementation(
				async () => previewMocks.onePixelPng,
			);
			cleanup();
		}
	}

	it("has Chromium draw the inline image of a 3840×2160 page at 1600 px, never blocking the event loop 200 ms, the full PNG kept on disk", async () => {
		const full = Buffer.alloc(24 * 1024 * 1024, 7);
		const { res, longest, saved, clips } = await snapshotOf(
			{
				format: "DESKTOP",
				orientation: "landscape",
				w: 1016,
				h: 571.4,
				bg: "#fff",
			},
			full,
		);
		expect(saved.length).toBe(full.length);
		expect(clips).toEqual([
			{ x: 0, y: 0, width: 3841, height: 2160, scale: 1600 / 3841 },
		]);
		expect(res.content[1]).toEqual({
			type: "image",
			data: previewMocks.onePixelPng.toString("base64"),
			mimeType: "image/png",
		});
		expect((res.content[0] as any).text).toContain(
			"Inline image downscaled to 1600×900 px: the full-size PNG is the saved file",
		);
		expect(longest).toBeLessThan(200);
	});

	it("inlines the top part of a very tall AUTO page at a legible scale and says it is cropped", async () => {
		previewMocks.page.evaluate.mockImplementation(async (script?: unknown) =>
			typeof script === "string" ? [157848] : undefined,
		);
		try {
			const { res, longest, clips } = await snapshotOf(
				{ format: "AUTO", orientation: "portrait", w: 420, h: 1, bg: "#fff" },
				Buffer.alloc(20 * 1024 * 1024, 3),
			);
			expect(clips).toEqual([
				{ x: 0, y: 0, width: 1588, height: 3176, scale: 1600 / 3176 },
			]);
			expect((res.content[0] as any).text).toContain(
				"Inline image cropped to the top part (1588×3176 px of the full result, shown at 800×1600 px): the full-size PNG is the saved file",
			);
			expect(longest).toBeLessThan(200);
		} finally {
			previewMocks.page.evaluate.mockImplementation(async () => undefined);
		}
	});

	it("keeps the answer when the inline image cannot be made", async () => {
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
				name: "wide",
				canvas: {
					format: "DESKTOP",
					orientation: "landscape",
					w: 1016,
					h: 571.4,
					bg: "#fff",
				},
				pages: [
					{ name: "P1", elements: [], html: `<div data-id="x">Wide</div>` },
				],
			}),
		);
		documents.loadAll();
		previewMocks.page.screenshot.mockImplementation(
			async (options?: unknown) => {
				if ((options as { clip?: unknown } | undefined)?.clip)
					throw new Error("capture failed");
				return previewMocks.onePixelPng;
			},
		);
		try {
			const res = await createMaketPreviewTool({
				documents,
				config,
				assets,
				browserPool,
				documentRenderer,
				collectionCursors,
			}).handler({ action: "snapshot", doc: "wide", page: 1 }, NO_EXTRA);
			expect(res.isError).toBeUndefined();
			expect(res.content).toHaveLength(1);
			const answer = (res.content[0] as any).text as string;
			expect(answer).toMatch(/^Snapshot of "wide" page 1 saved: .*wide\.png/);
			expect(answer).toContain(
				"The inline image could not be attached; the full-size PNG is the saved file",
			);
			expect(answer).toContain("Read it in Maket: /documents/");
		} finally {
			previewMocks.page.screenshot.mockImplementation(
				async () => previewMocks.onePixelPng,
			);
			cleanup();
		}
	});

	it("opens the Maket reader on the snapshot page, keeping the image and reading path", async () => {
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
				name: "small",
				canvas: {
					format: "A4",
					orientation: "portrait",
					w: 210,
					h: 297,
					bg: "#fff",
				},
				pages: [
					{ name: "Cover", elements: [], html: "<p data-id='x'>One</p>" },
					{ name: "Back", elements: [], html: "<p data-id='y'>Two</p>" },
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
		expect(tool.metadata._meta).toEqual({
			ui: { resourceUri: "ui://maket/page", visibility: ["model"] },
		});
		const snapshot = await tool.handler(
			{ action: "snapshot", doc: "small", page: 2 },
			NO_EXTRA,
		);
		expect(snapshot.content.map((item) => item.type)).toEqual([
			"text",
			"image",
		]);
		const id = documents.resolve("small")?.id;
		expect((snapshot.structuredContent as any).maketReader).toMatchObject({
			mode: "document",
			document: {
				name: "small",
				pageCount: 2,
				pages: [
					{ number: 1, name: "Cover" },
					{ number: 2, name: "Back" },
				],
				canvas: { format: "A4", w: 210, h: 297 },
			},
			display: { pages: [1, 2], layout: "page", start: 2, zoom: "fit-width" },
			readingPath: `/documents/${id}/read`,
		});
		expect(JSON.stringify(snapshot.structuredContent).length).toBeLessThan(
			2_000,
		);
		cleanup();
	});

	it("shows pages in the reader with the asked layout, start and zoom, and refuses pages outside the document", async () => {
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
				name: "book",
				canvas: {
					format: "A4",
					orientation: "portrait",
					w: 210,
					h: 297,
					bg: "#fff",
				},
				pages: Array.from({ length: 6 }, (_, index) => ({
					name: `Chapter ${index + 1}`,
					elements: [],
					html: `<p data-id="p${index}">${index + 1}</p>`,
				})),
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
		const shown = await tool.handler(
			{
				action: "show",
				doc: "book",
				pages: "3-5",
				layout: "page",
				start: 4,
				zoom: "actual",
			},
			NO_EXTRA,
		);
		expect(shown.isError).toBeUndefined();
		expect(shown.content.map((item) => item.type)).toEqual(["text"]);
		expect((shown.content[0] as any).text).toContain(
			'Showing pages 3, 4, 5 of "book" in the Maket reader (one page at a time, opening at page 4, actual).',
		);
		expect((shown.content[0] as any).text).toContain("Read it in Maket:");
		expect((shown.structuredContent as any).maketReader.display).toEqual({
			pages: [3, 4, 5],
			layout: "page",
			start: 4,
			zoom: "actual",
		});
		const all = await tool.handler({ action: "show", doc: "book" }, NO_EXTRA);
		expect((all.structuredContent as any).maketReader.display).toEqual({
			pages: [1, 2, 3, 4, 5, 6],
			layout: "scroll",
			start: 1,
			zoom: "fit-width",
		});
		const outside = await tool.handler(
			{ action: "show", doc: "book", pages: [2, 9] },
			NO_EXTRA,
		);
		expect(outside.isError).toBe(true);
		expect((outside.content[0] as any).text).toBe(
			"Page 9 not found: the document has 6 pages",
		);
		const badStart = await tool.handler(
			{ action: "show", doc: "book", pages: 2, start: 3 },
			NO_EXTRA,
		);
		expect((badStart.content[0] as any).text).toBe(
			"start 3 is not one of the shown pages (2)",
		);
		cleanup();
	});

	it("reads every form of the pages argument", () => {
		expect(selectedPages("all", 3)).toEqual([1, 2, 3]);
		expect(selectedPages(2, 3)).toEqual([2]);
		expect(selectedPages("2 - 3", 3)).toEqual([2, 3]);
		expect(selectedPages([3, 1, 3], 3)).toEqual([3, 1]);
		expect(selectedPages("3-2", 3)).toBe("Range 3-2 runs backwards");
		expect(selectedPages(4, 3)).toBe(
			"Page 4 not found: the document has 3 pages",
		);
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
