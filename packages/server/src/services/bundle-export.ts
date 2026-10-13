import crypto from "node:crypto";
import {
	type BundleAnnotationSnapshot,
	type BundleDocumentStateSnapshot,
	type BundleStructuredWorkspaceItem,
	type BundleStructuredWorkspaceSnapshot,
	type Collection,
	type DocumentStateRevision,
	renderDocumentStatePage,
	type StructuredWorkspaceDefinition,
} from "@maket/shared";
import {
	collectAssetFilenames,
	loadAssetsFromDir,
} from "../lib/asset-collector.js";
import {
	type BundleAsset,
	bundleFilename,
	encodeBundleV2,
} from "../lib/maket-format.js";
import { stripDocumentNavigationHtml } from "../lib/strip-active-html.js";
import type { Charte, Document } from "../types.js";
import type { Collections } from "./collections.js";
import type { Config } from "./config.js";
import {
	renderDocumentSettled,
	type SettlingDocumentRenderer,
} from "./document-renderer.js";
import type { Documents } from "./documents.js";
import type { StateRenderSlots } from "./state-render-slots.js";
import type { Store } from "./store.js";
import type {
	ItemLeftOut,
	StructuredWorkspaces,
} from "./structured-workspaces.js";

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
	annotations: BundleAnnotationSnapshot[];
	structuredWorkspaces: BundleStructuredWorkspaceSnapshot[];
	/** Items whose document the bundle could not hold; their rows travel. */
	itemsLeftOut: ItemLeftOut[];
	assets: BundleAsset[];
	missingAssets: string[];
}

export type BundleExportResult = BundleExportFailure | BundleExportSuccess;

export interface BundleExportService {
	build(options?: BundleExportOptions): Promise<BundleExportResult>;
}

export interface BundleExportServiceDeps {
	documents: Documents;
	documentRenderer: SettlingDocumentRenderer;
	collections: Pick<Collections, "referencedBy">;
	store: Store;
	config: Config;
	structuredWorkspaces?: Pick<
		StructuredWorkspaces,
		| "list"
		| "materializeItemDocuments"
		| "releaseItemDocuments"
		| "portableItems"
	>;
	stateRenderSlots?: Pick<StateRenderSlots, "forDocument">;
}

export function createBundleExportService(
	deps: BundleExportServiceDeps,
): BundleExportService {
	return {
		build: (options) => buildWithItemDocuments(deps, options),
	};
}

/** A bundle built with the item documents it needs: the missing ones are
 * created for it and removed once it is written; the items whose document
 * it cannot hold are reported. */
