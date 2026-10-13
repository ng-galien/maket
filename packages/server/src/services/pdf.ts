/**
 * pdf — Puppeteer-backed PDF export service.
 *
 * Renders a `Document` to a PDF Buffer at a requested DPI (screen/print/hd).
 * Images are inlined as data URIs, downscaled to the page's target pixel size
 * to keep PDF bytes reasonable. Page HTML is otherwise printed as authored, so
 * each PDF page renders as its preview. Every page is then measured in both
 * surfaces (print DOM and single-page preview surface); pages whose element
 * geometry, fonts, or colours differ are returned as `mismatches`.
 *
 * `buildPrintHtml` is exported for the `/print` HTML route.
 *
 * Options follow the same "second argument" pattern as `LayoutService`: Awilix
 * PROXY mode resolves every destructured name on `deps`, so test-only
 * overrides (puppeteer launcher) live on `opts`.
 */

import { measureAutoPageHeights } from "../lib/auto-page-height.js";
import {
	type CollectionRenderMode,
	cursorRenderOptions,
} from "../lib/collection-render.js";
import { inlineImages } from "../lib/image-inline.js";
import { linkPrintPages } from "../lib/page-links.js";
import { installNetworkGuard } from "../lib/page-network-guard.js";
import {
	comparePageRenders,
	measureRenderFrames,
} from "../lib/page-render-fingerprint.js";
import { waitForPageStable } from "../lib/page-stable-wait.js";
import { buildRenderSurfaceHtml } from "../lib/render-surface-html.js";
import type { Document } from "../types.js";
import type { AssetsService } from "./assets.js";
import type { BrowserPool, RenderBrowser, RenderPage } from "./browser-pool.js";
import type { CollectionCursors } from "./collection-cursor.js";
import type { Config } from "./config.js";
import {
	renderDocumentSettled,
	type SettlingDocumentRenderer,
} from "./document-renderer.js";
import type { Documents } from "./documents.js";

const DPI_PRESETS: Record<string, number> = {
	screen: 96,
	print: 150,
	hd: 300,
};

const PX_PER_MM = 96 / 25.4;

/** A page whose PDF rendering differs from its preview rendering. */
export interface PdfPageMismatch {
	/** 1-based page number in the rendered document. */
	page: number;
	name: string;
	/** Number of elements whose box, font, or colours differ. */
	differences: number;
	detail: string;
}

export interface PdfRenderResult {
	buffer: Buffer;
	pageCount: number;
	mismatches: PdfPageMismatch[];
}

/** What to render for pages bound to a collection. `preview` follows the
 * server-owned cursor of each page (what the live canvas shows); the other
 * values force one mode across every bound page. */
export type PdfRowsSelection = "preview" | "current" | "all" | "template";

export interface PdfService {
	/** Render a document to a PDF buffer at the given quality preset. */
	render(
		doc: Document,
		quality?: string,
		rows?: PdfRowsSelection,
	): Promise<PdfRenderResult>;
}

export interface PdfServiceDeps {
	documents: Documents;
	documentRenderer?: SettlingDocumentRenderer;
	collectionCursors?: Pick<CollectionCursors, "resolve">;
	config: Config;
	assets: AssetsService;
	browserPool: BrowserPool;
}

export interface PdfServiceOptions {
	/** Kept for backward-compat with existing tests that pass a puppeteer
	 * launcher override — if provided, wraps it in a throwaway BrowserPool
	 * so the test pipeline stays unchanged. Prefer injecting a mock
	 * BrowserPool via `deps.browserPool` for new code. */
	browserLaunch?: () => Promise<import("puppeteer").Browser>;
	/** Overall deadline of one render, from document rendering to the last
	 * preview measurement. */
	renderTimeoutMs?: number;
}

export const PDF_RENDER_TIMEOUT_MS = 120_000;

/** The step a render is in and the pages it holds open, so a passed deadline
 * can name the step and close the pages. */
interface RenderRun {
	step: string;
	readonly pages: Set<RenderPage>;
}

async function openRunPage(
	run: RenderRun,
	browser: RenderBrowser,
): Promise<RenderPage> {
	const page = await browser.newPage();
	run.pages.add(page);
	return page;
}

