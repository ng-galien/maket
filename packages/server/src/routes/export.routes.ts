/**
 * export routes — /print (HTML with auto-print script) + /api/export-pdf (PDF
 * rendered by Puppeteer via PdfService) + /api/export-maket, /api/import-maket
 * (.maket bundle with documents + referenced chartes + asset binaries).
 */

import type { Request, Response } from "express";
import { Router as createRouter, type Router } from "express";
import {
	collectAssetFilenames,
	loadAssetsFromDir,
} from "../lib/asset-collector.js";
import { writeBundleAssets } from "../lib/asset-writer.js";
import { BodyTooLargeError, readBoundedBody } from "../lib/bounded-body.js";
import type {
	CollectionRenderMode,
	CollectionRenderOptions,
} from "../lib/collection-render.js";
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
import type { Collections } from "../services/collections.js";
import type { Config } from "../services/config.js";
import type { Documents } from "../services/documents.js";
import {
	boxShadowToDropShadow,
	buildPrintHtml,
	buildShadowVarMap,
	type PdfService,
} from "../services/pdf.js";
import type { Store } from "../services/store.js";
import { type Charte, createDocument, type Document } from "../types.js";

export interface ExportRouterDeps {
	documents: Documents;
	collections?: Pick<Collections, "renderDocument" | "referencedBy">;
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
	collections,
	pdfService,
	store,
	bus,
	config,
}: ExportRouterDeps): Router {
	const collectionService = collections ?? {
		renderDocument: (doc: Document) => doc,
		referencedBy: () => [],
	};
	const router = createRouter();

	router.use(requireBrowserContextLoopback);

	router.get("/print", (req, res) =>
		handlePrint(req, res, documents, collectionService),
	);
	router.get("/api/export-pdf", (req, res) =>
		handlePdfExport(req, res, documents, pdfService),
	);
	router.get("/api/export-maket", (req, res) =>
		handleMaketExport(req, res, documents, collectionService, store, config),
	);
	router.post("/api/import-maket", (req, res) =>
		handleMaketImport(req, res, documents, store, bus, config),
	);

	return router;
}

