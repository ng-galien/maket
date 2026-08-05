/**
 * thumbnail — server-side PNG snapshot of a document's page.
 *
 * Renders via the shared `browserPool`: load the page HTML (with the
 * charte CSS injected and asset URIs inlined) into a puppeteer page
 * sized to the canvas pixel dimensions, screenshot, return a PNG
 * Buffer. A small in-memory LRU keyed on `${id}-${updatedAt}-${w}`
 * short-circuits repeat renders; callers invalidate automatically by
 * passing a fresh `updatedAt` once the doc changes.
 *
 * Deps: `documents` (charte CSS resolution), `config` (assets dir),
 * `assets` (mime-from-ext for the image inliner), `browserPool`
 * (puppeteer access). `opts` exists for test overrides only.
 */

import { escapeCssValue, stripStyleClose } from "../lib/css-escape.js";
import { inlineImages } from "../lib/image-inline.js";
import { installNetworkGuard } from "../lib/page-network-guard.js";
import { waitForPageStable } from "../lib/page-stable-wait.js";
import type { Document } from "../types.js";
import type { AssetsService } from "./assets.js";
import type { BrowserPool } from "./browser-pool.js";
import type { Config } from "./config.js";
import type { DocumentRenderer } from "./document-renderer.js";
import type { Documents } from "./documents.js";
import { boxShadowToDropShadow, buildShadowVarMap } from "./pdf.js";

export interface ThumbnailRenderOptions {
	/** 0-based page index. Defaults to 0 (first page). */
	page?: number;
	/** Target width in CSS pixels. Defaults to 400. Height follows the
	 * canvas aspect ratio. */
	widthPx?: number;
	/** Cache-key material. When the doc changes the caller should pass a
	 * fresh value (e.g. `documents`'s `updatedAt`); identical keys hit the
	 * in-memory cache. */
	updatedAt?: string;
}

export interface ThumbnailService {
	/** Render page `page` of `doc` to a PNG Buffer. Empty pages render as a
	 * blank canvas at the doc's background — only a missing page index throws. */
	render(doc: Document, opts?: ThumbnailRenderOptions): Promise<Buffer>;
	/** Drop every cached PNG for a given doc id. */
	invalidate(docId: string): void;
	/** Current cache size — exposed for tests and diagnostics. */
	cacheSize(): number;
}

export interface ThumbnailDeps {
	documents: Documents;
	config: Config;
	assets: AssetsService;
	browserPool: BrowserPool;
	documentRenderer?: Pick<DocumentRenderer, "render">;
}

export interface ThumbnailOptions {
	/** Max entries retained in the in-memory LRU (FIFO eviction when full). */
	maxCacheEntries?: number;
	/** Override for the composed HTML → PNG step — used by tests so no real
	 * puppeteer launch is required. Receives the fully-inlined HTML and the
	 * viewport dimensions, returns the raw PNG Buffer. */
	snapshot?: (
		html: string,
		viewport: { width: number; height: number; deviceScaleFactor: number },
		browserPool: BrowserPool,
	) => Promise<Buffer>;
}

const DEFAULT_WIDTH_PX = 400;
const DEFAULT_CACHE_ENTRIES = 64;
const DEVICE_SCALE_FACTOR = 2; // retina-quality thumbs
const MM_TO_PX = 96 / 25.4; // CSS px per mm at 96 DPI

// code-moniker: ignore[smell-feature-envy-local]
// Export `defaultSnapshot`: orchestrates docs, assets, and headless render for a binary output.
async function defaultSnapshot(
	html: string,
	viewport: { width: number; height: number; deviceScaleFactor: number },
	browserPool: BrowserPool,
): Promise<Buffer> {
	const browser = await browserPool.get();
	const page = await browser.newPage();
	try {
		await installNetworkGuard(page, "offline");
		await page.setViewport(viewport);
		await page.setContent(html, { waitUntil: "networkidle0" });
		await waitForPageStable(page);
		const png = await page.screenshot({
			type: "png",
			clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
			omitBackground: false,
		});
		return Buffer.from(png);
	} finally {
		await page.close();
	}
}

