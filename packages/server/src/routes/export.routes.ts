/**
 * export routes — /print (HTML with auto-print script) + /api/export-pdf (PDF
 * rendered by Puppeteer via PdfService) + /api/export-maket, /api/import-maket
 * (.maket bundle with documents + referenced chartes + asset binaries).
 */

import type { Request, Response } from "express";
import { Router as createRouter, type Router } from "express";
import { BodyTooLargeError, readBoundedBody } from "../lib/bounded-body.js";
import {
	type CollectionRenderMode,
	type CollectionRenderOptions,
	cursorRenderOptions,
} from "../lib/collection-render.js";
import { requireBrowserContextLoopback } from "../lib/local-origin.js";
import { decodeBundle } from "../lib/maket-format.js";

// Cap on `.maket` bundle uploads. v2 bundles carry asset binaries, so the
// bound is looser than v1's. `decodeBundle` is the next layer of defence.
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;
const PRINT_AUTOSTART_SCRIPT =
	"window.onafterprint=()=>window.close();window.addEventListener('load',()=>setTimeout(()=>window.print(),400));";

import type { BundleExportService } from "../services/bundle-export.js";
import type { BundleImportService } from "../services/bundle-import.js";
import type { CollectionCursors } from "../services/collection-cursor.js";
import type { DocumentRenderer } from "../services/document-renderer.js";
import type { Documents } from "../services/documents.js";
import {
	boxShadowToDropShadow,
	buildPrintHtml,
	buildShadowVarMap,
	type PdfService,
} from "../services/pdf.js";
import type { Document } from "../types.js";

export interface ExportRouterDeps {
	documents: Documents;
	bundleExportService: BundleExportService;
	bundleImportService: BundleImportService;
	documentRenderer?: Pick<DocumentRenderer, "render">;
	collectionCursors?: Pick<CollectionCursors, "resolve">;
	pdfService: PdfService;
}

function safeName(raw: string): string {
	return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "export";
}

