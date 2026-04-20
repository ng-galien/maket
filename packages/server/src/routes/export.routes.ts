/**
 * export routes — /print (HTML with auto-print script) + /api/export-pdf (PDF
 * rendered by Puppeteer via PdfService) + /api/export-maket, /api/import-maket
 * (gzipped JSON bundle with documents + referenced chartes).
 */

import { Router as createRouter, type Router } from "express";
import {
	bundleFilename,
	decodeBundle,
	encodeBundle,
	uniqueName,
} from "../lib/maket-format.js";
import type { Bus } from "../services/bus.js";
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
}

function safeName(raw: string): string {
	return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "export";
}

export function createExportRouter({
	documents,
	pdfService,
	store,
	bus,
}: ExportRouterDeps): Router {
	const router = createRouter();

	// Print-ready HTML — opens in the user's browser, auto-triggers print dialog.
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
			// biome-ignore lint/suspicious/noExplicitAny: error shape varies
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	});

	// .maket bundle export — ?name=foo for a single doc, ?names=a,b for a list,
	// omit both to export every document. Referenced chartes are embedded.
	router.get("/api/export-maket", (req, res) => {
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
				} catch {
					/* best-effort */
				}
			}

			const buf = encodeBundle(docs, chartes);
			const baseName = docs.length === 1 ? docs[0]?.name : "maket-bundle";
			res.setHeader("Content-Type", "application/gzip");
			res.setHeader(
				"Content-Disposition",
				`attachment; filename="${bundleFilename(baseName)}"`,
			);
			return res.send(buf);
			// biome-ignore lint/suspicious/noExplicitAny: error shape varies
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	});

	// .maket bundle import — raw gzipped body (application/gzip or
	// application/octet-stream). Returns { documents: string[], chartes: string[] }.
	router.post("/api/import-maket", async (req, res) => {
		try {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(chunk as Buffer);
			const body = Buffer.concat(chunks);
			if (body.length === 0)
				return res.status(400).json({ error: "Empty upload" });

			let bundle: ReturnType<typeof decodeBundle>;
			try {
				bundle = decodeBundle(body);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				return res.status(400).json({ error: msg });
			}

			const imported: string[] = [];
			const renamed: { from: string; to: string }[] = [];
			const all = documents.all();
			for (const snap of bundle.documents) {
				const finalName = uniqueName(snap.name, (n) => all.has(n));
				const doc = createDocument({
					name: finalName,
					category: snap.category || "general",
					canvas: snap.canvas,
					meta: snap.meta || {},
					pages: snap.pages?.length ? snap.pages : undefined,
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
				} catch {
					/* best-effort */
				}
			}

			bus.emit("toast", {
				text: `Imported ${imported.length} document(s)${chartesAdded.length ? ` + ${chartesAdded.length} charte(s)` : ""}`,
				level: "success",
			});

			return res.json({
				ok: true,
				documents: imported,
				renamed,
				chartesAdded,
				chartesSkipped,
				exportedAt: bundle.exportedAt,
			});
			// biome-ignore lint/suspicious/noExplicitAny: error shape varies
		} catch (e: any) {
			res.status(500).json({ error: e.message });
		}
	});

	return router;
}
