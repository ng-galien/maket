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
	"Renders every page via headless Chromium at the canvas's true mm size, then writes to EXPORTS_DIR/<doc>.pdf. Charte CSS is inlined so fonts and tokens render identically to the live preview.",
	"  quality — screen (96 DPI, smallest), print (150 DPI, default), hd (300 DPI).",
	"  rows    — collection-bound pages: preview (default, follows the page cursor), current (cursor row only), all (one page per row), template (raw placeholders). Check the cursor first with maket_collection action=cursor.",
].join("\n");

export function createMaketPdfTool(deps: PdfDeps): ToolHandler {
	const { documents, pdfService, config } = deps;
	return {
		metadata: {
			name: "maket_pdf",
			description: DESCRIPTION,
			schema: ExportSchema,
		},
		handler: async (rawArgs) => {
			const args = ExportSchema.parse(rawArgs);
			const doc = documents.resolveOrLoad(args.doc);
			if (!doc) return text(`Document "${args.doc}" not found`, true);
			try {
				const { buffer, pageCount } = await pdfService.render(
					doc,
					args.quality || "print",
					args.rows || "preview",
				);
				const outPath = join(
					config.EXPORTS_DIR,
					`${safeFilename(doc.name)}.pdf`,
				);
				writeFileSync(outPath, buffer);
				return text(
					`PDF exported: ${outPath} (${Math.round(buffer.length / 1024)} KB, ${pageCount} page${pageCount > 1 ? "s" : ""})`,
				);
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				return text(`PDF export failed: ${message}`, true);
			}
		},
	};
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
