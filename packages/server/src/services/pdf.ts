/**
 * pdf — Puppeteer-backed PDF export service.
 *
 * Renders a `Document` to a PDF Buffer at a requested DPI (screen/print/hd).
 * Images are inlined as data URIs, downscaled to the page's target pixel size
 * to keep PDF bytes reasonable; box-shadow is rewritten to drop-shadow because
 * Chrome's print engine drops the former.
 *
 * Pure helpers (`buildPrintHtml`, `buildShadowVarMap`, `boxShadowToDropShadow`)
 * are exported alongside the service — the `/print` HTML route in `index.ts`
 * uses them directly without instantiating a service.
 *
 * Options follow the same "second argument" pattern as `LayoutService`: Awilix
 * PROXY mode resolves every destructured name on `deps`, so test-only
 * overrides (puppeteer launcher, Jimp loader) live on `opts`.
 */

import { parseCharteVars } from "../lib/charte-css.js";
import { escapeCssValue, stripStyleClose } from "../lib/css-escape.js";
import { inlineImages } from "../lib/image-inline.js";
import { installNetworkGuard } from "../lib/page-network-guard.js";
import type { Document } from "../types.js";
import type { AssetsService } from "./assets.js";
import type { BrowserPool } from "./browser-pool.js";
import type { Config } from "./config.js";
import type { Documents } from "./documents.js";

const DPI_PRESETS: Record<string, number> = {
	screen: 96,
	print: 150,
	hd: 300,
};

export interface PdfRenderResult {
	buffer: Buffer;
	pageCount: number;
}

export interface PdfService {
	/** Render a document to a PDF buffer at the given quality preset. */
	render(doc: Document, quality?: string): Promise<PdfRenderResult>;
}

export interface PdfServiceDeps {
	documents: Documents;
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
}

export function createPdfService(
	deps: PdfServiceDeps,
	opts: PdfServiceOptions = {},
): PdfService {
	const { documents, config, assets, browserPool } = deps;
	// Test shim — some existing fixtures pass `browserLaunch` and expect it to
	// throw in place of a real browser. We honour that by redirecting `get()`.
	const pool: BrowserPool = opts.browserLaunch
		? {
				get: opts.browserLaunch,
				async dispose() {
					/* no-op — caller owns the launcher */
				},
			}
		: browserPool;

	return {
		async render(doc, quality = "print") {
			const dpi = DPI_PRESETS[quality] || 150;
			const rawHtmls = doc.pages
				.map((p) => p.html)
				.filter((h): h is string => Boolean(h));
			if (rawHtmls.length === 0) throw new Error("No pages with HTML content");

			const charteCss = documents.charteCss(doc);
			const shadowVars = buildShadowVarMap(charteCss);

			const pageHtmls = await Promise.all(
				rawHtmls.map(async (html) => {
					const inlined = await inlineImages(html, {
						assetsDir: config.ASSETS_DIR,
						pageMm: { w: doc.canvas.w, h: doc.canvas.h },
						dpi,
						mimeFromExt: (p) => assets.mimeFromExt(p),
					});
					return boxShadowToDropShadow(inlined, shadowVars);
				}),
			);

			const { w, h } = doc.canvas;
			const fullHtml = buildPrintHtml(doc, pageHtmls, charteCss);

			const b = await pool.get();
			const p = await b.newPage();
			try {
				await installNetworkGuard(p, "offline");
				await p.setContent(fullHtml, { waitUntil: "networkidle0" });
				await p.evaluate(() => document.fonts.ready);
				const pdfBuffer = await p.pdf({
					width: `${w}mm`,
					height: `${h}mm`,
					printBackground: true,
					margin: { top: "0", right: "0", bottom: "0", left: "0" },
				});
				return {
					buffer: Buffer.from(pdfBuffer),
					pageCount: pageHtmls.length,
				};
			} finally {
				await p.close();
			}
		},
	};
}

// ============================================================
// Pure helpers (shared with the /print HTML route and tests)
// ============================================================

/**
 * Convert box-shadow declarations to filter:drop-shadow(...). box-shadow
 * renders inconsistently in Chrome's print engine; drop-shadow does not.
 */
export function boxShadowToDropShadow(
	html: string,
	shadowVars: Map<string, string>,
): string {
	return html.replace(/box-shadow\s*:\s*([^;"]+)/g, (_full, value: string) => {
		let resolved = value.trim();
		resolved = resolved.replace(
			/var\(([^)]+)\)/g,
			(_m, varName: string) => shadowVars.get(varName.trim()) || "none",
		);
		if (resolved === "none") return "box-shadow:none";
		return `filter:drop-shadow(${resolved})`;
	});
}

/** Extract --charte-shadow-* values from a charteCss string. */
export function buildShadowVarMap(charteCss: string): Map<string, string> {
	const shadows = new Map<string, string>();
	for (const [k, v] of parseCharteVars(charteCss)) {
		if (k.startsWith("--charte-shadow-")) shadows.set(k, v);
	}
	return shadows;
}

/**
 * Build the print-ready HTML for a document — shared by the `/print` route
 * and `PdfService.render`.
 */
export function buildPrintHtml(
	doc: Document,
	pageHtmls: string[],
	charteCss: string,
): string {
	const { w, h, bg } = doc.canvas;
	const pagesHtml = pageHtmls
		.map(
			(html, i) => `
    <div class="page" ${i > 0 ? 'style="page-break-before: always"' : ""}>
      ${html}
    </div>
  `,
		)
		.join("\n");

	const safeBg = escapeCssValue(bg || "#ffffff");
	const safeCharteCss = stripStyleClose(charteCss);
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  ${safeCharteCss}
  @page { size: ${w}mm ${h}mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  body { margin: 0; padding: 0; }
  .page { width: ${w}mm; height: ${h}mm; background: ${safeBg}; position: relative; overflow: hidden; }
</style>
</head>
<body>${pagesHtml}</body>
</html>`;
}