async function releaseRunPage(run: RenderRun, page: RenderPage): Promise<void> {
	if (!run.pages.delete(page)) return;
	await page.close();
}

async function runWithRenderDeadline<T>(
	timeoutMs: number,
	work: (run: RenderRun) => Promise<T>,
): Promise<T> {
	const run: RenderRun = { step: "render document", pages: new Set() };
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			const step = run.step;
			const pages = [...run.pages];
			run.pages.clear();
			for (const page of pages) void page.close().catch(() => {});
			reject(
				new Error(
					`PDF render timed out after ${timeoutMs}ms during step "${step}"`,
				),
			);
		}, timeoutMs);
	});
	const running = work(run);
	running.catch(() => {});
	try {
		return await Promise.race([running, deadline]);
	} finally {
		clearTimeout(timer);
	}
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// PDF render orchestrates collections, cursors, asset inlining, and browser pool.
async function renderPdfDocument(
	ctx: {
		documents: Documents;
		config: Config;
		assets: AssetsService;
		documentRenderer: SettlingDocumentRenderer;
		collectionCursors: Pick<CollectionCursors, "resolve">;
		pool: BrowserPool;
		forcedMode: Record<
			Exclude<PdfRowsSelection, "preview">,
			CollectionRenderMode
		>;
		run: RenderRun;
	},
	doc: Document,
	quality = "print",
	rows: PdfRowsSelection = "preview",
): Promise<PdfRenderResult> {
	const {
		documents,
		config,
		assets,
		documentRenderer,
		collectionCursors,
		pool,
		forcedMode,
		run,
	} = ctx;
	run.step = "render document";
	const renderedDoc = await renderDocumentSettled(documentRenderer, doc, {
		collection: cursorRenderOptions(
			doc,
			(docName, pageIndex) => collectionCursors.resolve(docName, pageIndex),
			rows === "preview" ? undefined : forcedMode[rows],
		),
	});
	const dpi = DPI_PRESETS[quality] || 150;
	const sourcePages = renderedDoc.pages
		.map((p, index) => ({ number: index + 1, name: p.name, html: p.html }))
		.filter((p): p is { number: number; name: string; html: string } =>
			Boolean(p.html),
		);
	if (sourcePages.length === 0) throw new Error("No pages with HTML content");

	const charteCss = documents.charteCss(renderedDoc);
	run.step = "inline images";
	const pageHtmls = await Promise.all(
		sourcePages.map((p) =>
			inlineImages(p.html, {
				assetsDir: config.ASSETS_DIR,
				pageMm: {
					w: renderedDoc.canvas.w,
					h:
						renderedDoc.canvas.format === "AUTO"
							? undefined
							: renderedDoc.canvas.h,
				},
				dpi,
				mimeFromExt: (path) => assets.mimeFromExt(path),
			}),
		),
	);

	const { w, h } = renderedDoc.canvas;
	const viewport = {
		width: Math.ceil(w * PX_PER_MM),
		height:
			renderedDoc.canvas.format === "AUTO" ? 900 : Math.ceil(h * PX_PER_MM),
	};
	const fullHtml = buildPrintHtml({
		source: doc,
		rendered: renderedDoc,
		pageHtmls,
		charteCss,
	});

	run.step = "open render page";
	const b = await pool.get();
	const page = await openRunPage(run, b);
	try {
		run.step = "install network guard";
		await installNetworkGuard(page, "offline");
		run.step = "set viewport";
		if (renderedDoc.canvas.format === "AUTO")
			await page.emulateMediaType?.("print");
		await page.setViewport(viewport);
		run.step = "set content";
		await page.setContent(fullHtml, { waitUntil: "load" });
		run.step = "wait for page stable";
		await waitForPageStable(page);
		run.step = "measure print frames";
		if (renderedDoc.canvas.format === "AUTO")
			await measureAutoPageHeights(page, true);
		const printed = await measureRenderFrames(page);
		run.step = "print to PDF";
		const pdfBuffer = await page.pdf({
			width: `${w}mm`,
			height: `${h}mm`,
			preferCSSPageSize: renderedDoc.canvas.format === "AUTO",
			printBackground: true,
			margin: { top: "0", right: "0", bottom: "0", left: "0" },
		});
		run.step = "measure preview frames";
		const previews = await measurePreviewFrames(run, b, viewport, {
			canvas: renderedDoc.canvas,
			pageHtmls,
			charteCss,
		});
		const mismatches: PdfPageMismatch[] = [];
		sourcePages.forEach((source, i) => {
			const difference = comparePageRenders(
				printed[i] ?? [],
				previews[i] ?? [],
			);
			if (difference)
				mismatches.push({
					page: source.number,
					name: source.name,
					...difference,
				});
		});
		return {
			buffer: Buffer.from(pdfBuffer),
			pageCount: pageHtmls.length,
			mismatches,
		};
	} finally {
		await releaseRunPage(run, page);
	}
}