export function createExportRouter(deps: ExportRouterDeps): Router {
	const { documents, bundleExportService, bundleImportService, pdfService } =
		deps;
	const documentRenderer = deps.documentRenderer ?? {
		render: (doc: Document) => doc,
	};
	const collectionCursors = deps.collectionCursors ?? { resolve: () => null };
	const router = createRouter();

	router.use(requireBrowserContextLoopback);

	router.get("/print-autostart.js", (_req, res) => {
		res.type("application/javascript").send(PRINT_AUTOSTART_SCRIPT);
	});
	router.get("/print", (req, res) =>
		handlePrint(req, res, documents, documentRenderer, collectionCursors),
	);
	router.get("/api/export-pdf", (req, res) =>
		handlePdfExport(req, res, documents, pdfService),
	);
	router.get("/api/export-maket", (req, res) =>
		handleMaketExport(req, res, bundleExportService),
	);
	router.post("/api/import-maket", (req, res) =>
		handleMaketImport(req, res, bundleImportService),
	);

	return router;
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// HTTP handler `handlePrint`: request/response adapter over services, not envied domain logic.
function handlePrint(
	req: Request,
	res: Response,
	documents: Documents,
	documentRenderer: Pick<DocumentRenderer, "render">,
	collectionCursors: Pick<CollectionCursors, "resolve">,
): void {
	const name = req.query.name as string | undefined;
	if (!name) {
		res.status(400).send("Missing ?name= parameter");
		return;
	}
	const d = documents.resolveOrLoad(name);
	if (!d) {
		res.status(400).send(`Document "${name}" not found`);
		return;
	}
	try {
		const rendered = documentRenderer.render(d, {
			collection:
				printOptions(req) ??
				cursorRenderOptions(d, (docName, pageIndex) =>
					collectionCursors.resolve(docName, pageIndex),
				),
		});
		const rawHtmls = rendered.pages
			.map((p) => p.html)
			.filter(Boolean) as string[];
		if (!rawHtmls.length) {
			res.status(400).send("No pages with HTML content");
			return;
		}
		const charteCssStr = documents.charteCss(rendered);
		const shadowVars = buildShadowVarMap(charteCssStr);
		const pageHtmls = rawHtmls.map((html) =>
			boxShadowToDropShadow(html, shadowVars),
		);
		const printHtml = buildPrintHtml(rendered, pageHtmls, charteCssStr);
		const html =
			req.query.auto_print === "false"
				? printHtml
				: printHtml.replace(
						"</body>",
						'<script src="/print-autostart.js"></script></body>',
					);
		res.setHeader("Content-Type", "text/html");
		res.send(html);
	} catch (error) {
		res
			.status(400)
			.send(error instanceof Error ? error.message : String(error));
	}
}

function printOptions(req: Request): CollectionRenderOptions | undefined {
	const preview = singleQueryValue(req.query.collection_preview);
	if (!preview) return undefined;
	return { collections: collectionRenderSelections(preview) };
}

function collectionRenderSelections(
	raw: string,
): CollectionRenderOptions["collections"] {
	const decoded = JSON.parse(raw) as unknown;
	if (!isRecord(decoded)) return {};
	const entries = Object.entries(decoded).flatMap(([name, value]) => {
		if (!isRecord(value)) return [];
		const mode = renderMode(value.mode);
		if (!mode) return [];
		const memberId = typeof value.memberId === "string" ? value.memberId : null;
		return [[name, { mode, memberId }]] as const;
	});
	return Object.fromEntries(entries);
}

function renderMode(value: unknown): CollectionRenderMode | null {
	return value === "template" || value === "rendered" || value === "all"
		? value
		: null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function singleQueryValue(value: unknown): string | null {
	if (Array.isArray(value)) return singleQueryValue(value[0]);
	return typeof value === "string" && value.length > 0 ? value : null;
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// HTTP handler `handlePdfExport`: request/response adapter over services, not envied domain logic.
async function handlePdfExport(
	req: Request,
	res: Response,
	documents: Documents,
	pdfService: PdfService,
): Promise<void> {
	try {
		const pdfName = req.query.name as string | undefined;
		if (!pdfName) {
			res.status(400).json({ error: "Missing ?name= parameter" });
			return;
		}
		const d = documents.resolveOrLoad(pdfName);
		if (!d) {
			res.status(400).json({ error: `Document "${pdfName}" not found` });
			return;
		}
		const quality = (req.query.quality as string) || "print";
		const { buffer } = await pdfService.render(d, quality);
		res.setHeader("Content-Type", "application/pdf");
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="${safeName(d.name)}.pdf"`,
		);
		res.send(buffer);
	} catch (e: any) {
		res.status(500).json({ error: e.message });
	}
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// HTTP handler `handleMaketExport`: request/response adapter over services, not envied domain logic.
async function handleMaketExport(
	req: Request,
	res: Response,
	bundleExportService: BundleExportService,
): Promise<void> {
	try {
		const result = await bundleExportService.build({
			names: exportNamesFromQuery(req),
		});
		if (!result.ok) {
			res
				.status(result.code === "no-documents" ? 400 : 404)
				.json({ error: result.message });
			return;
		}
		res.setHeader("Content-Type", "application/zip");
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="${result.filename}"`,
		);
		res.send(result.buffer);
	} catch (e: any) {
		res.status(500).json({ error: e.message });
	}
}

function exportNamesFromQuery(req: Request): string[] | undefined {
	const single = req.query.name as string | undefined;
	const csv = req.query.names as string | undefined;
	if (csv)
		return csv
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	if (single) return [single];
	return undefined;
}

async function handleMaketImport(
	req: Request,
	res: Response,
	bundleImportService: BundleImportService,
): Promise<void> {
	try {
		const bundle = await readBundleUpload(req, res);
		if (!bundle) return;
		const imported = bundleImportService.restore(bundle);
		res.json({
			ok: true,
			version: imported.version,
			documents: imported.documents,
			renamed: imported.renamed,
			chartesAdded: imported.chartesAdded,
			chartesSkipped: imported.chartesSkipped,
			collectionsAdded: imported.collectionsAdded,
			collectionsSkipped: imported.collectionsSkipped,
			assetsWritten: imported.assetsWritten,
			assetsSkipped: imported.assetsSkipped,
			assetsRejected: imported.assetsRejected.length,
			statesImported: imported.statesImported,
			exportedAt: imported.exportedAt,
		});
	} catch (e: any) {
		res.status(500).json({ error: e.message });
	}
}

async function readBundleUpload(
	req: Request,
	res: Response,
): Promise<Awaited<ReturnType<typeof decodeBundle>> | null> {
	let body: Buffer;
	try {
		body = await readBoundedBody(req, MAX_BUNDLE_BYTES);
	} catch (e) {
		if (e instanceof BodyTooLargeError) {
			res.status(413).json({ error: e.message });
			return null;
		}
		throw e;
	}
	if (body.length === 0) {
		res.status(400).json({ error: "Empty upload" });
		return null;
	}
	try {
		return await decodeBundle(body);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		res.status(400).json({ error: msg });
		return null;
	}
}
