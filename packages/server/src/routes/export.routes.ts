/**
 * export routes — /print (HTML with auto-print script) + /api/export-pdf (PDF
 * rendered by Puppeteer via PdfService).
 */

import { Router as createRouter, type Router } from "express";
import type { Documents } from "../services/documents.js";
import {
	boxShadowToDropShadow,
	buildPrintHtml,
	buildShadowVarMap,
	type PdfService,
} from "../services/pdf.js";

export interface ExportRouterDeps {
	documents: Documents;
	pdfService: PdfService;
}

function safeName(raw: string): string {
	return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "export";
}

export function createExportRouter({
	documents,
	pdfService,
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

	return router;
}
