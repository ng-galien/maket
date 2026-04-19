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

import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import puppeteer, { type Browser } from "puppeteer";
import { parseCharteVars } from "../lib/charte-css.js";
import type { Document } from "../types.js";
import type { AssetsService } from "./assets.js";
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
}

export interface PdfServiceOptions {
	/** Override for the puppeteer launcher (defaults to `puppeteer.launch`). */
	browserLaunch?: () => Promise<Browser>;
}

export function createPdfService(
	deps: PdfServiceDeps,
	opts: PdfServiceOptions = {},
): PdfService {
	const { documents, config, assets } = deps;
	const browserLaunch =
		opts.browserLaunch ??
		(() => puppeteer.launch({ headless: true, args: ["--no-sandbox"] }));

	let browser: Browser | null = null;
	async function getBrowser(): Promise<Browser> {
		if (browser?.connected) return browser;
		browser = await browserLaunch();
		browser.on("disconnected", () => {
			browser = null;
		});
		return browser;
	}

	async function inlineImages(
		html: string,
		pageDims: { w: number; h: number },
		dpi: number,
	): Promise<string> {
		const maxW = Math.ceil((pageDims.w * dpi) / 25.4);
		const maxH = Math.ceil((pageDims.h * dpi) / 25.4);
		const srcRegex = /\/assets\/([^"')\s]+\.(?:jpg|jpeg|png|webp|svg|gif))/gi;
		const matches = [...html.matchAll(srcRegex)];
		if (!matches.length) return html;

		const filenames = [
			...new Set(matches.map((m) => m[1]).filter((f): f is string => !!f)),
		];
		const dataUris = new Map<string, string>();

		const { Jimp } = await import("jimp");

		await Promise.all(
			filenames.map(async (filename) => {
				const absPath = join(config.ASSETS_DIR, filename);
				if (!existsSync(absPath)) return;
				try {
					const ext = extname(filename).toLowerCase();
					if (ext === ".svg") {
						const b64 = readFileSync(absPath).toString("base64");
						dataUris.set(filename, `data:image/svg+xml;base64,${b64}`);
						return;
					}
					const image = await Jimp.read(absPath);
					if (image.width > maxW || image.height > maxH) {
						image.scaleToFit({ w: maxW, h: maxH });
					}
					const isPng = ext === ".png";
					const buf = isPng
						? await image.getBuffer("image/png")
						: await image.getBuffer("image/jpeg", { quality: 80 });
					const mime = isPng ? "image/png" : "image/jpeg";
					dataUris.set(
						filename,
						`data:${mime};base64,${buf.toString("base64")}`,
					);
				} catch {
					const b64 = readFileSync(absPath).toString("base64");
					dataUris.set(
						filename,
						`data:${assets.mimeFromExt(absPath)};base64,${b64}`,
					);
				}
			}),
		);

		let result = html;
		for (const [filename, dataUri] of dataUris) {
			result = result.replaceAll(`/assets/${filename}`, dataUri);
		}
		return result;
	}

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
					const inlined = await inlineImages(html, doc.canvas, dpi);
					return boxShadowToDropShadow(inlined, shadowVars);
				}),
			);

			const { w, h } = doc.canvas;
			const fullHtml = buildPrintHtml(doc, pageHtmls, charteCss);

			const b = await getBrowser();
			const p = await b.newPage();
			try {
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

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  ${charteCss}
  @page { size: ${w}mm ${h}mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  body { margin: 0; padding: 0; }
  .page { width: ${w}mm; height: ${h}mm; background: ${bg || "#ffffff"}; position: relative; overflow: hidden; }
</style>
</head>
<body>${pagesHtml}</body>
</html>`;
}