/** Measure each page alone on the preview (snapshot) surface. */
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Browser measurement loop: drives one render page through the preview surface helpers, not a Document method.
async function measurePreviewFrames(
	run: RenderRun,
	browser: RenderBrowser,
	viewport: { width: number; height: number },
	input: {
		canvas: Document["canvas"];
		pageHtmls: string[];
		charteCss: string;
	},
): Promise<ReturnType<typeof measureRenderFrames>> {
	const page: RenderPage = await openRunPage(run, browser);
	try {
		await installNetworkGuard(page, "offline");
		await page.setViewport(viewport);
		const frames: Awaited<ReturnType<typeof measureRenderFrames>> = [];
		for (const html of input.pageHtmls) {
			await page.setContent(
				buildRenderSurfaceHtml({
					canvas: input.canvas,
					pageHtmls: [html],
					charteCss: input.charteCss,
					surface: { kind: "snapshot" },
				}),
				{ waitUntil: "load" },
			);
			await waitForPageStable(page);
			if (input.canvas.format === "AUTO") await measureAutoPageHeights(page);
			const [frame] = await measureRenderFrames(page);
			frames.push(frame ?? []);
		}
		return frames;
	} finally {
		await releaseRunPage(run, page);
	}
}

export function createPdfService(
	deps: PdfServiceDeps,
	opts: PdfServiceOptions = {},
): PdfService {
	const { documents, config, assets, browserPool } = deps;
	const documentRenderer = deps.documentRenderer ?? {
		render: (doc: Document) => doc,
	};
	const collectionCursors = deps.collectionCursors ?? { resolve: () => null };
	const forcedMode: Record<
		Exclude<PdfRowsSelection, "preview">,
		CollectionRenderMode
	> = { current: "rendered", all: "all", template: "template" };
	const pool: BrowserPool = opts.browserLaunch
		? {
				get: async () =>
					(await opts.browserLaunch?.()) as unknown as RenderBrowser,
				async dispose() {},
			}
		: browserPool;
	const renderTimeoutMs = Math.max(
		1,
		opts.renderTimeoutMs ?? PDF_RENDER_TIMEOUT_MS,
	);

	return {
		render: (doc, quality = "print", rows = "preview") =>
			runWithRenderDeadline(renderTimeoutMs, (run) =>
				renderPdfDocument(
					{
						documents,
						config,
						assets,
						documentRenderer,
						collectionCursors,
						pool,
						forcedMode,
						run,
					},
					doc,
					quality,
					rows,
				),
			),
	};
}

// ============================================================
// Pure helpers (shared with the /print HTML route)
// ============================================================

/**
 * Build the print-ready HTML for a document — shared by the `/print` route
 * and `PdfService.render`. `pageHtmls` follow the rendered pages that carry
 * HTML, in order. Each printed page carries the anchor id targeted by the
 * rewritten in-document page links, which Chromium keeps as internal PDF
 * links.
 */
export function buildPrintHtml({
	source,
	rendered,
	pageHtmls,
	charteCss,
}: {
	source: Document;
	rendered: Document;
	pageHtmls: string[];
	charteCss: string;
}): string {
	const printedPageIds = rendered.pages
		.filter((page) => Boolean(page.html))
		.map((page) => page.id);
	return buildRenderSurfaceHtml({
		canvas: rendered.canvas,
		pageHtmls: linkPrintPages(source.pages, printedPageIds, pageHtmls),
		charteCss,
		surface: { kind: "print" },
	});
}
