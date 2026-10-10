/**
 * pdf plugin — export_pdf_html.
 *
 * Deps: `documents` (doc lookup), `pdfService` (headless render), `config`
 * (EXPORTS_DIR for the output path).
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import type { Config } from "../services/config.js";
import type { Documents } from "../services/documents.js";
import type { PdfService } from "../services/pdf.js";
import { text } from "./_helpers.js";

export interface PdfDeps {
	documents: Documents;
	pdfService: PdfService;
	config: Config;
}

function safeFilename(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

const ExportSchema = z.object({
	doc: z.string().describe("Document name."),
	quality: z
		.enum(["screen", "print", "hd"])
		.optional()
		.describe("DPI preset: screen=96, print=150 (default), hd=300."),
	rows: z
		.enum(["preview", "current", "all", "template"])
		.optional()
		.describe(
			"For pages bound to a collection: preview (default) follows each page's cursor — what the live canvas shows; current = the cursor's row only; all = one page per row (mail merge); template = raw placeholders.",
		),
});

const DESCRIPTION = [
	"When to use: export a document to PDF for sharing or print. One call renders every page in order. For a single-page raster (PNG), use maket_preview snapshot instead.",
	"",
	"Renders every page via headless Chromium at the canvas's true mm size, then writes to EXPORTS_DIR/<doc>.pdf. Charte CSS is inlined so fonts and tokens render identically to the live preview. The result lists, by number and name, every page whose PDF rendering differs from its preview (element boxes, fonts, colours).",
	"  quality — screen (96 DPI, smallest), print (150 DPI, default), hd (300 DPI).",
	"  rows    — collection-bound pages: preview (default, follows the page cursor), current (cursor row only), all (one page per row), template (raw placeholders). Check the cursor first with maket_collection action=cursor.",
].join("\n");

export function createMaketPdfTool(deps: PdfDeps): ToolHandler {
	return {
		metadata: {
			name: "maket_pdf",
			description: DESCRIPTION,
			schema: ExportSchema,
		},
		handler: (rawArgs) => handleMaketPdfTool(rawArgs, deps),
	};
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP handlers are adapter boundaries: this one renders through the PDF service, writes the export file and reports preview mismatches.
async function handleMaketPdfTool(rawArgs: unknown, deps: PdfDeps) {
	const { documents, pdfService, config } = deps;
	const args = ExportSchema.parse(rawArgs);
	const doc = documents.resolveOrLoad(args.doc);
	if (!doc) return text(`Document "${args.doc}" not found`, true);
	try {
		const { buffer, pageCount, mismatches } = await pdfService.render(
			doc,
			args.quality || "print",
			args.rows || "preview",
		);
		const outPath = join(config.EXPORTS_DIR, `${safeFilename(doc.name)}.pdf`);
		writeFileSync(outPath, buffer);
		const summary = `PDF exported: ${outPath} (${Math.round(buffer.length / 1024)} KB, ${pageCount} page${pageCount > 1 ? "s" : ""})`;
		if (mismatches.length === 0)
			return text(`${summary}\nEvery page renders as its preview.`);
		return text(
			[
				summary,
				`${mismatches.length} page${mismatches.length > 1 ? "s render" : " renders"} differently in the PDF than in the preview:`,
				...mismatches.map(
					(m) =>
						`  page ${m.page} "${m.name}": ${m.differences} element${m.differences > 1 ? "s differ" : " differs"} (${m.detail})`,
				),
			].join("\n"),
			{
				next: mismatches.map(
					(m) => `maket_preview action=snapshot doc=${doc.name} page=${m.page}`,
				),
			},
		);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return text(`PDF export failed: ${message}`, true);
	}
}

export const pdfPack: ToolPack = {
	id: "pdf",
	name: "Pdf",
	requires: ["documents", "pdfService", "config"],
	declaresTools: ["maket_pdf"],
	register(container) {
		container.register({
			maketPdfTool: asFunction(createMaketPdfTool).singleton(),
		});
	},
};
