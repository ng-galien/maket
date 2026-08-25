import crypto from "node:crypto";
import type { BundleAnnotationSnapshot } from "@maket/shared";
import { writeBundleAssets } from "../lib/asset-writer.js";
import { type DecodedBundle, uniqueName } from "../lib/maket-format.js";
import { stripActiveHtml } from "../lib/strip-active-html.js";
import { createDocument } from "../types.js";
import type { Bus } from "./bus.js";
import type { Config } from "./config.js";
import type { DocumentStates } from "./document-states.js";
import type { Documents } from "./documents.js";
import type { Store } from "./store.js";

export interface BundleImportResult {
	version: number;
	exportedAt: string;
	documents: string[];
	renamed: { from: string; to: string }[];
	chartesAdded: string[];
	chartesSkipped: string[];
	collectionsAdded: string[];
	collectionsSkipped: string[];
	assetsWritten: number;
	assetsSkipped: number;
	assetsRejected: string[];
	statesImported: number;
	annotationsImported: number;
}

export interface BundleImportService {
	restore(bundle: DecodedBundle): BundleImportResult;
}

export interface BundleImportServiceDeps {
	documents: Documents;
	documentStates: Pick<DocumentStates, "initialize">;
	store: Store;
	bus: Bus;
	config: Config;
}

export function createBundleImportService(
	deps: BundleImportServiceDeps,
): BundleImportService {
	return {
		restore: (bundle) => restoreBundle(deps, bundle),
	};
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Bundle restoration intentionally coordinates each persisted portable dependency behind one shared owner.
function restoreBundle(
	deps: BundleImportServiceDeps,
	bundle: DecodedBundle,
): BundleImportResult {
	const imported = importDocuments(deps, bundle);
	const annotationsImported = importAnnotations(
		bundle.annotations,
		imported.documentNamesBySourceId,
		deps.store,
	);
	if (annotationsImported > 0) deps.bus.emit("annotations:changed", {});
	const chartes = importChartes(bundle.chartes, deps.store, deps.bus);
	const collections = importCollections(
		bundle.collections,
		deps.store,
		deps.bus,
	);
	const assets = writeBundleAssets(bundle.assets, deps.config.ASSETS_DIR);
	if (assets.written > 0) deps.bus.emit("assets:changed", {});
	deps.bus.emit("toast", {
		key: "toast_bundle_imported",
		params: {
			documents: String(imported.documents.length),
			chartes: String(chartes.added.length),
			collections: String(collections.added.length),
			assets: String(assets.written),
		},
		level: "success",
	});
	return {
		version: bundle.version,
		exportedAt: bundle.exportedAt,
		documents: imported.documents,
		renamed: imported.renamed,
		chartesAdded: chartes.added,
		chartesSkipped: chartes.skipped,
		collectionsAdded: collections.added,
		collectionsSkipped: collections.skipped,
		assetsWritten: assets.written,
		assetsSkipped: assets.skipped,
		assetsRejected: assets.rejected,
		statesImported: imported.statesImported,
		annotationsImported,
	};
}

function importDocuments(
	deps: Pick<BundleImportServiceDeps, "documents" | "documentStates" | "bus">,
	bundle: DecodedBundle,
): {
	documents: string[];
	renamed: { from: string; to: string }[];
	statesImported: number;
	documentNamesBySourceId: Map<string, string>;
} {
	const imported: string[] = [];
	const renamed: { from: string; to: string }[] = [];
	let statesImported = 0;
	const documentNamesBySourceId = new Map<string, string>();
	const all = deps.documents.all();
	const stateByDocumentId = new Map(
		bundle.documentStates.map((state) => [state.documentId, state]),
	);
	for (const snapshot of bundle.documents) {
		const bundledState = snapshot.id
			? stateByDocumentId.get(snapshot.id)
			: undefined;
		const finalName = uniqueName(snapshot.name, (name) => all.has(name));
		const document = createDocument({
			name: finalName,
			category: snapshot.category || "general",
			dataModel: bundledState ? "static" : snapshot.dataModel,
			canvas: snapshot.canvas,
			meta: snapshot.meta || {},
			pages: sanitiseBundlePages(snapshot.pages),
			activePage: snapshot.activePage ?? 0,
			nextId: snapshot.nextId ?? 1,
		});
		all.set(finalName, document);
		deps.documents.persist(finalName);
		if (bundledState) {
			deps.documentStates.initialize(
				finalName,
				bundledState.schema,
				bundledState.data,
			);
			deps.documents.persist(finalName);
			statesImported++;
		}
		deps.bus.emit("document:created", { docName: finalName });
		if (snapshot.id) documentNamesBySourceId.set(snapshot.id, finalName);
		imported.push(finalName);
		if (finalName !== snapshot.name) {
			renamed.push({ from: snapshot.name, to: finalName });
		}
	}
	return {
		documents: imported,
		renamed,
		statesImported,
		documentNamesBySourceId,
	};
}

function importAnnotations(
	annotations: BundleAnnotationSnapshot[],
	documentNamesBySourceId: Map<string, string>,
	store: Store,
): number {
	let imported = 0;
	for (const annotation of annotations) {
		const docName = documentNamesBySourceId.get(annotation.documentId);
		if (!docName) continue;
		store.saveAnnotation({
			id: crypto.randomUUID(),
			docName,
			...(annotation.pageIndex !== undefined
				? { pageIndex: annotation.pageIndex }
				: {}),
			...(annotation.elementId !== undefined
				? { elementId: annotation.elementId }
				: {}),
			type: annotation.type,
			...(annotation.text !== undefined ? { text: annotation.text } : {}),
			...(annotation.file !== undefined ? { file: annotation.file } : {}),
			...(annotation.position !== undefined
				? { position: annotation.position }
				: {}),
			ts: annotation.ts,
		});
		imported++;
	}
	return imported;
}

function sanitiseBundlePages(
	pages: DecodedBundle["documents"][number]["pages"],
) {
	return pages?.length
		? pages.map((page) => ({
				...page,
				html: page.html ? stripActiveHtml(page.html) : page.html,
			}))
		: undefined;
}

function importChartes(
	chartes: DecodedBundle["chartes"],
	store: Store,
	bus: Bus,
): { added: string[]; skipped: string[] } {
	const added: string[] = [];
	const skipped: string[] = [];
	for (const charte of chartes) {
		try {
			if (store.loadCharte(charte.name)) {
				skipped.push(charte.name);
				continue;
			}
			store.saveCharte(charte);
			bus.emit("charte:updated", {
				name: charte.name,
				css: charte.css || "",
			});
			added.push(charte.name);
		} catch (error) {
			throw new Error(
				`Could not import charte "${charte.name}": ${errorMessage(error)}`,
				{ cause: error },
			);
		}
	}
	return { added, skipped };
}

function importCollections(
	collections: DecodedBundle["collections"],
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
		} catch (error) {
			throw new Error(
				`Could not import collection "${collection.name}": ${errorMessage(error)}`,
				{ cause: error },
			);
		}
	}
	return { added, skipped };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
