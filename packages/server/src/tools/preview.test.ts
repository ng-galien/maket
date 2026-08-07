import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetsService } from "../services/assets.js";
import type { Config } from "../services/config.js";
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
	};
	const browser = {
		newPage: vi.fn(async () => page),
		close: vi.fn(async () => {}),
	};
	return {
		execFile: vi.fn(),
		inlineImages: vi.fn(async (html: string) => html),
		installNetworkGuard: vi.fn(async () => {}),
		page,
		browser,
		launch: vi.fn(async () => browser),
	};
});

vi.mock("puppeteer", () => ({
	default: { launch: previewMocks.launch },
}));

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
	return {
		store,
		documents,
		config,
		assets,
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
	previewMocks.browser.newPage.mockClear();
	previewMocks.browser.close.mockClear();
	previewMocks.launch.mockClear();
});

describe("previewPack — registration", () => {
	it("declares id and deps", () => {
		expect(previewPack.id).toBe("preview");
		expect(previewPack.requires).toEqual(
			expect.arrayContaining(["documents", "config"]),
		);
	});
});

describe("maket_preview — action=snapshot", () => {
	it("renders a snapshot, writes the PNG, and returns inline image content", async () => {
		const { store, documents, config, assets, cleanup } = fixture();
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

		const tool = createMaketPreviewTool({ documents, config, assets });
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
		expect(previewMocks.launch).toHaveBeenCalledWith(
			expect.objectContaining({ headless: "shell" }),
		);
		expect(previewMocks.browser.close).toHaveBeenCalledOnce();
		expect(readFileSync(join(config.EXPORTS_DIR, "d.png"))).toEqual(
			Buffer.from("png"),
		);
		expect((res.content[0] as any).text).toMatch(/Snapshot saved:/);
		expect((res.content[1] as any).data).toBe(
			Buffer.from("png").toString("base64"),
		);
		cleanup();
	});

	it("errors when document is missing", async () => {
		const { documents, config, assets, cleanup } = fixture();
		const tool = createMaketPreviewTool({ documents, config, assets });
		const res = await tool.handler(
			{ action: "snapshot", doc: "ghost", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("errors when page is out of range", async () => {
		const { store, documents, config, assets, cleanup } = fixture();
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
		const tool = createMaketPreviewTool({ documents, config, assets });
		const res = await tool.handler(
			{ action: "snapshot", doc: "d", page: 99 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("errors when page has no HTML", async () => {
		const { store, documents, config, assets, cleanup } = fixture();
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
		const tool = createMaketPreviewTool({ documents, config, assets });
		const res = await tool.handler(
			{ action: "snapshot", doc: "d", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("errors when doc/page args are missing", async () => {
		const { documents, config, assets, cleanup } = fixture();
		const tool = createMaketPreviewTool({ documents, config, assets });
		const res = await tool.handler({ action: "snapshot" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		cleanup();
	});
});

describe("maket_preview — action=open", () => {
	it("opens the live preview URL in the system browser", async () => {
		const { documents, config, assets, cleanup } = fixture();
		const tool = createMaketPreviewTool({ documents, config, assets });

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