async function buildWithItemDocuments(
	deps: BundleExportServiceDeps,
	options: BundleExportOptions = {},
): Promise<BundleExportResult> {
	const materialized = deps.structuredWorkspaces?.materializeItemDocuments(
		options.names,
	) ?? { held: [], leftOut: [] };
	try {
		const result = await buildBundle(deps, options);
		return result.ok
			? { ...result, itemsLeftOut: materialized.leftOut }
			: result;
	} finally {
		deps.structuredWorkspaces?.releaseItemDocuments(materialized.held);
	}
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Bundle construction intentionally coordinates every portable dependency behind one shared owner.
async function buildBundle(
	deps: BundleExportServiceDeps,
	options: BundleExportOptions = {},
): Promise<BundleExportFailure | Omit<BundleExportSuccess, "itemsLeftOut">> {
	const names = options.names ?? [...deps.documents.all().keys()];
	if (
		names.length === 0 &&
		portableStructuredWorkspaces([], deps.structuredWorkspaces).length === 0
	) {
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

	const structuredWorkspaces = portableStructuredWorkspaces(
		documents,
		deps.structuredWorkspaces,
	);
	const aggregateWorkspaceIds = new Set(
		structuredWorkspaces.map(({ workspace }) => workspace.id),
	);
	const portableDocuments = await Promise.all(
		documents.map((document) =>
			document.meta.structuredWorkspace?.role === "collection" &&
			aggregateWorkspaceIds.has(document.meta.structuredWorkspace.workspaceId)
				? document
				: portableDocument(deps.documentRenderer, document),
		),
	);
	const chartes = loadReferencedChartes(portableDocuments, deps.store);
	const collections = deps.collections.referencedBy(portableDocuments);
	const documentStates = currentDocumentStateSnapshots(
		portableDocuments,
		deps.store,
		deps.stateRenderSlots,
	);
	const annotations = portableAnnotations(documents, deps.store);
	const { assets, missing: missingAssets } =
		options.includeAssets === false
			? { assets: [], missing: [] }
			: loadAssetsFromDir(
					collectAssetFilenames(portableDocuments),
					deps.config.ASSETS_DIR,
				);
	const buffer = await encodeBundleV2(
		portableDocuments,
		chartes,
		collections,
		assets,
		{
			documentStates,
			annotations,
			structuredWorkspaces,
		},
	);
	const baseName =
		documents.length === 1
			? documents[0]?.name || "maket-bundle"
			: "maket-bundle";

	return {
		ok: true,
		buffer,
		filename: bundleFilename(baseName),
		documents: portableDocuments,
		chartes,
		collections,
		documentStates,
		annotations,
		structuredWorkspaces,
		assets,
		missingAssets,
	};
}

function portableStructuredWorkspaces(
	documents: Document[],
	service?: Pick<StructuredWorkspaces, "list" | "portableItems">,
): BundleStructuredWorkspaceSnapshot[] {
	if (!service) return [];
	const selectedIds = new Set(documents.map(({ id }) => id));
	return service.list().flatMap((workspace) =>
		portableWorkspaceSnapshot(workspace, documents, {
			selectedIds,
			items: () => service.portableItems(workspace.id),
		}),
	);
}

/** The snapshot of a workspace whose templates the export holds: its
 * definition, every item row (with the bundled document of the item when
 * the export holds it) and the page provenance of its documents. */
function portableWorkspaceSnapshot(
	workspace: StructuredWorkspaceDefinition,
	documents: Document[],
	selection: {
		selectedIds: ReadonlySet<string>;
		items: () => BundleStructuredWorkspaceItem[];
	},
): BundleStructuredWorkspaceSnapshot[] {
	const { selectedIds } = selection;
	const templateIds = new Set<string>();
	for (const collection of Object.values(
		workspace.representationSchema.collections,
	)) {
		templateIds.add(collection.collectionTemplateDocumentId);
		for (const binding of Object.values(collection.bindings)) {
			templateIds.add(binding.detailTemplateDocumentId);
			if (binding.compactTemplateDocumentId)
				templateIds.add(binding.compactTemplateDocumentId);
		}
	}
	if (![...templateIds].every((id) => selectedIds.has(id))) return [];
	const items: BundleStructuredWorkspaceItem[] = selection
		.items()
		.map(({ documentId, ...item }) =>
			documentId !== undefined && selectedIds.has(documentId)
				? { ...item, documentId }
				: item,
		);
	const collectionDocuments = collectionDocumentReferences(
		workspace.id,
		documents,
	);
	const requiredIdSet = new Set([
		...templateIds,
		...items.flatMap(({ documentId }) => (documentId ? [documentId] : [])),
		...collectionDocuments.map(({ documentId }) => documentId),
	]);
	const pageProvenance = documents
		.filter(({ id }) => requiredIdSet.has(id))
		.flatMap((document) =>
			document.pages.flatMap((page) =>
				page.provenance?.workspaceId === workspace.id
					? [
							{
								documentId: document.id,
								pageId: page.id,
								provenance: page.provenance,
							},
						]
					: [],
			),
		);
	return [
		{
			workspace: structuredClone(workspace),
			items,
			pageProvenance,
			collectionDocuments,
		},
	];
}

/** A Workspace collection or item document as a static copy of its
 * rendered pages, its data in the pages and not in a state; a generated
 * continuation page becomes an authored page with its own id. */
async function portableDocument(
	documentRenderer: SettlingDocumentRenderer,
	document: Document,
): Promise<Document> {
	const role = document.meta.structuredWorkspace?.role;
	if (role !== "collection" && role !== "item") return document;
	const rendered = await renderDocumentSettled(documentRenderer, document);
	const meta = { ...rendered.meta };
	delete meta.structuredWorkspace;
	return {
		...rendered,
		dataModel: "static",
		meta,
		pages: rendered.pages.map(({ flow, ...page }) => ({
			...page,
			id: flow && flow.index > 0 ? crypto.randomUUID() : page.id,
			provenance: undefined,
			jsonForms: undefined,
			html: page.html ? stripDocumentNavigationHtml(page.html) : page.html,
		})),
	};
}

function portableAnnotations(
	docs: Document[],
	store: Store,
): BundleAnnotationSnapshot[] {
	const documentIds = new Map(docs.map((doc) => [doc.name, doc.id]));
	return store.loadAnnotations().flatMap((annotation) => {
		const documentId = annotation.docName
			? documentIds.get(annotation.docName)
			: undefined;
		if (!documentId) return [];
		return [
			{
				documentId,
				...(annotation.pageIndex !== undefined
					? { pageIndex: annotation.pageIndex }
					: {}),
				...(annotation.elementId !== undefined
					? { elementId: annotation.elementId }
					: {}),
				type: annotation.type ?? "note",
				...(annotation.text !== undefined ? { text: annotation.text } : {}),
				...(annotation.file !== undefined ? { file: annotation.file } : {}),
				...(annotation.position !== undefined
					? { position: annotation.position }
					: {}),
				ts: annotation.ts ?? 0,
			},
		];
	});
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
	slots?: Pick<StateRenderSlots, "forDocument">,
): BundleDocumentStateSnapshot[] {
	return docs.flatMap((doc) => {
		if (doc.dataModel !== "state") return [];
		const current = store.loadCurrentDocumentState(doc.id);
		if (!current) {
			throw new Error(`Document "${doc.name}" has no current state snapshot.`);
		}
		const retention = store.loadDocumentState(doc.id)?.retention ?? null;
		const renderedSlots = slots ? frozenRenderSlots(doc, current, slots) : {};
		return [
			{
				documentId: doc.id,
				schema: current.schema,
				data: current.data,
				...(retention !== null ? { retention } : {}),
				...(Object.keys(renderedSlots).length > 0 ? { renderedSlots } : {}),
			},
		];
	});
}

/** The HTML every render slot of the document shows now, keyed by the
 * pointer of its source, so the static reader shows it without drawing. */
function frozenRenderSlots(
	doc: Document,
	current: DocumentStateRevision,
	slots: Pick<StateRenderSlots, "forDocument">,
): Record<string, string> {
	const draw = slots.forDocument(doc);
	const frozen: Record<string, string> = {};
	for (const page of doc.pages) {
		if (!page.html) continue;
		renderDocumentStatePage(page, current.data, {
			schema: current.schema,
			renderSlot: (slot) => {
				const html = draw(slot);
				frozen[slot.pointer] = html;
				return html;
			},
		});
	}
	return frozen;
}

function collectionDocumentReferences(
	workspaceId: string,
	documents: Document[],
): BundleStructuredWorkspaceSnapshot["collectionDocuments"] {
	return documents.flatMap((document) => {
		const owner = document.meta.structuredWorkspace;
		return owner?.role === "collection" && owner.workspaceId === workspaceId
			? [{ documentId: document.id, collectionId: owner.collectionId }]
			: [];
	});
}
