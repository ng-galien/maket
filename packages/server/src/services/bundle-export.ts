import type { BundleDocumentStateSnapshot, Collection } from "@maket/shared";
import {
	collectAssetFilenames,
	loadAssetsFromDir,
} from "../lib/asset-collector.js";
import {
	type BundleAsset,
	bundleFilename,
	encodeBundleV2,
} from "../lib/maket-format.js";
import type { Charte, Document } from "../types.js";
import type { Collections } from "./collections.js";
import type { Config } from "./config.js";
import type { Documents } from "./documents.js";
import type { Store } from "./store.js";

export interface BundleExportOptions {
	names?: readonly string[];
	includeAssets?: boolean;
}

export interface BundleExportFailure {
	ok: false;
	code: "no-documents" | "documents-not-found";
	message: string;
}

export interface BundleExportSuccess {
	ok: true;
	buffer: Buffer;
	filename: string;
	documents: Document[];
	chartes: Charte[];
	collections: Collection[];
	documentStates: BundleDocumentStateSnapshot[];
	assets: BundleAsset[];
	missingAssets: string[];
}

export type BundleExportResult = BundleExportFailure | BundleExportSuccess;

export interface BundleExportService {
	build(options?: BundleExportOptions): Promise<BundleExportResult>;
}

export interface BundleExportServiceDeps {
	documents: Documents;
	collections: Pick<Collections, "referencedBy">;
	store: Store;
	config: Config;
}

export function createBundleExportService(
	deps: BundleExportServiceDeps,
): BundleExportService {
	return {
		build: (options) => buildBundle(deps, options),
	};
}

// code-moniker: ignore[smell-feature-envy-local]
// Bundle construction intentionally coordinates every portable dependency behind one shared owner.
async function buildBundle(
	deps: BundleExportServiceDeps,
	options: BundleExportOptions = {},
): Promise<BundleExportResult> {
	const names = options.names ?? [...deps.documents.all().keys()];
	if (names.length === 0) {
		return {
			ok: false,
			code: "no-documents",
			message: "No documents to export",
		};
	}

	const documents: Document[] = [];
	const missing: string[] = [];
	for (const name of names) {
		const document = deps.documents.resolveOrLoad(name);
		if (document) documents.push(document);
		else missing.push(name);
	}
	if (missing.length > 0) {
		return {
			ok: false,
			code: "documents-not-found",
			message: `Documents not found: ${missing.join(", ")}`,
		};
	}

	const chartes = loadReferencedChartes(documents, deps.store);
	const collections = deps.collections.referencedBy(documents);
	const documentStates = currentDocumentStateSnapshots(documents, deps.store);
	const { assets, missing: missingAssets } =
		options.includeAssets === false
			? { assets: [], missing: [] }
			: loadAssetsFromDir(
					collectAssetFilenames(documents),
					deps.config.ASSETS_DIR,
				);
	const buffer = await encodeBundleV2(documents, chartes, collections, assets, {
		documentStates,
	});
	const baseName =
		documents.length === 1
			? documents[0]?.name || "maket-bundle"
			: "maket-bundle";

	return {
		ok: true,
		buffer,
		filename: bundleFilename(baseName),
		documents,
		chartes,
		collections,
		documentStates,
		assets,
		missingAssets,
	};
}

function loadReferencedChartes(docs: Document[], store: Store): Charte[] {
	const names = new Set<string>();
	for (const doc of docs) {
		if (doc.meta?.charte) names.add(doc.meta.charte);
	}
	const chartes: Charte[] = [];
	for (const name of names) {
		try {
			const charte = store.loadCharte(name);
			if (charte) chartes.push(charte);
		} catch {}
	}
	return chartes;
}

function currentDocumentStateSnapshots(
	docs: Document[],
	store: Store,
): BundleDocumentStateSnapshot[] {
	return docs.flatMap((doc) => {
		if (doc.dataModel !== "state") return [];
		const current = store.loadCurrentDocumentState(doc.id);
		if (!current) {
			throw new Error(`Document "${doc.name}" has no current state snapshot.`);
		}
		return [
			{
				documentId: doc.id,
				schema: current.schema,
				data: current.data,
			},
		];
	});
}