// code-moniker: ignore[smell-feature-envy-local]
// Thumbnail render coordinates cache, charte CSS, image inlining, and headless snapshot.
async function renderThumbnailDocument(ctx: {
	doc: Document;
	renderOpts: { page?: number; widthPx?: number; updatedAt?: string };
	documents: Documents;
	documentRenderer: Pick<DocumentRenderer, "render">;
	config: Config;
	assets: AssetsService;
	browserPool: BrowserPool;
	snapshot: typeof defaultSnapshot;
	cache: Map<string, Buffer>;
	remember: (key: string, buf: Buffer) => void;
}): Promise<Buffer> {
	const {
		doc,
		renderOpts,
		documents,
		documentRenderer,
		config,
		assets,
		browserPool,
		snapshot,
		cache,
		remember,
	} = ctx;
	const page = Math.max(0, Math.floor(renderOpts.page ?? 0));
	const widthPx = Math.max(
		60,
		Math.min(2000, Math.floor(renderOpts.widthPx ?? DEFAULT_WIDTH_PX)),
	);
	const key = `${doc.id}::${renderOpts.updatedAt ?? "-"}::${page}::${widthPx}`;
	const cached = cache.get(key);
	if (cached) {
		cache.delete(key);
		cache.set(key, cached);
		return cached;
	}

	const renderedDoc = documentRenderer.render(doc);
	const pageObj = renderedDoc.pages[page];
	if (!pageObj)
		throw new Error(`Document "${doc.name}" has no page ${page + 1}`);

	const charteCss = documents.charteCss(renderedDoc);
	const shadowVars = buildShadowVarMap(charteCss);
	const inlined = await inlineImages(pageObj.html ?? "", {
		assetsDir: config.ASSETS_DIR,
		pageMm: { w: renderedDoc.canvas.w, h: renderedDoc.canvas.h },
		dpi: 96,
		mimeFromExt: (p) => assets.mimeFromExt(p),
	});
	const resolved = boxShadowToDropShadow(inlined, shadowVars);

	const safeBg = escapeCssValue(renderedDoc.canvas.bg || "#ffffff");
	const safeCharteCss = stripStyleClose(charteCss);
	const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  ${safeCharteCss}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; background: ${safeBg}; overflow: hidden; }
  .page { width: ${renderedDoc.canvas.w}mm; height: ${renderedDoc.canvas.h}mm; background: ${safeBg}; position: relative; overflow: hidden; transform-origin: top left; }
</style>
</head>
<body><div class="page">${resolved}</div></body>
</html>`;

	const canvasPxW = Math.round(renderedDoc.canvas.w * MM_TO_PX);
	const pxH = Math.round(
		(renderedDoc.canvas.h / renderedDoc.canvas.w) * widthPx,
	);
	const scale = widthPx / canvasPxW;
	const scaledHtml = fullHtml.replace(
		".page {",
		`.page { transform: scale(${scale});`,
	);

	const buf = await snapshot(
		scaledHtml,
		{
			width: widthPx,
			height: pxH,
			deviceScaleFactor: DEVICE_SCALE_FACTOR,
		},
		browserPool,
	);
	remember(key, buf);
	return buf;
}

export function createThumbnailService(
	deps: ThumbnailDeps,
	opts: ThumbnailOptions = {},
): ThumbnailService {
	const { documents, config, assets, browserPool } = deps;
	const documentRenderer = deps.documentRenderer ?? {
		render: (doc: Document) => doc,
	};
	const maxEntries = opts.maxCacheEntries ?? DEFAULT_CACHE_ENTRIES;
	const snapshot = opts.snapshot ?? defaultSnapshot;

	const cache = new Map<string, Buffer>();

	function remember(key: string, buf: Buffer): void {
		if (cache.has(key)) cache.delete(key);
		cache.set(key, buf);
		while (cache.size > maxEntries) {
			const oldestKey = cache.keys().next().value;
			if (oldestKey === undefined) break;
			cache.delete(oldestKey);
		}
	}

	return {
		async render(doc, renderOpts = {}) {
			return renderThumbnailDocument({
				doc,
				renderOpts,
				documents,
				documentRenderer,
				config,
				assets,
				browserPool,
				snapshot,
				cache,
				remember,
			});
		},

		invalidate(docId) {
			const prefix = `${docId}::`;
			for (const key of [...cache.keys()]) {
				if (key.startsWith(prefix)) cache.delete(key);
			}
		},

		cacheSize() {
			return cache.size;
		},
	};
}
