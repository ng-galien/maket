/**
 * export routes — /print (HTML with auto-print script) + /api/export-pdf (PDF
 * rendered by Puppeteer via PdfService) + /api/export-maket, /api/import-maket
 * (.maket bundle with documents + referenced chartes + asset binaries).
 */

import { Router as createRouter, type Router } from "express";
import {
	collectAssetFilenames,
	loadAssetsFromDir,
} from "../lib/asset-collector.js";
import { writeBundleAssets } from "../lib/asset-writer.js";
import { BodyTooLargeError, readBoundedBody } from "../lib/bounded-body.js";
import { requireBrowserContextLoopback } from "../lib/local-origin.js";
import {
	bundleFilename,
	decodeBundle,
	encodeBundleV2,
	uniqueName,
} from "../lib/maket-format.js";
import { stripActiveHtml } from "../lib/strip-active-html.js";

// Cap on `.maket` bundle uploads. v2 bundles carry asset binaries, so the
// bound is looser than v1's. `decodeBundle` is the next layer of defence.
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;

import type { Bus } from "../services/bus.js";
import type { Config } from "../services/config.js";
import type { Documents } from "../services/documents.js";
import {
	boxShadowToDropShadow,
	buildPrintHtml,
	buildShadowVarMap,
	type PdfService,
} from "../services/pdf.js";
import type { Store } from "../services/store.js";
import { type Charte, createDocument } from "../types.js";

export interface ExportRouterDeps {
	documents: Documents;
	pdfService: PdfService;
	store: Store;
	bus: Bus;
	config: Config;
}

function safeName(raw: string): string {
	return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "export";
}

export function createExportRouter({
	documents,
	pdfService,
	store,
	bus,
	config,
}: ExportRouterDeps): Router {
	const router = createRouter();

	router.use(requireBrowserContextLoopback);

	router.get("/print", async (req, res) => {
		const name = req.query.name as string | undefined;
		if (!name) return res.status(400).send("Missing ?name= parameter");
		const d = documents.resolveOrLoad(name);
		if (!d) return res.status(400).send(`Document "${name}" not found`);

		const rawHtmls = d.pages.map((p) => p.html).filter(Boolean) as string[];
		if (!rawHtmls.length)
			return res.status(400).send("No pages with HTML content");

		const charteCssStr = documents.charteCss(d);
		const shadowVars = buildShadowVarMap(charteCssStr);
		const pageHtmls = rawHtmls.map((html) =>
			boxShadowToDropShadow(html, shadowVars),
		);

		const printHtml = buildPrintHtml(d, pageHtmls, charteCssStr);
		const html = printHtml.replace(
			"</body>",
			"<script>window.onafterprint=()=>window.close();window.onload=()=>setTimeout(()=>window.print(),400)</script></body>",
		);

		res.setHeader("Content-Type", "text/html");
		res.send(html);
	});

	router.get("/api/export-pdf", async (req, res) => {
		try {
			const pdfName = req.query.name as string | undefined;
			if (!pdfName)
				return res.status(400).json({ error: "Missing ?name= parameter" });
			const d = documents.resolveOrLoad(pdfName);
			if (!d)
				return res
					.status(400)
					.json({ error: `Document "${pdfName}" not found` });

			const quality = (req.query.quality as string) || "print";
			const { buffer } = await pdfService.render(d, quality);

			res.setHeader("Content-Type", "application/pdf");
			res.setHeader(
				"Content-Disposition",
				`attachment; filename="${safeName(d.name)}.pdf"`,
			);
			return res.send(buffer);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	});

	router.get("/api/export-maket", async (req, res) => {
		try {
			const single = req.query.name as string | undefined;
			const csv = req.query.names as string | undefined;
			const names = csv
				? csv
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean)
				: single
					? [single]
					: [...documents.all().keys()];

			if (names.length === 0)
				return res.status(400).json({ error: "No documents to export" });

			const docs = [];
			for (const n of names) {
				const d = documents.resolveOrLoad(n);
				if (!d)
					return res.status(404).json({ error: `Document "${n}" not found` });
				docs.push(d);
			}

			const charteNames = new Set<string>();
			for (const d of docs) if (d.meta?.charte) charteNames.add(d.meta.charte);
			const chartes: Charte[] = [];
			for (const cn of charteNames) {
				try {
					const c = store.loadCharte(cn);
					if (c) chartes.push(c);
				} catch {}
			}

			const refs = collectAssetFilenames(docs);
			const { assets } = loadAssetsFromDir(refs, config.ASSETS_DIR);
			const buf = await encodeBundleV2(docs, chartes, assets);
			const baseName = docs.length === 1 ? docs[0]?.name : "maket-bundle";
			res.setHeader("Content-Type", "application/zip");
			res.setHeader(
				"Content-Disposition",
				`attachment; filename="${bundleFilename(baseName)}"`,
			);
			return res.send(buf);
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	});

	router.post("/api/import-maket", async (req, res) => {
		try {
			let body: Buffer;
			try {
				body = await readBoundedBody(req, MAX_BUNDLE_BYTES);
			} catch (e) {
				if (e instanceof BodyTooLargeError) {
					return res.status(413).json({ error: e.message });
				}
				throw e;
			}
			if (body.length === 0)
				return res.status(400).json({ error: "Empty upload" });

			let bundle: Awaited<ReturnType<typeof decodeBundle>>;
			try {
				bundle = await decodeBundle(body);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				return res.status(400).json({ error: msg });
			}

			const imported: string[] = [];
			const renamed: { from: string; to: string }[] = [];
			const all = documents.all();
			for (const snap of bundle.documents) {
				const finalName = uniqueName(snap.name, (n) => all.has(n));
				const sanitisedPages = snap.pages?.length
					? snap.pages.map((p) => ({
							...p,
							html: p.html ? stripActiveHtml(p.html) : p.html,
						}))
					: undefined;
				const doc = createDocument({
					name: finalName,
					category: snap.category || "general",
					canvas: snap.canvas,
					meta: snap.meta || {},
					pages: sanitisedPages,
					activePage: snap.activePage ?? 0,
					nextId: snap.nextId ?? 1,
				});
				all.set(finalName, doc);
				documents.persist(finalName);
				bus.emit("document:created", { docName: finalName });
				imported.push(finalName);
				if (finalName !== snap.name)
					renamed.push({ from: snap.name, to: finalName });
			}

			const chartesAdded: string[] = [];
			const chartesSkipped: string[] = [];
			for (const c of bundle.chartes) {
				try {
					if (store.loadCharte(c.name)) {
						chartesSkipped.push(c.name);
						continue;
					}
					store.saveCharte(c);
					bus.emit("charte:updated", { name: c.name, css: c.css || "" });
					chartesAdded.push(c.name);
				} catch {}
			}

			const assetReport = writeBundleAssets(bundle.assets, config.ASSETS_DIR);
			if (assetReport.written > 0) {
				bus.emit("assets:changed", {});
			}

			bus.emit("toast", {
				text: `Imported ${imported.length} document(s)${chartesAdded.length ? ` + ${chartesAdded.length} charte(s)` : ""}${assetReport.written ? ` + ${assetReport.written} asset(s)` : ""}`,
				level: "success",
			});

			return res.json({
				ok: true,
				version: bundle.version,
				documents: imported,
				renamed,
				chartesAdded,
				chartesSkipped,
				assetsWritten: assetReport.written,
				assetsSkipped: assetReport.skipped,
				assetsRejected: assetReport.rejected.length,
				exportedAt: bundle.exportedAt,
			});
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	});

	return router;
}