function handlePrint(
	req: Request,
	res: Response,
	documents: Documents,
	collections: Pick<Collections, "renderDocument">,
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
		const rendered = collections.renderDocument(d, printOptions(req));
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
		const html = printHtml.replace(
			"</body>",
			"<script>window.onafterprint=()=>window.close();window.onload=()=>setTimeout(()=>window.print(),400)</script></body>",
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

async function handleMaketExport(
	req: Request,
	res: Response,
	documents: Documents,
	collections: Pick<Collections, "referencedBy">,
	store: Store,
	config: Config,
): Promise<void> {
	try {
		const names = exportNamesFromQuery(req, documents);
		if (names.length === 0) {
			res.status(400).json({ error: "No documents to export" });
			return;
		}
		const docs = resolveExportDocs(names, documents, res);
		if (!docs) return;
		const chartes = loadReferencedChartes(docs, store);
		const collectionRefs = collections.referencedBy(docs);
		const refs = collectAssetFilenames(docs);
		const { assets } = loadAssetsFromDir(refs, config.ASSETS_DIR);
		const buf = await encodeBundleV2(docs, chartes, collectionRefs, assets);
		const baseName = docs.length === 1 ? docs[0]?.name : "maket-bundle";
		res.setHeader("Content-Type", "application/zip");
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="${bundleFilename(baseName)}"`,
		);
		res.send(buf);
	} catch (e: any) {
		res.status(500).json({ error: e.message });
	}
}

function exportNamesFromQuery(req: Request, documents: Documents): string[] {
	const single = req.query.name as string | undefined;
	const csv = req.query.names as string | undefined;
	if (csv)
		return csv
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	if (single) return [single];
	return [...documents.all().keys()];
}

function resolveExportDocs(
	names: string[],
	documents: Documents,
	res: Response,
): Document[] | null {
	const docs: Document[] = [];
	for (const n of names) {
		const d = documents.resolveOrLoad(n);
		if (!d) {
			res.status(404).json({ error: `Document "${n}" not found` });
			return null;
		}
		docs.push(d);
	}
	return docs;
}

function loadReferencedChartes(
	docs: NonNullable<ReturnType<Documents["resolveOrLoad"]>>[],
	store: Store,
): Charte[] {
	const charteNames = new Set<string>();
	for (const d of docs) if (d.meta?.charte) charteNames.add(d.meta.charte);
	const chartes: Charte[] = [];
	for (const name of charteNames) {
		try {
			const c = store.loadCharte(name);
			if (c) chartes.push(c);
		} catch {}
	}
	return chartes;
}

async function handleMaketImport(
	req: Request,
	res: Response,
	documents: Documents,
	store: Store,
	bus: Bus,
	config: Config,
): Promise<void> {
	try {
		const bundle = await readBundleUpload(req, res);
		if (!bundle) return;
		const imported = importBundleDocuments(bundle, documents, bus);
		const chartes = importBundleChartes(bundle.chartes, store, bus);
		const collectionReport = importBundleCollections(
			bundle.collections,
			store,
			bus,
		);
		const assetReport = writeBundleAssets(bundle.assets, config.ASSETS_DIR);
		if (assetReport.written > 0) bus.emit("assets:changed", {});
		bus.emit("toast", {
			text: `Imported ${imported.documents.length} document(s)${chartes.added.length ? ` + ${chartes.added.length} charte(s)` : ""}${collectionReport.added.length ? ` + ${collectionReport.added.length} collection(s)` : ""}${assetReport.written ? ` + ${assetReport.written} asset(s)` : ""}`,
			level: "success",
		});
		res.json({
			ok: true,
			version: bundle.version,
			documents: imported.documents,
			renamed: imported.renamed,
			chartesAdded: chartes.added,
			chartesSkipped: chartes.skipped,
			collectionsAdded: collectionReport.added,
			collectionsSkipped: collectionReport.skipped,
			assetsWritten: assetReport.written,
			assetsSkipped: assetReport.skipped,
			assetsRejected: assetReport.rejected.length,
			exportedAt: bundle.exportedAt,
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

function importBundleDocuments(
	bundle: Awaited<ReturnType<typeof decodeBundle>>,
	documents: Documents,
	bus: Bus,
): { documents: string[]; renamed: { from: string; to: string }[] } {
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
			pages: sanitiseBundlePages(snap.pages),
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
	return { documents: imported, renamed };
}

function sanitiseBundlePages(
	pages: Awaited<ReturnType<typeof decodeBundle>>["documents"][number]["pages"],
) {
	return pages?.length
		? pages.map((p) => ({
				...p,
				html: p.html ? stripActiveHtml(p.html) : p.html,
			}))
		: undefined;
}

function importBundleChartes(
	chartes: Awaited<ReturnType<typeof decodeBundle>>["chartes"],
	store: Store,
	bus: Bus,
): { added: string[]; skipped: string[] } {
	const added: string[] = [];
	const skipped: string[] = [];
	for (const c of chartes) {
		try {
			if (store.loadCharte(c.name)) {
				skipped.push(c.name);
				continue;
			}
			store.saveCharte(c);
			bus.emit("charte:updated", { name: c.name, css: c.css || "" });
			added.push(c.name);
		} catch {}
	}
	return { added, skipped };
}

function importBundleCollections(
	collections: Awaited<ReturnType<typeof decodeBundle>>["collections"],
	store: Store,
	bus: Bus,
): { added: string[]; skipped: string[] } {
	const added: string[] = [];
	const skipped: string[] = [];
	for (const collection of collections) {
		try {
			if (store.loadCollection(collection.name)) {
				skipped.push(collection.name);
				continue;
			}
			store.saveCollection(collection);
			bus.emit("collection:saved", { name: collection.name });
			added.push(collection.name);
		} catch {}
	}
	return { added, skipped };
}
