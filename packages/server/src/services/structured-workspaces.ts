import crypto from "node:crypto";
import type {
	BundleStructuredWorkspaceItem,
	BundleStructuredWorkspaceSnapshot,
	JsonFormsTemplate,
	StructuredWorkspaceCheck,
	StructuredWorkspaceCollectionDocumentView,
	StructuredWorkspaceCollectionRepresentation,
	StructuredWorkspaceDataSchema,
	StructuredWorkspaceDefinition,
	StructuredWorkspaceFinding,
	StructuredWorkspaceItemReference,
	StructuredWorkspaceItemView,
	StructuredWorkspaceRepresentationSchema,
	StructuredWorkspaceTemplateDocumentView,
	StructuredWorkspaceView,
} from "@maket/shared";
import {
	declareMissingIdentities,
	diagnoseStructuredWorkspaceDefinition,
	documentStateTemplateReferenceIssues,
	generatedStructuredWorkspaceIndex,
	generateStructuredWorkspaceTemplates,
	hasJsonFormSlot,
	renderDocumentStatePage,
	renderJsonFormsTemplate,
	structuredWorkspaceBindingSchema,
	structuredWorkspaceDefaultIdentity,
	structuredWorkspaceDefaultPageSize,
	structuredWorkspaceGeneratedIndexHtml,
	structuredWorkspaceHiddenProperties,
	structuredWorkspaceIdentityValue,
	structuredWorkspaceIndexCanvas,
	structuredWorkspaceItemDataIssues,
	structuredWorkspaceMaxBatch,
	structuredWorkspaceSchemaDeclaresPath,
	structuredWorkspaceTemplateFields,
	validateDocumentStatePageTemplate,
	validateDocumentStateTemplateBindings,
	validateStructuredWorkspaceDefinition,
} from "@maket/shared";
import { parseHTML } from "linkedom";
import { MessageError } from "../lib/message-error.js";
import { scopeCssToElement } from "../lib/scoped-css.js";
import { assertStateMermaidSources } from "../lib/state-mermaid.js";
import { createDocument, type Document, type Page } from "../types.js";
import type { Bus } from "./bus.js";
import type { DocumentStates } from "./document-states.js";
import type { Documents } from "./documents.js";
import {
	itemGroupKey,
	itemGroupLabel,
	itemValue,
} from "./item-sources/item-order.js";
import type {
	ItemRecord,
	ItemSource,
	ItemSummary,
} from "./item-sources/item-source.js";
import {
	isItemSourceError,
	itemSourceError,
} from "./item-sources/item-source-error.js";
import type { ItemSources } from "./item-sources/item-sources.js";
import type { ItemWindows } from "./item-windows.js";
import {
	type FlowRanges,
	flowedPageIdentity,
	markFlowedPage,
	type PageFlow,
	remapPageLinkNumbers,
} from "./page-flow.js";
import type { StoredItemQueryRow } from "./sqlite-store/structured-workspace-item-query.js";
import type { StructuredWorkspaceRepository } from "./sqlite-store/structured-workspace-repository.js";

/** One binding as an agent writes it: template documents by name or id, or
 * the templates themselves inline; Maket creates the documents it lacks. */
export interface StructuredWorkspaceBindingInput {
	/** JSON Pointer into the data schema; "" (default) is the whole schema. */
	schemaPath?: string;
	detailTemplateDocumentId?: string;
	compactTemplateDocumentId?: string;
	detailTemplateHtml?: string;
	compactTemplateHtml?: string;
	/** JSON Forms definition embedded in the detail page. */
	detailForm?: JsonFormsTemplate;
}

/** One collection as an agent writes it. The inline template fields of the
 * collection apply to every binding that gives none of its own; without
 * bindings, one binding `item` covers the whole data schema. */
export interface StructuredWorkspaceCollectionInput
	extends Omit<
		StructuredWorkspaceCollectionRepresentation,
		"name" | "collectionTemplateDocumentId" | "bindings"
	> {
	name?: string;
	collectionTemplateDocumentId?: string;
	indexTemplateHtml?: string;
	detailTemplateHtml?: string;
	compactTemplateHtml?: string;
	detailForm?: JsonFormsTemplate;
	bindings?: Record<string, StructuredWorkspaceBindingInput>;
}

/** The representation schema as an agent writes it; omitted, Maket declares
 * one collection `items` with generated templates. */
export interface StructuredWorkspaceRepresentationInput {
	version?: number;
	collections?: Record<string, StructuredWorkspaceCollectionInput>;
}

export interface CreateStructuredWorkspaceInput {
	name: string;
	description?: string;
	dataSchema: StructuredWorkspaceDataSchema;
	representationSchema?: StructuredWorkspaceRepresentationInput;
	/** Persist a definition with errors instead of refusing it. */
	allowIncomplete?: boolean;
}

export interface AddStructuredWorkspaceItemInput {
	workspace: string;
	/** When given, must equal the identity value the data holds. */
	itemId?: string;
	collectionId: string;
	bindingId: string;
	documentName: string;
	data: Record<string, unknown>;
}

export interface UpdateStructuredWorkspaceInput {
	workspace: string;
	expectedRevision: number;
	dataSchema?: StructuredWorkspaceDataSchema;
	representationSchema?: StructuredWorkspaceRepresentationInput;
	/** Replace the definition even when it has errors instead of keeping the
	 * previous one. */
	allowIncomplete?: boolean;
}

/** A definition refused for its errors; `findings` lists each of them. */
export interface StructuredWorkspaceRefusal extends Error {
	findings: StructuredWorkspaceFinding[];
}

export function isStructuredWorkspaceRefusal(
	error: unknown,
): error is StructuredWorkspaceRefusal {
	return (
		error instanceof Error &&
		Array.isArray((error as Partial<StructuredWorkspaceRefusal>).findings)
	);
}

function refusal(
	message: string,
	findings: StructuredWorkspaceFinding[],
): StructuredWorkspaceRefusal {
	return Object.assign(new Error(message), { findings });
}

export interface StructuredWorkspaces {
	list(): StructuredWorkspaceDefinition[];
	listViews(): StructuredWorkspaceView[];
	get(name: string): StructuredWorkspaceView | null;
	/** Every finding about the Workspace and its documents; never writes. */
	check(name: string): StructuredWorkspaceCheck;
	create(input: CreateStructuredWorkspaceInput): StructuredWorkspaceDefinition;
	updateDefinition(
		input: UpdateStructuredWorkspaceInput,
	): StructuredWorkspaceView;
	rename(
		workspace: string,
		newName: string,
		expectedRevision: number,
	): StructuredWorkspaceView;
	delete(workspace: string): string[];
	/** Add an item through the workspace's source; its document is created
	 * only when the item is opened or exported. */
	addItem(
		input: AddStructuredWorkspaceItemInput,
	): Promise<StructuredWorkspaceItemView>;
	/** Write an item's data through its source at `expectedRevision`; the
	 * MCP tool and the detail form share this write. */
	updateItem(
		workspaceName: string,
		itemId: string,
		expectedRevision: number,
		data: Record<string, unknown>,
	): Promise<StructuredWorkspaceItemView>;
	deleteItem(workspaceName: string, itemId: string): Promise<boolean>;
	/** The item a document renders, or null when it renders none. */
	itemOfDocument(
		documentName: string,
	): { workspaceId: string; itemId: string } | null;
	/**
	 * The document of the item bearing `documentName` in a workspace, created
	 * on first open with its deterministic id, its state mirror refreshed from
	 * the source. Null when no item of a ready workspace bears that name.
	 */
	openItem(workspaceId: string, documentName: string): Document | null;
	/** Create, without announcing them, the missing documents of the named
	 * items, or of every item of the ready workspaces, and refresh their
	 * mirrors. Answers the names of the documents this export holds, and the
	 * items whose document it cannot create: their name is held by another
	 * document, or their Workspace is incomplete. */
	materializeItemDocuments(
		documentNames?: readonly string[],
	): MaterializedItemDocuments;
	/** Remove, without announcing it, item documents created by
	 * materializeItemDocuments once their export is written, unless the user
	 * opened, pinned, locked, annotated or changed them meanwhile. */
	releaseItemDocuments(documentNames: readonly string[]): void;
	/** Every item row of a workspace in insertion order, for a bundle. */
	portableItems(workspaceId: string): BundleStructuredWorkspaceItem[];
	syncTemplates(
		workspaceName: string,
		collectionId?: string,
		bindingId?: string,
	): number;
	renderCollection(workspaceId: string, collectionId: string): Document;
	/** Current view of one item, or null when the workspace or item is gone. */
	getItem(
		workspaceId: string,
		itemId: string,
	): StructuredWorkspaceItemView | null;
	restorePortable(
		snapshot: BundleStructuredWorkspaceSnapshot,
		documentsBySourceId: ReadonlyMap<string, Document>,
	): StructuredWorkspaceView;
}

/** An item an export leaves without its document, and why. */
export interface ItemLeftOut {
	workspace: string;
	item: string;
	documentName: string;
	reason: string;
}

export interface MaterializedItemDocuments {
	/** Names of the item documents the export holds until released. */
	held: string[];
	leftOut: ItemLeftOut[];
}

export interface StructuredWorkspacesDeps {
	bus: Bus;
	documents: Documents;
	documentStates: DocumentStates;
	store: StructuredWorkspaceRepository;
	itemSources: ItemSources;
	itemWindows: Pick<ItemWindows, "current">;
	pageFlow?: Pick<PageFlow, "pages">;
}

/** The engine's dependencies and the definition issues it has already
 * computed, by definition content, so an unchanged definition is validated
 * once rather than on every read. */
interface EngineDeps extends StructuredWorkspacesDeps {
	definitionIssues(workspace: StructuredWorkspaceDefinition): string[];
}

const MAX_CACHED_DEFINITIONS = 100;

/** Item documents created for exports in flight, by document id, with the
 * number of exports holding each. A user open (StructuredWorkspaces.openItem),
 * an annotation placed on the document or any change to it removes its
 * entry, so the export keeps it. */
function exportHeldDocuments(
	injected: Pick<StructuredWorkspacesDeps, "bus" | "documents">,
): Map<string, number> {
	const held = new Map<string, number>();
	const touched = ({ docName }: { docName: string }) => {
		const id = injected.documents.resolve(docName)?.id;
		if (id) held.delete(id);
	};
	for (const event of [
		"document:saved",
		"document:focused",
		"document:pinned",
		"document:renamed",
		"document-state:changed",
		"meta:updated",
		"canvas:changed",
		"element:updated",
	] as const)
		injected.bus.on(event, touched);
	injected.bus.on("annotations:changed", ({ documentId }) => {
		if (documentId) held.delete(documentId);
	});
	return held;
}

export function createStructuredWorkspaces(
	injected: StructuredWorkspacesDeps,
): StructuredWorkspaces {
	const compactCards: CompactCardCache = new Map();
	const definitions = new Map<string, string[]>();
	const exportOnly = exportHeldDocuments(injected);
	const deps: EngineDeps = {
		get bus() {
			return injected.bus;
		},
		get documents() {
			return injected.documents;
		},
		get documentStates() {
			return injected.documentStates;
		},
		get store() {
			return injected.store;
		},
		get itemSources() {
			return injected.itemSources;
		},
		get itemWindows() {
			return injected.itemWindows;
		},
		get pageFlow() {
			return injected.pageFlow;
		},
		definitionIssues(workspace) {
			const key = JSON.stringify([
				workspace.dataSchema,
				workspace.representationSchema,
			]);
			let issues = definitions.get(key);
			if (!issues) {
				issues = validateStructuredWorkspaceDefinition(
					workspace.dataSchema,
					workspace.representationSchema,
				);
				definitions.set(key, issues);
				if (definitions.size > MAX_CACHED_DEFINITIONS)
					definitions.delete(definitions.keys().next().value ?? "");
			}
			return [...issues];
		},
	};
	return {
		list() {
			return deps.store.loadAllStructuredWorkspaces();
		},
		listViews() {
			return deps.store
				.loadAllStructuredWorkspaces()
				.map((workspace) => workspaceView(deps, workspace));
		},
		get(name) {
			const workspace = deps.store.loadStructuredWorkspace(name);
			return workspace ? workspaceView(deps, workspace) : null;
		},
		check(name) {
			return checkWorkspace(deps, requiredWorkspace(deps.store, name));
		},
		create(input) {
			const workspace = createWorkspace(deps, input);
			deps.bus.emit("structured-workspace:changed", {
				workspaceId: workspace.id,
			});
			return workspace;
		},
		updateDefinition(input) {
			const workspace = updateDefinition(deps, input);
			deps.bus.emit("structured-workspace:changed", {
				workspaceId: workspace.id,
			});
			return workspace;
		},
		rename(workspaceReference, newName, expectedRevision) {
			return renameWorkspace(
				deps,
				workspaceReference,
				newName,
				expectedRevision,
			);
		},
		delete(workspaceReference) {
			const workspace = requiredWorkspace(deps.store, workspaceReference);
			assertWorkspaceUnlocked(deps, workspace);
			const deleted = deps.store.deleteStructuredWorkspaceCascade(workspace.id);
			publishWorkspaceDeletion(deps, workspace.id, deleted);
			return deleted.map((document) => document.name);
		},
		async addItem(input) {
			const item = await addItem(deps, input);
			const workspace = requiredWorkspace(deps.store, input.workspace);
			deps.bus.emit("structured-workspace:changed", {
				workspaceId: workspace.id,
			});
			return item;
		},
		updateItem(workspaceName, itemId, expectedRevision, data) {
			return updateItem(deps, workspaceName, itemId, expectedRevision, data);
		},
		async deleteItem(workspaceName, itemId) {
			const workspace = requiredWorkspace(deps.store, workspaceName);
			const deleted = await deleteItem(deps, workspaceName, itemId);
			deps.bus.emit("structured-workspace:changed", {
				workspaceId: workspace.id,
			});
			return deleted;
		},
		itemOfDocument(documentName) {
			return itemOfDocument(deps, documentName);
		},
		openItem(workspaceId, documentName) {
			const document = openItem(deps, workspaceId, documentName);
			if (document) exportOnly.delete(document.id);
			return document;
		},
		materializeItemDocuments(documentNames) {
			return materializeItemDocuments(deps, documentNames, exportOnly);
		},
		releaseItemDocuments(documentNames) {
			releaseItemDocuments(deps, documentNames, exportOnly);
		},
		portableItems(workspaceId) {
			const workspace = loadedWorkspace(deps.store, workspaceId);
			const items: BundleStructuredWorkspaceItem[] = [];
			if (!workspace) return items;
			forEachItemRow(deps.store, workspace, (row) => {
				if (row.data === null) return;
				items.push({
					id: row.id,
					collectionId: row.collectionId,
					bindingId: row.bindingId,
					documentName: row.documentName,
					data: row.data,
					revision: row.revision,
					documentId: row.documentId,
				});
			});
			return items;
		},
		syncTemplates(workspaceName, collectionId, bindingId) {
			const workspace = requiredWorkspace(deps.store, workspaceName);
			const count = syncTemplates(deps, workspaceName, collectionId, bindingId);
			deps.bus.emit("structured-workspace:changed", {
				workspaceId: workspace.id,
			});
			return count;
		},
		renderCollection(workspaceId, collectionId) {
			return renderCollection(deps, compactCards, {
				workspaceId,
				collectionId,
			});
		},
		getItem(workspaceId, itemId) {
			const row = loadedWorkspace(deps.store, workspaceId)
				? deps.store.loadStructuredWorkspaceItem(workspaceId, itemId)
				: null;
			if (!row) return null;
			const item = itemReference(row);
			try {
				return presentItem(deps, deps.itemSources.sourceFor(workspaceId), item);
			} catch {
				return null;
			}
		},
		restorePortable(snapshot, documentsBySourceId) {
			return restorePortableWorkspace(deps, snapshot, documentsBySourceId);
		},
	};
}

function restorePortableWorkspace(
	deps: EngineDeps,
	snapshot: BundleStructuredWorkspaceSnapshot,
	documentsBySourceId: ReadonlyMap<string, Document>,
): StructuredWorkspaceView {
	const source = snapshot.workspace;
	let name = source.name;
	for (let suffix = 2; deps.store.loadStructuredWorkspace(name); suffix++) {
		name = `${source.name} (imported${suffix === 2 ? "" : ` ${suffix}`})`;
	}
	const resolveId = (sourceId: string): string => {
		const document = documentsBySourceId.get(sourceId);
		if (!document)
			throw new Error(
				`Portable workspace document "${sourceId}" was not imported.`,
			);
		return document.id;
	};
	const representationSchema = structuredClone(source.representationSchema);
	for (const collection of Object.values(representationSchema.collections)) {
		collection.collectionTemplateDocumentId = resolveId(
			collection.collectionTemplateDocumentId,
		);
		for (const binding of Object.values(collection.bindings)) {
			binding.detailTemplateDocumentId = resolveId(
				binding.detailTemplateDocumentId,
			);
			if (binding.compactTemplateDocumentId)
				binding.compactTemplateDocumentId = resolveId(
					binding.compactTemplateDocumentId,
				);
		}
	}
	const identities = declareMissingIdentities(
		source.dataSchema,
		representationSchema,
		(collectionId) =>
			snapshot.items.filter((item) => item.collectionId === collectionId),
	);
	const copiedIdentity = new Map(
		identities.declared.flatMap((identity) =>
			identity.kept ? [] : [[identity.collectionId, identity.property]],
		),
	);
	const workspace = deps.store.createStructuredWorkspace({
		id: crypto.randomUUID(),
		name,
		description: source.description,
		dataSchema: identities.dataSchema,
		representationSchema: identities.representationSchema,
	});
	reconcileTemplateOwnership(deps, workspace);
	const provenanceByPage = new Map(
		snapshot.pageProvenance.map((entry) => [
			`${entry.documentId}:${entry.pageId}`,
			entry.provenance,
		]),
	);
	for (const item of snapshot.items) {
		const document =
			item.documentId === undefined
				? undefined
				: documentsBySourceId.get(item.documentId);
		const reference = deps.store.addStructuredWorkspaceItem(workspace.id, {
			id: item.id,
			collectionId: item.collectionId,
			bindingId: item.bindingId,
			documentId: document?.id ?? itemDocumentId(workspace.id, item.id),
			documentName:
				document?.name ??
				allocatedDocumentName(deps.documents, item.documentName),
			data: identifiedData(item, copiedIdentity.get(item.collectionId)),
			revision: item.revision,
		});
		if (document)
			reconnectItemDocument(deps, workspace, {
				document,
				item: itemReference(reference),
				restore: (target) =>
					restorePageProvenance(
						target,
						item.documentId ?? "",
						workspace.id,
						provenanceByPage,
						resolveId,
					),
			});
	}
	for (const entry of snapshot.collectionDocuments) {
		const document = documentsBySourceId.get(entry.documentId);
		if (!document)
			throw new Error(
				`Portable collection document "${entry.documentId}" is missing.`,
			);
		const collection =
			workspace.representationSchema.collections[entry.collectionId];
		if (!collection)
			throw new Error(
				`Portable collection "${entry.collectionId}" is missing.`,
			);
		const preferredName = `${name} — ${collection.name}`;
		if (document.name !== preferredName)
			deps.documents.rename(
				document.name,
				allocatedDocumentName(deps.documents, preferredName),
			);
		document.category = `Structured Workspaces/${name}`;
		document.meta.structuredWorkspace = {
			role: "collection",
			workspaceId: workspace.id,
			collectionId: entry.collectionId,
		};
		restorePageProvenance(
			document,
			entry.documentId,
			workspace.id,
			provenanceByPage,
			resolveId,
		);
		deps.documents.persist(document.name);
	}
	const restored = requiredWorkspace(deps.store, workspace.id);
	if (workspaceIntegrity(deps, restored).status === "ready")
		ensureCollectionDocuments(deps, restored);
	deps.bus.emit("structured-workspace:changed", { workspaceId: workspace.id });
	return workspaceView(deps, restored);
}

/** The data of a bundled item, its id copied under the identity property
 * the import declared for its collection, if any. */
function identifiedData(
	item: BundleStructuredWorkspaceItem,
	property: string | undefined,
): Record<string, unknown> {
	const data = structuredClone(item.data);
	if (property !== undefined) data[property] = item.id;
	return data;
}

/** A bundled item document, imported as a static copy, made the item's
 * document again: its ownership, its page provenance, its template pages
 * from the detail template and its state mirrored from the item row. */
function reconnectItemDocument(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
	target: {
		document: Document;
		item: StructuredWorkspaceItemReference;
		restore: (document: Document) => void;
	},
): void {
	const { document, item } = target;
	document.category = `Structured Workspaces/${workspace.name}`;
	document.meta.structuredWorkspace = {
		role: "item",
		workspaceId: workspace.id,
		collectionId: item.collectionId,
		itemId: item.id,
		bindingId: item.bindingId,
	};
	target.restore(document);
	const binding =
		workspace.representationSchema.collections[item.collectionId]?.bindings[
			item.bindingId
		];
	const template = binding
		? deps.documents.resolveById(binding.detailTemplateDocumentId)
		: null;
	if (template)
		document.pages = synchronizedPages(workspace.id, template, document.pages);
	deps.documents.persist(document.name);
	refreshItemMirror(deps, workspace, item, false);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Aggregate rename owns the domain plan and cache/event reconciliation around
// the repository's single atomic persistence transaction.
function renameWorkspace(
	deps: EngineDeps,
	workspaceReference: string,
	newName: string,
	expectedRevision: number,
): StructuredWorkspaceView {
	const workspace = requiredWorkspace(deps.store, workspaceReference);
	assertWorkspaceUnlocked(deps, workspace);
	const trimmed = newName.trim();
	if (!trimmed) throw new Error("Workspace name must not be empty.");
	const collision = deps.store.loadStructuredWorkspace(trimmed);
	if (collision && collision.id !== workspace.id) {
		throw new Error(`Workspace "${trimmed}" already exists.`);
	}
	const collectionRenames = [...deps.documents.all().values()].flatMap(
		(document) => {
			const owner = document.meta.structuredWorkspace;
			if (owner?.role !== "collection" || owner.workspaceId !== workspace.id)
				return [];
			const collection =
				workspace.representationSchema.collections[owner.collectionId];
			return collection
				? [
						{
							id: document.id,
							newName: allocatedDocumentName(
								deps.documents,
								`${trimmed} — ${collection.name}`,
								document,
							),
						},
					]
				: [];
		},
	);
	const result = deps.store.renameStructuredWorkspace(
		workspace.id,
		trimmed,
		expectedRevision,
		collectionRenames,
	);
	for (const document of deps.documents.all().values()) {
		if (document.meta.structuredWorkspace?.workspaceId === workspace.id) {
			document.category = `Structured Workspaces/${trimmed}`;
		}
	}
	for (const renamed of result.renamedDocuments) {
		if (renamed.oldName === renamed.newName) continue;
		const document = deps.documents.all().get(renamed.oldName);
		if (!document) continue;
		deps.documents.all().delete(renamed.oldName);
		document.name = renamed.newName;
		deps.documents.all().set(renamed.newName, document);
	}
	for (const renamed of result.renamedDocuments) {
		if (renamed.oldName === renamed.newName) continue;
		deps.bus.emit("document:renamed", {
			oldName: renamed.oldName,
			docName: renamed.newName,
		});
	}
	deps.bus.emit("structured-workspace:changed", {
		workspaceId: workspace.id,
	});
	return workspaceView(deps, result.workspace);
}

function renderCollection(
	deps: EngineDeps,
	compactCards: CompactCardCache,
	target: { workspaceId: string; collectionId: string },
): Document {
	const { workspaceId, collectionId } = target;
	const workspace = loadedWorkspace(deps.store, workspaceId);
	if (!workspace) {
		throw new Error(`Structured Workspace "${workspaceId}" not found.`);
	}
	const integrity = workspaceIntegrity(deps, workspace);
	if (integrity.status === "incomplete") {
		throw new Error(
			`Workspace "${workspace.name}" is incomplete:\n${integrity.issues.join("\n")}`,
		);
	}
	const collection = requiredCollection(workspace, collectionId);
	const existing = findCollectionDocument(
		deps.documents,
		workspace.id,
		collectionId,
	);
	const collectionDocument =
		existing?.dataModel === "state"
			? existing
			: requiredCollectionDocument(deps, workspace, collectionId);
	const window = deps.itemWindows.current(workspace.id, collectionId);
	const items: CollectionItem[] = window.items.map((item) => ({
		id: item.id,
		bindingId: item.bindingId,
		documentName: item.documentName,
		revision: item.revision,
		data: item.fields,
	}));
	const groupCounts = new Map(
		(window.groups ?? []).map((group) => [
			itemGroupKey(group.value),
			group.count,
		]),
	);
	const collectionState = deps.documentStates.get(collectionDocument.name);
	if (!collectionState) {
		throw new Error(
			`Collection document "${collectionDocument.name}" has no live state.`,
		);
	}
	const pages: Page[] = [];
	const sourceStarts: number[] = [];
	for (const page of collectionDocument.pages) {
		sourceStarts.push(pages.length);
		if (!page.html && !page.jsonForms) {
			pages.push(structuredClone(page));
			continue;
		}
		const flowed = renderCollectionPage(
			deps,
			{ workspace, collection, items, groupCounts, compactCards },
			{ doc: collectionDocument, pageId: page.id },
			renderDocumentStatePage(page, collectionState.current.data, {
				schema: collectionState.current.schema,
			}).html,
		);
		for (const [index, html] of flowed.entries()) {
			pages.push({
				...structuredClone(page),
				...flowedPageIdentity(page, index, flowed.length),
				html,
			});
		}
	}
	return {
		...structuredClone(collectionDocument),
		pages:
			pages.length === collectionDocument.pages.length
				? pages
				: pages.map((page) =>
						page.html
							? { ...page, html: remapPageLinkNumbers(page.html, sourceStarts) }
							: page,
					),
	};
}

/** One item of the collection window as the index composes it: its summary
 * fields as data and the name of the document its card opens. */
interface CollectionItem {
	id: string;
	bindingId: string;
	documentName: string;
	revision: string;
	data: Record<string, unknown>;
}

interface CollectionCardEntry {
	item: CollectionItem;
	cards: Element[];
	/** Scoped style sheets of the compact templates, by template key. */
	styles: Map<string, string>;
}

interface CompactCard {
	element: Element;
	style: { key: string; css: string } | null;
}

interface CollectionCardGroup {
	key: string;
	label: string;
	entries: CollectionCardEntry[];
}

/** Cards of one group, or of the whole slot when `label` is null, on one
 * page of a slot. */
interface SlotSegment {
	label: string | null;
	groupIndex: number;
	count: number;
	continued: boolean;
	cards: Element[];
}

interface CollectionPageSource {
	workspace: StructuredWorkspaceDefinition;
	collection: StructuredWorkspaceCollectionRepresentation;
	/** The window items, in index order. */
	items: CollectionItem[];
	/** Items per group key over the whole query of the window. */
	groupCounts: ReadonlyMap<string, number>;
	compactCards: CompactCardCache;
}

/** Rendered compact cards by template content, item row revision and slot,
 * so a collection re-render after one item change renders one card. */
type CompactCardCache = Map<
	string,
	{ html: string; style: CompactCard["style"]; svg: boolean }
>;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const MAX_CACHED_COMPACT_CARDS = 5000;

function cachedCompactCard(
	source: CollectionPageSource,
	document: ReturnType<typeof parseHTML>["document"],
	key: string,
	render: () => CompactCard,
): CompactCard {
	const cached = source.compactCards.get(key);
	if (cached) {
		const holder = cached.svg
			? document.createElementNS(SVG_NAMESPACE, "svg")
			: document.createElement("div");
		holder.innerHTML = cached.html;
		const element = holder.firstElementChild;
		if (element) return { element, style: cached.style };
	}
	const card = render();
	source.compactCards.delete(key);
	source.compactCards.set(key, {
		html: card.element.outerHTML,
		style: card.style,
		svg: card.element.namespaceURI === SVG_NAMESPACE,
	});
	while (source.compactCards.size > MAX_CACHED_COMPACT_CARDS) {
		const oldest = source.compactCards.keys().next().value;
		if (oldest === undefined) break;
		source.compactCards.delete(oldest);
	}
	return card;
}

/**
 * Compose one collection template page. Each items slot is cut into pages of
 * at most `pageSize` cards when the collection is grouped; each such page then
 * flows onto as many continuation pages as its cards need once laid out.
 * AUTO pages instead grow with their content: retain groups, but never split
 * them by card count or physical page height.
 */
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Collection page composition: assembles DOM slots, card groups and the page flow planner, each owning its part.
function renderCollectionPage(
	deps: EngineDeps,
	source: CollectionPageSource,
	owner: { doc: Document; pageId: string },
	html: string,
): string[] {
	const { collection } = source;
	const { document } = parseHTML(`<html><body>${html}</body></html>`);
	const slots = [
		...document.body.querySelectorAll<HTMLElement>(
			"[data-maket-structured-items]",
		),
	];
	const compactStyles = new Map<string, string>();
	const slotPages = slots.map((slot, slotIndex) => {
		assertSlotGrouping(slot.namespaceURI === SVG_NAMESPACE, collection.groupBy);
		const entries = collectionCardEntries(
			deps,
			source,
			document,
			slot,
			slotIndex,
		);
		for (const entry of entries) {
			for (const [key, css] of entry.styles) compactStyles.set(key, css);
		}
		slot.replaceChildren();
		if (collection.groupBy === undefined) {
			return [
				[
					{
						label: null,
						groupIndex: 0,
						count: 0,
						continued: false,
						cards: entries.flatMap((entry) => entry.cards),
					},
				],
			];
		}
		return flowCollectionGroups(
			windowGroups(entries, collection.groupBy),
			source.groupCounts,
			owner.doc.canvas.format === "AUTO"
				? Number.POSITIVE_INFINITY
				: (collection.pageSize ?? structuredWorkspaceDefaultPageSize),
		);
	});
	prependCompactStyles(document, compactStyles);
	const lists = slots.map((_, slotIndex) => String(slotIndex));
	const baseCount = Math.max(1, ...slotPages.map((pages) => pages.length));
	const pages: string[] = [];
	for (let base = 0; base < baseCount; base += 1) {
		const segments = slots.map(
			(_, slotIndex) => slotPages[slotIndex]?.[base] ?? [],
		);
		const compose = (ranges?: FlowRanges, mark = false) => {
			for (const [slotIndex, slot] of slots.entries()) {
				slot.replaceChildren(
					...slotNodes(document, segments[slotIndex] ?? [], slotIndex, {
						range: ranges?.[String(slotIndex)],
						mark,
					}),
				);
			}
			return { html: document.body.innerHTML, lists };
		};
		const plan =
			owner.doc.canvas.format !== "AUTO" &&
			deps.pageFlow &&
			segments.some((slot) => slot.length > 0)
				? deps.pageFlow.pages({
						doc: owner.doc,
						pageKey: `${owner.pageId}#${base}`,
						full: compose(undefined, true),
						render: (ranges) => compose(ranges, true),
					})
				: null;
		if (!plan) {
			pages.push(compose().html);
			continue;
		}
		for (const ranges of plan) pages.push(compose(ranges).html);
	}
	return pages.map((page, index) => markFlowedPage(page, index, pages.length));
}

function slotNodes(
	document: ReturnType<typeof parseHTML>["document"],
	segments: SlotSegment[],
	slotIndex: number,
	options: { range?: [number, number | null]; mark: boolean },
): Node[] {
	const start = options.range?.[0] ?? 0;
	const end = options.range?.[1] ?? Number.POSITIVE_INFINITY;
	const nodes: Node[] = [];
	let offset = 0;
	for (const segment of segments) {
		const segmentStart = offset;
		offset += segment.cards.length;
		const from = Math.max(start, segmentStart);
		const to = Math.min(end, offset);
		if (from >= to) continue;
		if (segment.label !== null) {
			nodes.push(
				collectionGroupHeader(document, segment.label, {
					id: `structured-group-${slotIndex}-${segment.groupIndex}`,
					count: segment.count,
					continued: segment.continued || from > segmentStart,
				}),
			);
		}
		for (let index = from; index < to; index += 1) {
			const card = segment.cards[index - segmentStart];
			if (!card) continue;
			if (!options.mark) {
				nodes.push(card);
				continue;
			}
			nodes.push(
				document.createComment(`maket-flow:${slotIndex}:${index}`),
				card,
				document.createComment("/maket-flow"),
			);
		}
	}
	return nodes;
}

function collectionCardEntries(
	deps: EngineDeps,
	source: CollectionPageSource,
	document: ReturnType<typeof parseHTML>["document"],
	slot: HTMLElement,
	slotIndex: number,
): CollectionCardEntry[] {
	const { workspace, collection, items } = source;
	const bindingId = slot.getAttribute("data-maket-structured-items") ?? "";
	const filter = parseItemFilter(
		slot.getAttribute("data-maket-structured-filter"),
	);
	const entries: CollectionCardEntry[] = [];
	for (const item of items) {
		if (bindingId && item.bindingId !== bindingId) continue;
		if (filter && String(item.data[filter.field]) !== filter.value) continue;
		const binding = collection.bindings[item.bindingId];
		if (!binding?.compactTemplateDocumentId) continue;
		const compact = requiredDocument(
			deps.documents,
			binding.compactTemplateDocumentId,
			"compact template",
		);
		const schema = structuredWorkspaceBindingSchema(
			workspace.dataSchema,
			binding,
		);
		const cards = compact.pages.flatMap((page, pageIndex) => {
			if (!page.html && !page.jsonForms) return [];
			const options = {
				suffix: `${slotIndex}-${pageIndex}`,
				styleKey: `${safeToken(compact.id)}-${pageIndex}`,
				svgSlot: slot.namespaceURI === SVG_NAMESPACE,
			};
			const key = [
				compact.id,
				pageIndex,
				templateSignature(page),
				workspace.revision,
				slotIndex,
				item.id,
				item.documentName,
				item.revision,
				options.svgSlot,
			].join("\u0000");
			return [
				cachedCompactCard(source, document, key, () =>
					renderCompactCard(document, page, item, schema, options),
				),
			];
		});
		const styles = new Map<string, string>();
		for (const card of cards) {
			if (card.style) styles.set(card.style.key, card.style.css);
		}
		entries.push({
			item,
			cards: cards.map((card) => card.element),
			styles,
		});
	}
	return entries;
}

/** Consecutive entries of the same group value, in window order: the
 * source answers items group by group. */
function windowGroups(
	entries: CollectionCardEntry[],
	groupBy: string,
): CollectionCardGroup[] {
	const groups: CollectionCardGroup[] = [];
	for (const entry of entries) {
		const value = itemValue(entry.item.data, groupBy);
		const key = itemGroupKey(value);
		const last = groups.at(-1);
		if (last?.key === key) last.entries.push(entry);
		else groups.push({ key, label: itemGroupLabel(value), entries: [entry] });
	}
	return groups;
}

/** Pages of at most `pageSize` cards, laid out group by group; a header
 * counts the items of its group over the whole query when the window knows
 * it, else the cards of the group in the window. */
function flowCollectionGroups(
	groups: CollectionCardGroup[],
	groupCounts: ReadonlyMap<string, number>,
	pageSize: number,
): SlotSegment[][] {
	const pages: SlotSegment[][] = [];
	let current: SlotSegment[] = [];
	let used = 0;
	for (const [groupIndex, group] of groups.entries()) {
		const cards = group.entries.flatMap((entry) => entry.cards);
		let index = 0;
		while (index < cards.length) {
			if (used === pageSize) {
				pages.push(current);
				current = [];
				used = 0;
			}
			const taken = cards.slice(index, index + pageSize - used);
			current.push({
				label: group.label,
				groupIndex,
				count: groupCounts.get(group.key) ?? cards.length,
				continued: index > 0,
				cards: taken,
			});
			used += taken.length;
			index += taken.length;
		}
	}
	if (current.length > 0) pages.push(current);
	return pages;
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// DOM construction: builds one header element through the linkedom document API.
function collectionGroupHeader(
	document: ReturnType<typeof parseHTML>["document"],
	labelText: string,
	options: { id: string; count: number; continued: boolean },
): HTMLElement {
	const header = document.createElement("header");
	header.setAttribute("data-id", options.id);
	header.setAttribute("data-maket-structured-group", labelText);
	if (options.continued) {
		header.setAttribute("data-maket-structured-group-continued", "");
	}
	header.setAttribute("style", "grid-column:1 / -1;flex:0 0 100%");
	const label = document.createElement("span");
	label.setAttribute("data-maket-structured-group-label", "");
	label.textContent = labelText;
	const count = document.createElement("span");
	count.setAttribute("data-maket-structured-group-count", "");
	count.textContent = String(options.count);
	header.append(label, document.createTextNode(" "), count);
	return header;
}

function templateSignature(page: Pick<Page, "html" | "jsonForms">): string {
	return crypto
		.createHash("sha1")
		.update(page.html ?? "")
		.update("\u0000")
		.update(JSON.stringify(page.jsonForms ?? null))
		.digest("hex");
}

function renderCompactCard(
	document: ReturnType<typeof parseHTML>["document"],
	page: Pick<Page, "html" | "jsonForms">,
	item: CollectionItem,
	schema: StructuredWorkspaceDataSchema,
	options: { suffix: string; styleKey: string; svgSlot: boolean },
): CompactCard {
	const prefix = `structured-${safeToken(item.id)}-${options.suffix}`;
	const { root, css } = renderedCompactRoot(page, item, schema);
	prefixDataIds(root, prefix);
	stripCompactBindings(root);
	linkCompactActions(root, item.documentName);
	const element = compactCardWrapper(
		document,
		root,
		item.documentName,
		prefix,
		options.svgSlot,
	);
	if (!css) return { element, style: null };
	element.setAttribute(compactTemplateAttribute, options.styleKey);
	return {
		element,
		style: {
			key: options.styleKey,
			css: scopeCssToElement(
				css,
				`[${compactTemplateAttribute}="${options.styleKey}"]`,
			),
		},
	};
}

const compactTemplateAttribute = "data-maket-compact-template";

/** The compact root of a rendered compact template page and the text of
 * every style element of that page, which the root alone would lose. */
function renderedCompactRoot(
	page: Pick<Page, "html" | "jsonForms">,
	item: CollectionItem,
	schema: StructuredWorkspaceDataSchema,
): { root: Element; css: string } {
	const rendered = renderDocumentStatePage(page, item.data, { schema }).html;
	const compactDom = parseHTML(
		`<html><body>${rendered}</body></html>`,
	).document;
	const css = [...compactDom.querySelectorAll("style")]
		.map((style) => {
			const text = style.textContent ?? "";
			style.remove();
			return text;
		})
		.filter((text) => text.trim().length > 0)
		.join("\n");
	return {
		root:
			compactDom.body.querySelector<Element>("[data-maket-compact-root]") ??
			compactDom.body,
		css,
	};
}

/** One style element per compact template, ahead of the collection page. */
function prependCompactStyles(
	document: ReturnType<typeof parseHTML>["document"],
	styles: Map<string, string>,
): void {
	const elements = [...styles].map(([key, css]) => {
		const style = document.createElement("style");
		style.setAttribute("data-maket-compact-style", key);
		style.textContent = css;
		return style;
	});
	document.body.prepend(...elements);
}

function stripCompactBindings(compactRoot: Element): void {
	for (const binding of compactRoot.querySelectorAll<Element>(
		"[data-maket-bind], [data-maket-path], [data-maket-type]",
	)) {
		binding.removeAttribute("data-maket-bind");
		binding.removeAttribute("data-maket-path");
		binding.removeAttribute("data-maket-type");
	}
}

function linkCompactActions(compactRoot: Element, documentName: string): void {
	for (const action of compactRoot.querySelectorAll<Element>(
		'[data-maket-action="open-document"]',
	)) {
		action.setAttribute("data-maket-document", documentName);
	}
}

function compactCardWrapper(
	document: ReturnType<typeof parseHTML>["document"],
	compactRoot: Element,
	documentName: string,
	prefix: string,
	svgSlot: boolean,
): Element {
	assertCompactNamespace(compactRoot, svgSlot);
	const wrapper = svgSlot
		? document.createElementNS(SVG_NAMESPACE, "g")
		: document.createElement("article");
	const attributes = {
		"data-id": `${prefix}-card`,
		"data-maket-action": "open-document",
		"data-maket-document": documentName,
		role: "button",
		tabindex: "0",
		style: "cursor:pointer",
	};
	for (const [name, value] of Object.entries(attributes)) {
		wrapper.setAttribute(name, value);
	}
	wrapper.innerHTML = compactRoot.outerHTML;
	return wrapper;
}

function assertSlotGrouping(
	svgSlot: boolean,
	groupBy: string | undefined,
): void {
	if (svgSlot && groupBy !== undefined) {
		throw new Error(
			"SVG collection slots require explicit SVG groups instead of automatic groupBy.",
		);
	}
}

function assertCompactNamespace(compactRoot: Element, svgSlot: boolean): void {
	const svgRoot = compactRoot.namespaceURI === SVG_NAMESPACE;
	if (svgSlot && !svgRoot) {
		throw new Error("SVG collection slots require an SVG compact root.");
	}
	if (!svgSlot && svgRoot && compactRoot.tagName.toLowerCase() !== "svg") {
		throw new Error(
			"HTML collection slots require a complete svg compact root.",
		);
	}
}

/** Check the same namespace contract before a definition can be ready, even
 * when an empty collection has no compact card to render yet. */
function validateCollectionCardSlots(
	deps: EngineDeps,
	collection: StructuredWorkspaceCollectionRepresentation,
	html: string,
): void {
	const dom = parseHTML(`<html><body>${html}</body></html>`).document;
	for (const slot of dom.body.querySelectorAll(
		"[data-maket-structured-items]",
	)) {
		const svgSlot = slot.namespaceURI === SVG_NAMESPACE;
		assertSlotGrouping(svgSlot, collection.groupBy);
		const bindingId = slot.getAttribute("data-maket-structured-items");
		for (const [id, binding] of Object.entries(collection.bindings)) {
			if (bindingId && bindingId !== id) continue;
			if (!binding.compactTemplateDocumentId) continue;
			const compact = requiredDocument(
				deps.documents,
				binding.compactTemplateDocumentId,
				"compact template",
			);
			for (const page of compact.pages) {
				if (!page.html && !page.jsonForms) continue;
				const body = parseHTML(`<html><body>${page.html ?? ""}</body></html>`)
					.document.body;
				const root = body.querySelector("[data-maket-compact-root]") ?? body;
				assertCompactNamespace(root, svgSlot);
			}
		}
	}
}

function prefixDataIds(root: Element, prefix: string): void {
	const elements = [root, ...root.querySelectorAll<Element>("[data-id]")];
	for (const element of elements) {
		const id = element.getAttribute("data-id");
		if (id) element.setAttribute("data-id", `${prefix}-${safeToken(id)}`);
	}
}

function parseItemFilter(
	value: string | null,
): { field: string; value: string } | null {
	if (!value) return null;
	const separator = value.indexOf("=");
	if (separator <= 0) return null;
	return {
		field: value.slice(0, separator).trim(),
		value: value.slice(separator + 1).trim(),
	};
}

function safeToken(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function updateDefinition(
	deps: EngineDeps,
	input: UpdateStructuredWorkspaceInput,
): StructuredWorkspaceView {
	if (!input.dataSchema && !input.representationSchema) {
		throw new Error(
			"data_schema or representation_schema is required for update_definition.",
		);
	}
	const workspace = requiredWorkspace(deps.store, input.workspace);
	assertWorkspaceUnlocked(deps, workspace);
	const dataSchema = input.dataSchema ?? workspace.dataSchema;
	const materialized = input.representationSchema
		? materializeRepresentation(deps, {
				workspaceName: workspace.name,
				dataSchema,
				input: input.representationSchema,
				current: workspace.representationSchema,
			})
		: {
				representation: workspace.representationSchema,
				created: [],
				preferredNames: new Map<string, string>(),
			};
	try {
		replaceDefinition(deps, workspace, input, {
			dataSchema,
			representationSchema: normalizeTemplateDocumentReferences(
				deps.documents,
				materialized.representation,
			),
		});
		adoptPreferredNames(deps, materialized);
		announceCreatedTemplates(deps, materialized.created);
		const updated = requiredWorkspace(deps.store, workspace.id);
		reformatGeneratedIndexes(deps, updated);
		return workspaceView(deps, updated);
	} catch (error) {
		const persisted = deps.store.loadStructuredWorkspace(workspace.id);
		if (persisted?.revision === workspace.revision)
			discardDocuments(deps, materialized.created);
		throw error;
	}
}

function replaceDefinition(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
	input: UpdateStructuredWorkspaceInput,
	next: {
		dataSchema: StructuredWorkspaceDataSchema;
		representationSchema: StructuredWorkspaceRepresentationSchema;
	},
): StructuredWorkspaceView {
	const { dataSchema, representationSchema } = next;
	assertTemplatesUnlocked(deps.documents, representationSchema);
	const candidate = { ...workspace, dataSchema, representationSchema };
	const call = `maket_structured_workspace action=update_definition workspace=${workspace.id} expected_workspace_revision=${workspace.revision} representation_schema=<corrected>`;
	const repointed = identityChanges(workspace, representationSchema, call);
	if (repointed.length > 0)
		throw refusal(
			`Structured Workspace "${workspace.name}" keeps its definition at revision ${workspace.revision}: a collection holding items keeps its identity.`,
			repointed,
		);
	const errors = definitionErrors(deps, candidate, call);
	if (errors.length > 0) {
		if (!input.allowIncomplete) {
			throw refusal(
				`Structured Workspace "${workspace.name}" keeps its definition at revision ${workspace.revision}: the new definition has ${errors.length} error(s).`,
				errors,
			);
		}
		const updated = deps.store.updateStructuredWorkspace(
			workspace.id,
			input.expectedRevision,
			dataSchema,
			representationSchema,
		);
		retireReplacedTemplates(deps, updated);
		reconcileTemplateOwnership(deps, updated);
		return workspaceView(deps, updated);
	}
	const currentCollectionDocuments = ensureCollectionDocuments(deps, workspace);
	const collectionPlans = Object.entries(
		representationSchema.collections,
	).flatMap(([collectionId, collection]) => {
		const current = currentCollectionDocuments.find(
			(candidate) => candidate.collectionId === collectionId,
		);
		if (!current) return [];
		const document = requiredDocument(
			deps.documents,
			current.documentId,
			"collection document",
		);
		const template = requiredDocument(
			deps.documents,
			collection.collectionTemplateDocumentId,
			"collection template",
		);
		return [
			{
				document,
				pages: synchronizedPages(workspace.id, template, document.pages),
			},
		];
	});
	const removedCollectionDocuments = currentCollectionDocuments.filter(
		(document) => !representationSchema.collections[document.collectionId],
	);

	const breaches = itemBreaches(deps, workspace, next, call);
	if (breaches.length > 0)
		throw refusal(
			`Structured Workspace "${workspace.name}" keeps its definition at revision ${workspace.revision}: ${breaches.length}${breaches.length === MAX_REPORTED_BREACHES ? " or more" : ""} item breach(es) of the new definition, first: ${breaches[0]?.message}`,
			breaches,
		);
	const source = deps.itemSources.sourceFor(workspace.id);
	const plans = deps.store
		.loadOpenedStructuredWorkspaceItems(workspace.id)
		.flatMap((item) => {
			const binding =
				representationSchema.collections[item.collectionId]?.bindings[
					item.bindingId
				];
			if (!binding) return [];
			const record = sourcedRecord(source, item.id);
			if (!record) return [];
			const concreteSchema = structuredWorkspaceBindingSchema(
				dataSchema,
				binding,
			);
			const document = itemDocument(deps.documents, item);
			if (!document) return [];
			const template = requiredDocument(
				deps.documents,
				binding.detailTemplateDocumentId,
				"detail template",
			);
			const pages = synchronizedPages(workspace.id, template, document.pages);
			const previousPages = document.pages;
			document.pages = pages;
			try {
				deps.documentStates.validateSchema(
					document.name,
					concreteSchema,
					record.data,
				);
			} finally {
				document.pages = previousPages;
			}
			return [{ document, record, concreteSchema, pages }];
		});

	const updated = deps.store.updateStructuredWorkspace(
		workspace.id,
		input.expectedRevision,
		dataSchema,
		representationSchema,
	);
	retireReplacedTemplates(deps, updated);
	reconcileTemplateOwnership(deps, updated);
	for (const plan of collectionPlans) {
		plan.document.pages = plan.pages;
		plan.document.activePage = Math.min(
			plan.document.activePage,
			Math.max(0, plan.document.pages.length - 1),
		);
		deps.documents.persist(plan.document.name);
		deps.bus.emit("document:loaded", { docName: plan.document.name });
	}
	for (const collectionDocument of removedCollectionDocuments) {
		const document = deps.documents.resolveById(collectionDocument.documentId);
		if (!document) continue;
		deps.documents.delete(document.name, { allowStructuredWorkspace: true });
		deps.bus.emit("document:deleted", { docName: document.name });
	}
	for (const plan of plans) {
		plan.document.pages = plan.pages;
		deps.documentStates.mirror(
			plan.document.name,
			Number(plan.record.revision),
			plan.concreteSchema,
			plan.record.data,
		);
		deps.documents.persist(plan.document.name);
		deps.bus.emit("document:loaded", { docName: plan.document.name });
	}
	return workspaceView(deps, updated);
}

/** A collection holding items keeps its identity pointer: its items are
 * known by the values under it. */
function identityChanges(
	workspace: StructuredWorkspaceDefinition,
	next: StructuredWorkspaceRepresentationSchema,
	call: string,
): StructuredWorkspaceFinding[] {
	return Object.entries(next.collections).flatMap(
		([collectionId, collection]) => {
			const before = workspace.representationSchema.collections[collectionId];
			if (
				!before?.identity ||
				collection.identity === before.identity ||
				(workspace.itemCounts[collectionId] ?? 0) === 0
			)
				return [];
			return [
				{
					severity: "error" as const,
					object: "schema" as const,
					collection: collectionId,
					path: `representation_schema.collections.${collectionId}.identity`,
					message: `Collection "${collectionId}" holds ${workspace.itemCounts[collectionId]} item(s) known by "${before.identity}"; its identity cannot change.`,
					fix: `Keep identity "${before.identity}", or delete the items and add them again under the new identity.`,
					next: call,
				},
			];
		},
	);
}

/** Breaches of a definition reported at most, by update_definition. */
const MAX_REPORTED_BREACHES = 20;

/** The items a new definition refuses, read by batches through the source:
 * an item of a removed collection or binding, data that breaks the new
 * schemas, an identity value that is not the item id. The first
 * MAX_REPORTED_BREACHES are answered; the read stops there. */
function itemBreaches(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
	next: {
		dataSchema: StructuredWorkspaceDataSchema;
		representationSchema: StructuredWorkspaceRepresentationSchema;
	},
	call: string,
): StructuredWorkspaceFinding[] {
	const findings: StructuredWorkspaceFinding[] = [];
	const breach = (
		collection: string,
		path: string,
		message: string,
		fix: string,
	) =>
		findings.push({
			severity: "error",
			object: "item",
			collection,
			path,
			message,
			fix,
			next: call,
		});
	const source = deps.itemSources.sourceFor(workspace.id);
	for (const [collectionId, count] of Object.entries(workspace.itemCounts)) {
		if (count === 0 || findings.length >= MAX_REPORTED_BREACHES) continue;
		const collection = next.representationSchema.collections[collectionId];
		if (!collection) {
			breach(
				collectionId,
				`representation_schema.collections.${collectionId}`,
				`Representation collection "${collectionId}" is required by its ${count} item(s).`,
				`Keep collection "${collectionId}", or delete its items first.`,
			);
			continue;
		}
		forEachSourceBatch(source, collectionId, (items) => {
			for (const item of items) {
				if (item.issues?.some((issue) => issue.rule === "missing")) continue;
				itemBreach(next, { collectionId, collection, item }, breach);
				if (findings.length >= MAX_REPORTED_BREACHES) return false;
			}
			return true;
		});
	}
	return findings.slice(0, MAX_REPORTED_BREACHES);
}

/** The breaches of one item under a new definition. */
function itemBreach(
	next: { dataSchema: StructuredWorkspaceDataSchema },
	target: {
		collectionId: string;
		collection: StructuredWorkspaceCollectionRepresentation;
		item: ItemSummary;
	},
	breach: (
		collection: string,
		path: string,
		message: string,
		fix: string,
	) => void,
): void {
	const { collectionId, collection, item } = target;
	const binding = collection.bindings[item.bindingId];
	if (!binding) {
		breach(
			collectionId,
			`item "${item.id}"`,
			`Representation binding "${collectionId}.${item.bindingId}" is required by item "${item.id}".`,
			`Keep binding "${item.bindingId}" in collection "${collectionId}", or delete the item first.`,
		);
		return;
	}
	const seen = new Set<string>();
	for (const schema of [
		next.dataSchema,
		bindingSchemaOrEmpty(next.dataSchema, binding.schemaPath),
	])
		for (const issue of structuredWorkspaceItemDataIssues(
			schema,
			item.fields,
		)) {
			if (seen.has(issue.message)) continue;
			seen.add(issue.message);
			breach(
				collectionId,
				`item "${item.id}" ${issue.path}`,
				`Item "${item.id}": ${issue.message} (rule ${issue.rule}).`,
				issue.fix,
			);
		}
	if (
		collection.identity !== undefined &&
		structuredWorkspaceIdentityValue(item.fields, collection.identity) !==
			item.id
	)
		breach(
			collectionId,
			`item "${item.id}" ${collection.identity}`,
			`Item "${item.id}" does not hold its id at the identity "${collection.identity}".`,
			`Point identity at the property holding the item ids, or give every item its id under "${collection.identity}".`,
		);
}

/** Visit every item of a collection, whole data included, batch after
 * batch, until the visitor answers false. */
function forEachSourceBatch(
	source: ItemSource,
	collectionId: string,
	visit: (items: ItemSummary[]) => boolean,
): void {
	let cursor: string | undefined;
	do {
		const page = source.list({
			collectionId,
			limit: structuredWorkspaceMaxBatch,
			whole: true,
			...(cursor === undefined ? {} : { cursor }),
		});
		if (!visit(page.items)) return;
		cursor = page.next;
	} while (cursor !== undefined);
}

function createWorkspace(
	deps: EngineDeps,
	input: CreateStructuredWorkspaceInput,
): StructuredWorkspaceDefinition {
	if (deps.store.loadStructuredWorkspace(input.name)) {
		throw new Error(`Structured Workspace "${input.name}" already exists.`);
	}
	const materialized = materializeRepresentation(deps, {
		workspaceName: input.name,
		dataSchema: input.dataSchema,
		input: input.representationSchema,
		current: null,
	});
	let candidate: StructuredWorkspaceDefinition;
	try {
		const representationSchema = normalizeTemplateDocumentReferences(
			deps.documents,
			materialized.representation,
		);
		assertTemplatesUnlocked(deps.documents, representationSchema);
		candidate = {
			id: crypto.randomUUID(),
			name: input.name,
			...(input.description === undefined
				? {}
				: { description: input.description }),
			dataSchema: input.dataSchema,
			representationSchema,
			revision: 0,
			itemCounts: {},
			createdAt: "",
			updatedAt: "",
		};
		const errors = definitionErrors(
			deps,
			candidate,
			`maket_structured_workspace action=create workspace=${input.name} data_schema=<schema> representation_schema=<corrected, or omit it for generated templates>`,
		);
		if (errors.length > 0 && !input.allowIncomplete) {
			throw refusal(
				`Structured Workspace "${input.name}" was not created: its definition has ${errors.length} error(s).`,
				errors,
			);
		}
	} catch (error) {
		discardDocuments(deps, materialized.created);
		throw error;
	}
	const workspace = deps.store.createStructuredWorkspace({
		id: candidate.id,
		name: candidate.name,
		description: candidate.description,
		dataSchema: candidate.dataSchema,
		representationSchema: candidate.representationSchema,
	});
	reconcileTemplateOwnership(deps, workspace);
	announceCreatedTemplates(deps, materialized.created);
	if (workspaceIntegrity(deps, workspace).status === "ready") {
		ensureCollectionDocuments(deps, workspace);
	}
	return workspace;
}

async function addItem(
	deps: EngineDeps,
	input: AddStructuredWorkspaceItemInput,
): Promise<StructuredWorkspaceItemView> {
	const workspace = requiredReadyWorkspace(deps, input.workspace);
	assertCollectionUnlocked(deps, workspace, input.collectionId);
	const collection = requiredCollection(workspace, input.collectionId);
	const binding = collection.bindings[input.bindingId];
	if (!binding) {
		throw new Error(
			`Representation binding "${input.collectionId}.${input.bindingId}" is not defined in "${workspace.name}".`,
		);
	}
	const itemId = identifiedItemId(workspace, input);
	assertValidItemData(workspace.dataSchema, input.data);
	const bindingSchema = structuredWorkspaceBindingSchema(
		workspace.dataSchema,
		binding,
	);
	assertValidItemData(bindingSchema, input.data);
	assertStateMermaidSources(bindingSchema, input.data);
	if (
		deps.documents.nameTaken(input.documentName) ||
		deps.documents.resolveOrLoad(input.documentName)
	) {
		throw new Error(`Document "${input.documentName}" already exists.`);
	}
	requiredDocument(
		deps.documents,
		binding.detailTemplateDocumentId,
		"detail template",
	);
	const source = deps.itemSources.sourceFor(workspace.id);
	await sourceWrite(
		source,
		"create",
	)({
		id: itemId,
		collectionId: input.collectionId,
		bindingId: input.bindingId,
		data: input.data,
		document: {
			id: itemDocumentId(workspace.id, itemId),
			name: input.documentName,
		},
	});
	const updated = requiredWorkspace(deps.store, workspace.id);
	await source.refresh({ scope: "index" });
	const view = presentItem(
		deps,
		source,
		requiredItem(deps.store, updated, itemId),
	);
	if (!view) throw new Error(`Item "${itemId}" has no data in its source.`);
	return view;
}

async function updateItem(
	deps: EngineDeps,
	workspaceName: string,
	itemId: string,
	expectedRevision: number,
	data: Record<string, unknown>,
): Promise<StructuredWorkspaceItemView> {
	const workspace = requiredReadyWorkspace(deps, workspaceName);
	const item = requiredItem(deps.store, workspace, itemId);
	assertIdentityKept(workspace, item, data);
	assertValidItemData(workspace.dataSchema, data);
	const schema = itemSchema(workspace, item);
	if (schema !== workspace.dataSchema) assertValidItemData(schema, data);
	const document = itemDocument(deps.documents, item);
	if (document) assertDocumentUnlocked(document);
	assertCollectionUnlocked(deps, workspace, item.collectionId);
	const source = deps.itemSources.sourceFor(workspace.id);
	assertStateMermaidSources(schema, data, sourcedRecord(source, item.id)?.data);
	try {
		await sourceWrite(source, "put")(item.id, data, String(expectedRevision));
	} catch (error) {
		if (!isItemSourceError(error) || error.code !== "stale_revision")
			throw error;
		refreshItemMirror(deps, workspace, item);
		throw staleItemRevision(expectedRevision, error.currentRevision);
	}
	await source.refresh({ scope: "item", id: item.id });
	refreshItemMirror(deps, workspace, item);
	const view = presentItem(deps, source, item);
	if (!view) throw new Error(`Item "${itemId}" has no data in its source.`);
	return view;
}

/** The identity pointer of a collection of a ready workspace. */
function collectionIdentity(
	workspace: StructuredWorkspaceDefinition,
	collectionId: string,
): string {
	const identity = requiredCollection(workspace, collectionId).identity;
	if (identity === undefined)
		throw new Error(
			`Collection "${collectionId}" of "${workspace.name}" declares no identity.`,
		);
	return identity;
}

/** The id of an item to add: the value of its collection identity in its
 * data, refused when absent, when another item already bears it, or when it
 * differs from the id the caller gave. */
function identifiedItemId(
	workspace: StructuredWorkspaceDefinition,
	input: AddStructuredWorkspaceItemInput,
): string {
	const identity = collectionIdentity(workspace, input.collectionId);
	const itemId = structuredWorkspaceIdentityValue(input.data, identity);
	if (itemId === null)
		throw itemSourceError(
			"invalid_record",
			`Item data has no identity: add "${identity}" to data, a non-empty string or a number that identifies the item in collection "${input.collectionId}".`,
		);
	if (input.itemId !== undefined && input.itemId !== itemId)
		throw itemSourceError(
			"invalid_record",
			`Item id "${input.itemId}" differs from the identity "${identity}" of the data, "${itemId}": the item id is the identity value.`,
		);
	return itemId;
}

/** Refuse data whose identity value is not the item's id: an item keeps its
 * identity for its whole life. */
function assertIdentityKept(
	workspace: StructuredWorkspaceDefinition,
	item: StructuredWorkspaceItemReference,
	data: Record<string, unknown>,
): void {
	const identity = collectionIdentity(workspace, item.collectionId);
	const value = structuredWorkspaceIdentityValue(data, identity);
	if (value !== item.id)
		throw Object.assign(
			new MessageError(
				`Item "${item.id}" keeps its identity: "${identity}" must stay ${JSON.stringify(item.id)}${value === null ? " and is missing" : `, not ${JSON.stringify(value)}`}. To change it, delete the item and add a new one.`,
				"msg_item_identity_kept",
				{ item: item.id, field: identity },
			),
			{ code: "invalid_record" as const },
		);
}

/** The refusal of a write at a revision the item no longer has, worded as
 * the document state conflict the detail form already handles. */
function staleItemRevision(
	expected: number,
	current: string | undefined,
): MessageError {
	return Object.assign(
		new MessageError(
			`Document state revision conflict: expected ${expected}, current ${current}.`,
			"msg_state_revision_conflict",
			{ expected, current: Number(current) },
		),
		{ code: "stale_revision", currentRevision: current },
	);
}

async function deleteItem(
	deps: EngineDeps,
	workspaceName: string,
	itemId: string,
): Promise<boolean> {
	const workspace = requiredReadyWorkspace(deps, workspaceName);
	const item = requiredItem(deps.store, workspace, itemId);
	const document = itemDocument(deps.documents, item);
	if (document) assertDocumentUnlocked(document);
	assertCollectionUnlocked(deps, workspace, item.collectionId);
	const source = deps.itemSources.sourceFor(workspace.id);
	await sourceWrite(source, "delete")(item.id);
	if (document)
		deps.documents.delete(document.name, { allowStructuredWorkspace: true });
	await source.refresh({ scope: "index" });
	if (document) deps.bus.emit("document:deleted", { docName: document.name });
	return true;
}

function syncTemplates(
	deps: EngineDeps,
	workspaceName: string,
	collectionId?: string,
	bindingId?: string,
): number {
	const workspace = requiredReadyWorkspace(deps, workspaceName);
	const affected = [...deps.documents.all().values()].filter((document) => {
		const owner = document.meta.structuredWorkspace;
		return (
			owner?.workspaceId === workspace.id &&
			owner.role !== "template" &&
			(!collectionId || owner.collectionId === collectionId) &&
			(owner.role === "collection" ||
				!bindingId ||
				owner.bindingId === bindingId)
		);
	});
	for (const document of affected) assertDocumentUnlocked(document);
	reformatGeneratedIndexes(deps, workspace, collectionId);
	let updated = 0;
	for (const collectionDocument of ensureCollectionDocuments(deps, workspace)) {
		if (collectionId && collectionDocument.collectionId !== collectionId)
			continue;
		const collection = requiredCollection(
			workspace,
			collectionDocument.collectionId,
		);
		const template = requiredDocument(
			deps.documents,
			collection.collectionTemplateDocumentId,
			"collection template",
		);
		const document = requiredDocument(
			deps.documents,
			collectionDocument.documentId,
			"collection document",
		);
		document.pages = synchronizedPages(workspace.id, template, document.pages);
		document.activePage = Math.min(
			document.activePage,
			Math.max(0, document.pages.length - 1),
		);
		deps.documents.persist(document.name);
		deps.bus.emit("document:loaded", { docName: document.name });
		updated += 1;
	}
	for (const item of deps.store.loadOpenedStructuredWorkspaceItems(
		workspace.id,
	)) {
		if (collectionId && item.collectionId !== collectionId) continue;
		if (bindingId && item.bindingId !== bindingId) continue;
		const collection = requiredCollection(workspace, item.collectionId);
		const binding = collection.bindings[item.bindingId];
		if (!binding) {
			throw new Error(
				`Unknown binding "${item.collectionId}.${item.bindingId}".`,
			);
		}
		const document = itemDocument(deps.documents, item);
		if (!document) continue;
		const template = requiredDocument(
			deps.documents,
			binding.detailTemplateDocumentId,
			"detail template",
		);
		const previousPages = document.pages;
		document.pages = synchronizedPages(workspace.id, template, document.pages);
		document.activePage = Math.min(
			document.activePage,
			document.pages.length - 1,
		);
		try {
			const state = deps.documentStates.get(document.name);
			if (!state) {
				throw new Error(`Document "${document.name}" has no item data.`);
			}
			deps.documentStates.validateSchema(
				document.name,
				state.current.schema,
				state.current.data,
			);
			deps.documents.persist(document.name);
		} catch (error) {
			document.pages = previousPages;
			throw error;
		}
		deps.bus.emit("document:loaded", { docName: document.name });
		updated += 1;
	}
	return updated;
}

function workspaceView(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
): StructuredWorkspaceView {
	reconcileTemplateOwnership(deps, workspace);
	const integrity = workspaceIntegrity(deps, workspace);
	const { itemCounts, ...definition } = workspace;
	return {
		...definition,
		integrity,
		itemCounts,
		pinnedItems: deps.store
			.loadOpenedStructuredWorkspaceItems(workspace.id)
			.flatMap((item) =>
				item.pinnedAt
					? [
							{
								id: item.id,
								collectionId: item.collectionId,
								documentName: item.documentName,
								pinnedAt: item.pinnedAt,
							},
						]
					: [],
			),
		collectionDocuments:
			integrity.status === "ready"
				? ensureCollectionDocuments(deps, workspace)
				: [],
		templateDocuments: templateDocumentViews(deps, workspace),
	};
}

function ensureCollectionDocuments(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
): StructuredWorkspaceCollectionDocumentView[] {
	return Object.entries(workspace.representationSchema.collections).map(
		([collectionId, collection]) =>
			ensureCollectionDocument(deps, workspace, { collectionId, collection }),
	);
}

function ensureCollectionDocument(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
	target: {
		collectionId: string;
		collection: StructuredWorkspaceRepresentationSchema["collections"][string];
	},
): StructuredWorkspaceCollectionDocumentView {
	const { collectionId, collection } = target;
	const existing = findCollectionDocument(
		deps.documents,
		workspace.id,
		collectionId,
	);
	if (existing) {
		ensureCollectionDocumentState(deps, existing);
		return collectionDocumentView(collectionId, existing);
	}
	const template = requiredDocument(
		deps.documents,
		collection.collectionTemplateDocumentId,
		"collection template",
	);
	const document = instantiateCollectionDocument(
		deps.documents,
		workspace,
		collectionId,
		collection.name,
		template,
	);
	deps.documents.all().set(document.name, document);
	deps.documents.persist(document.name);
	ensureCollectionDocumentState(deps, document);
	deps.bus.emit("document:created", { docName: document.name });
	return collectionDocumentView(collectionId, document);
}

function findCollectionDocument(
	documents: Documents,
	workspaceId: string,
	collectionId: string,
): Document | null {
	return (
		[...documents.all().values()].find((document) => {
			const owner = document.meta.structuredWorkspace;
			return (
				owner?.role === "collection" &&
				owner.workspaceId === workspaceId &&
				owner.collectionId === collectionId
			);
		}) ?? null
	);
}

function requiredCollectionDocument(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
	collectionId: string,
): Document {
	ensureCollectionDocuments(deps, workspace);
	const document = findCollectionDocument(
		deps.documents,
		workspace.id,
		collectionId,
	);
	if (!document) {
		throw new Error(
			`Collection document "${collectionId}" not found in Structured Workspace "${workspace.name}".`,
		);
	}
	return document;
}

function collectionDocumentView(
	collectionId: string,
	document: Document,
): StructuredWorkspaceCollectionDocumentView {
	return {
		collectionId,
		documentId: document.id,
		documentName: document.name,
	};
}

function instantiateCollectionDocument(
	documents: Documents,
	workspace: StructuredWorkspaceDefinition,
	collectionId: string,
	collectionName: string,
	template: Document,
): Document {
	const name = allocatedDocumentName(
		documents,
		`${workspace.name} — ${collectionName}`,
	);
	return createDocument({
		name,
		category: `Structured Workspaces/${workspace.name}`,
		dataModel: "static",
		canvas: structuredClone(template.canvas),
		meta: {
			...templateMeta(template),
			locked: false,
			structuredWorkspace: {
				role: "collection",
				workspaceId: workspace.id,
				collectionId,
			},
		},
		pages: template.pages.map((page) =>
			templatePage(workspace.id, template.id, page),
		),
	});
}

/** The state of a collection document: it holds no item, the index reads
 * them from the collection window. */
const collectionDocumentStateSchema: StructuredWorkspaceDataSchema = {
	type: "object",
	properties: {},
	additionalProperties: false,
};

function ensureCollectionDocumentState(
	deps: EngineDeps,
	document: Document,
): void {
	const state = deps.documentStates.get(document.name);
	if (!state) {
		document.dataModel = "static";
		deps.documents.persist(document.name);
		deps.documentStates.initialize(
			document.name,
			structuredClone(collectionDocumentStateSchema),
			{},
		);
		deps.documents.persist(document.name);
		return;
	}
	if (document.dataModel !== "state") {
		document.dataModel = "state";
		deps.documents.persist(document.name);
	}
	if (
		JSON.stringify(state.current.schema) !==
		JSON.stringify(collectionDocumentStateSchema)
	)
		deps.documentStates.changeSchema(
			document.name,
			state.current.revision,
			structuredClone(collectionDocumentStateSchema),
			{},
		);
}

/** Whether a document the engine names may take `name`: its own current
 * name, or a name no document bears and no item reserves in any workspace. */
function documentNameFree(
	documents: Documents,
	name: string,
	owner?: Document,
): boolean {
	if (owner?.name === name) return true;
	return !documents.nameTaken(name) && documents.resolveOrLoad(name) === null;
}

/** The single allocation of every document name the engine fabricates or
 * adopts: `base` when free, else `base 2`, `base 3`… in that order. */
function allocatedDocumentName(
	documents: Documents,
	base: string,
	owner?: Document,
): string {
	if (documentNameFree(documents, base, owner)) return base;
	let suffix = 2;
	while (!documentNameFree(documents, `${base} ${suffix}`, owner)) suffix += 1;
	return `${base} ${suffix}`;
}

/** An item row as the views show it: the data and revision its source
 * holds, the document that renders it. Null when the source has no such item. */
function presentItem(
	deps: Pick<StructuredWorkspacesDeps, "documents">,
	source: ItemSource,
	item: StructuredWorkspaceItemReference,
): StructuredWorkspaceItemView | null {
	const record = source.get(item.id);
	if (!record) return null;
	const pinnedAt = itemDocument(deps.documents, item)?.pinnedAt;
	return {
		...item,
		...(pinnedAt ? { pinnedAt } : {}),
		data: record.data,
		dataRevision: Number(record.revision),
	};
}

/** One item's record from its source; null when the source has no such item
 * or cannot serve it. */
function sourcedRecord(source: ItemSource, itemId: string): ItemRecord | null {
	try {
		return source.get(itemId);
	} catch (error) {
		if (isItemSourceError(error)) return null;
		throw error;
	}
}

/** A write method of a source, refused as read_only when it lacks it. */
function sourceWrite<K extends "create" | "put" | "delete">(
	source: ItemSource,
	method: K,
): NonNullable<ItemSource[K]> {
	const write = source[method];
	if (!write)
		throw itemSourceError(
			"read_only",
			`The item source does not allow ${method}.`,
		);
	return write.bind(source) as NonNullable<ItemSource[K]>;
}

/** The id of the document that renders an item, the same on every Maket
 * for the same workspace and item. */
function itemDocumentId(workspaceId: string, itemId: string): string {
	const hex = crypto
		.createHash("sha1")
		.update(
			`maket-structured-workspace-item\u0000${workspaceId}\u0000${itemId}`,
		)
		.digest("hex");
	const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
		.toString(16)
		.padStart(2, "0");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

/** The existing document of an item, loaded on demand (item documents are
 * not loaded at boot), or null before it is opened. */
function itemDocument(
	documents: Documents,
	item: StructuredWorkspaceItemReference,
): Document | null {
	const document = documents.resolveOrLoad(item.documentName);
	return document?.id === item.documentId ? document : null;
}

function itemSchema(
	workspace: StructuredWorkspaceDefinition,
	item: StructuredWorkspaceItemReference,
): StructuredWorkspaceDataSchema {
	const binding =
		workspace.representationSchema.collections[item.collectionId]?.bindings[
			item.bindingId
		];
	return binding
		? structuredWorkspaceBindingSchema(workspace.dataSchema, binding)
		: workspace.dataSchema;
}

/** Copy the item's source record into its document's state, when the
 * document exists; the state then holds the source revision alone. */
function refreshItemMirror(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
	item: StructuredWorkspaceItemReference,
	announce = true,
): void {
	const document = itemDocument(deps.documents, item);
	if (!document) return;
	const record = sourcedRecord(
		deps.itemSources.sourceFor(workspace.id),
		item.id,
	);
	if (!record) return;
	deps.documentStates.mirror(
		document.name,
		Number(record.revision),
		itemSchema(workspace, item),
		record.data,
		{ announce },
	);
}

function itemOfDocument(
	deps: EngineDeps,
	documentName: string,
): { workspaceId: string; itemId: string } | null {
	const document = deps.documents.resolveOrLoad(documentName);
	const owner = document?.meta.structuredWorkspace;
	if (
		!document ||
		!owner ||
		owner.role === "collection" ||
		owner.role === "template"
	)
		return null;
	const row = deps.store.loadStructuredWorkspaceItem(
		owner.workspaceId,
		owner.itemId,
	);
	return row?.documentId === document.id
		? { workspaceId: owner.workspaceId, itemId: row.id }
		: null;
}

function openItem(
	deps: EngineDeps,
	workspaceId: string,
	documentName: string,
): Document | null {
	const found =
		deps.store.loadStructuredWorkspaceItemByDocumentName(documentName);
	if (!found || found.workspaceId !== workspaceId) return null;
	const workspace = loadedWorkspace(deps.store, workspaceId);
	if (!workspace || workspaceIntegrity(deps, workspace).status !== "ready")
		return null;
	return openedItemDocument(deps, workspace, itemReference(found.item))
		.document;
}

function materializeItemDocuments(
	deps: EngineDeps,
	documentNames: readonly string[] | undefined,
	exportOnly: Map<string, number>,
): MaterializedItemDocuments {
	const held: string[] = [];
	const leftOut: ItemLeftOut[] = [];
	for (const workspace of deps.store.loadAllStructuredWorkspaces()) {
		const ready = workspaceIntegrity(deps, workspace).status === "ready";
		forEachExportedItem(deps.store, workspace, documentNames, (item) => {
			const left = (reason: string) =>
				leftOut.push({
					workspace: workspace.name,
					item: item.id,
					documentName: item.documentName,
					reason,
				});
			if (!ready) return left("its Workspace is incomplete");
			const holder = deps.documents.resolveOrLoad(item.documentName);
			if (holder && holder.id !== item.documentId)
				return left(`another document bears the name "${item.documentName}"`);
			const opened = openedItemDocument(deps, workspace, item, false);
			const holding = exportOnly.get(opened.document.id);
			if (!opened.created && holding === undefined) return;
			exportOnly.set(opened.document.id, (holding ?? 0) + 1);
			held.push(opened.document.name);
		});
	}
	return { held, leftOut };
}

/** Visit the items an export covers: the named ones, or every item of the
 * workspace, batch after batch. */
function forEachExportedItem(
	store: StructuredWorkspaceRepository,
	workspace: StructuredWorkspaceDefinition,
	documentNames: readonly string[] | undefined,
	visit: (item: StructuredWorkspaceItemReference) => void,
): void {
	if (documentNames) {
		for (const name of documentNames) {
			const found = store.loadStructuredWorkspaceItemByDocumentName(name);
			if (found?.workspaceId === workspace.id) visit(itemReference(found.item));
		}
		return;
	}
	forEachItemRow(store, workspace, (row) => visit(itemReference(row)));
}

/** Every item row of a workspace, collection after collection, in batches
 * of at most structuredWorkspaceMaxBatch rows. */
function forEachItemRow(
	store: StructuredWorkspaceRepository,
	workspace: StructuredWorkspaceDefinition,
	visit: (row: StoredItemQueryRow) => void,
): void {
	for (const [collectionId, count] of Object.entries(workspace.itemCounts)) {
		if (count === 0) continue;
		let after: StoredItemQueryRow["key"] | undefined;
		for (;;) {
			const { rows } = store.loadStructuredWorkspaceItemBatch({
				workspaceId: workspace.id,
				collectionId,
				limit: structuredWorkspaceMaxBatch,
				...(after ? { after } : {}),
			});
			for (const row of rows) visit(row);
			if (rows.length < structuredWorkspaceMaxBatch) break;
			after = rows.at(-1)?.key;
		}
	}
}

/** Remove the item documents an export created, unless the last export
 * holding them is still in flight or the user opened, pinned, locked,
 * annotated or changed them meanwhile. */
function releaseItemDocuments(
	deps: EngineDeps,
	documentNames: readonly string[],
	exportOnly: Map<string, number>,
): void {
	for (const name of documentNames) {
		const document = deps.documents.resolve(name);
		const holding = document ? exportOnly.get(document.id) : undefined;
		if (!document || holding === undefined) continue;
		if (holding > 1) {
			exportOnly.set(document.id, holding - 1);
			continue;
		}
		exportOnly.delete(document.id);
		if (document.pinnedAt || document.meta.locked === true) continue;
		deps.documents.delete(name, { allowStructuredWorkspace: true });
	}
}

/** The item's document, instantiated from its detail template when missing,
 * with its state mirror refreshed from the source. */
function openedItemDocument(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
	item: StructuredWorkspaceItemReference,
	announce = true,
): { document: Document; created: boolean } {
	const existing = deps.documents.resolveOrLoad(item.documentName);
	if (existing && existing.id !== item.documentId)
		throw new Error(
			`Document "${item.documentName}" is not the document of item "${item.id}".`,
		);
	if (existing) {
		refreshItemMirror(deps, workspace, item, announce);
		return { document: existing, created: false };
	}
	const binding = requiredCollection(workspace, item.collectionId).bindings[
		item.bindingId
	];
	if (!binding)
		throw new Error(
			`Representation binding "${item.collectionId}.${item.bindingId}" is not defined in "${workspace.name}".`,
		);
	const document = instantiateDocument(
		workspace,
		item,
		requiredDocument(
			deps.documents,
			binding.detailTemplateDocumentId,
			"detail template",
		),
	);
	deps.documents.all().set(document.name, document);
	try {
		deps.documents.persist(document.name);
		refreshItemMirror(deps, workspace, item, announce);
	} catch (error) {
		deps.documents.delete(document.name, { allowStructuredWorkspace: true });
		throw error;
	}
	if (announce) deps.bus.emit("document:created", { docName: document.name });
	return { document, created: true };
}

function instantiateDocument(
	workspace: StructuredWorkspaceDefinition,
	item: StructuredWorkspaceItemReference,
	template: Document,
): Document {
	return createDocument({
		id: item.documentId,
		name: item.documentName,
		category: `Structured Workspaces/${workspace.name}`,
		canvas: structuredClone(template.canvas),
		meta: {
			...templateMeta(template),
			locked: false,
			structuredWorkspace: {
				role: "item",
				workspaceId: workspace.id,
				collectionId: item.collectionId,
				itemId: item.id,
				bindingId: item.bindingId,
			},
		},
		pages: template.pages.map((page) =>
			templatePage(workspace.id, template.id, page),
		),
	});
}

function synchronizedPages(
	workspaceId: string,
	template: Document,
	currentPages: Page[],
): Page[] {
	const existingByTemplatePage = new Map(
		currentPages.flatMap((page) =>
			page.provenance?.kind === "template"
				? [[page.provenance.templatePageId, page] as const]
				: [],
		),
	);
	const generated = template.pages.map((page) => {
		const existing = existingByTemplatePage.get(page.id);
		return templatePage(workspaceId, template.id, page, existing?.id);
	});
	const instancePages = currentPages.filter(
		(page) => page.provenance?.kind === "instance",
	);
	return [...generated, ...instancePages];
}

type TemplateRole = StructuredWorkspaceTemplateDocumentView["roles"][number];

function templateRoles(
	workspace: StructuredWorkspaceDefinition,
): Map<string, TemplateRole[]> {
	const roles = new Map<string, TemplateRole[]>();
	const add = (documentId: string, role: TemplateRole) => {
		const current = roles.get(documentId) ?? [];
		if (
			!current.some(
				(candidate) => JSON.stringify(candidate) === JSON.stringify(role),
			)
		) {
			current.push(role);
		}
		roles.set(documentId, current);
	};
	for (const [collectionId, collection] of Object.entries(
		workspace.representationSchema.collections ?? {},
	)) {
		add(collection.collectionTemplateDocumentId, {
			role: "collection",
			collectionId,
		});
		for (const [bindingId, binding] of Object.entries(
			collection.bindings ?? {},
		)) {
			add(binding.detailTemplateDocumentId, {
				role: "detail",
				collectionId,
				bindingId,
			});
			if (binding.compactTemplateDocumentId) {
				add(binding.compactTemplateDocumentId, {
					role: "compact",
					collectionId,
					bindingId,
				});
			}
		}
	}
	return roles;
}

function reconcileTemplateOwnership(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
): void {
	const desired = templateRoles(workspace);
	for (const document of deps.documents.all().values()) {
		const owner = document.meta.structuredWorkspace;
		if (owner?.role !== "template" || owner.workspaceId !== workspace.id)
			continue;
		const roles = desired.get(document.id);
		if (!roles) {
			delete document.meta.structuredWorkspace;
			document.category = owner.previousCategory ?? "Templates";
			deps.documents.persist(document.name);
			continue;
		}
		const category = `Structured Workspaces/${workspace.name}`;
		if (
			JSON.stringify(owner.templateRoles) !== JSON.stringify(roles) ||
			document.category !== category
		) {
			owner.templateRoles = roles;
			document.category = category;
			deps.documents.persist(document.name);
		}
		desired.delete(document.id);
	}
	for (const [documentId, roles] of desired) {
		const document = deps.documents.resolveById(documentId);
		if (!document) continue;
		const owner = document.meta.structuredWorkspace;
		if (owner && owner.workspaceId !== workspace.id) continue;
		if (owner && owner.role !== "template") continue;
		const category = `Structured Workspaces/${workspace.name}`;
		document.meta.structuredWorkspace = {
			role: "template",
			workspaceId: workspace.id,
			templateRoles: roles,
			...(document.category === category
				? {}
				: { previousCategory: document.category }),
		};
		document.category = category;
		deps.documents.persist(document.name);
	}
}

function templateDocumentViews(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
): StructuredWorkspaceTemplateDocumentView[] {
	return [...templateRoles(workspace)].flatMap(([documentId, roles]) => {
		const document = deps.documents.resolveById(documentId);
		return document ? [{ documentId, documentName: document.name, roles }] : [];
	});
}

function workspaceIntegrity(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
): StructuredWorkspaceView["integrity"] {
	const issues = deps.definitionIssues(workspace);
	for (const documentId of templateRoles(workspace).keys()) {
		const document = deps.documents.resolveById(documentId);
		if (!document) {
			issues.push(`Template document "${documentId}" was not found.`);
			continue;
		}
		const owner = document.meta.structuredWorkspace;
		if (
			owner &&
			(owner.workspaceId !== workspace.id || owner.role !== "template")
		) {
			issues.push(
				`Template document "${document.name}" is owned by another resource.`,
			);
		}
	}
	for (const item of deps.store.loadOpenedStructuredWorkspaceItems(
		workspace.id,
	)) {
		if (item.owner.workspaceId !== workspace.id)
			issues.push(
				`Item document "${item.documentName}" has invalid ownership.`,
			);
	}
	if (issues.length === 0) {
		for (const [collectionId, collection] of Object.entries(
			workspace.representationSchema.collections,
		)) {
			try {
				const template = requiredDocument(
					deps.documents,
					collection.collectionTemplateDocumentId,
					"collection template",
				);
				const document =
					findCollectionDocument(deps.documents, workspace.id, collectionId) ??
					template;
				const schema = collectionDocumentStateSchema;
				const data = {};
				for (const page of [
					...template.pages,
					...(document !== template ? document.pages : []),
				]) {
					const rendered = renderDocumentStatePage(page, data, { schema });
					if (
						template.pages.includes(page) ||
						page.provenance?.kind === "instance"
					) {
						validateCollectionCardSlots(deps, collection, rendered.html);
					}
				}
			} catch (error) {
				issues.push(
					`Collection "${collectionId}": ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}
	return issues.length === 0
		? { status: "ready", issues: [] }
		: { status: "incomplete", issues };
}

/** A template's meta for a document instantiated from it: never the marker
 * of a Maket-written template, so only templates are ever retired. */
function templateMeta(template: Document): Document["meta"] {
	const {
		structuredWorkspaceGenerated: _generated,
		structuredWorkspaceInline: _inline,
		...meta
	} = structuredClone(template.meta);
	return meta;
}

function templatePage(
	workspaceId: string,
	templateDocumentId: string,
	page: Page,
	id: string = crypto.randomUUID(),
): Page {
	return {
		...structuredClone(page),
		id,
		collection: undefined,
		provenance: {
			kind: "template",
			workspaceId,
			templateDocumentId,
			templatePageId: page.id,
		},
	};
}

function normalizeTemplateDocumentReferences(
	documents: Documents,
	representation: StructuredWorkspaceRepresentationSchema,
): StructuredWorkspaceRepresentationSchema {
	const normalized = structuredClone(representation);
	for (const collection of Object.values(normalized.collections)) {
		collection.collectionTemplateDocumentId = resolveTemplateDocumentReference(
			documents,
			collection.collectionTemplateDocumentId,
		);
		for (const binding of Object.values(collection.bindings)) {
			binding.detailTemplateDocumentId = resolveTemplateDocumentReference(
				documents,
				binding.detailTemplateDocumentId,
			);
			if (binding.compactTemplateDocumentId) {
				binding.compactTemplateDocumentId = resolveTemplateDocumentReference(
					documents,
					binding.compactTemplateDocumentId,
				);
			}
		}
	}
	return normalized;
}

function resolveTemplateDocumentReference(
	documents: Documents,
	reference: string,
): string {
	return (
		(documents.resolveById(reference) ?? documents.resolveOrLoad(reference))
			?.id ?? reference
	);
}

function requiredWorkspace(
	store: StructuredWorkspaceRepository,
	name: string,
): StructuredWorkspaceDefinition {
	const workspace = store.loadStructuredWorkspace(name);
	if (!workspace) throw new Error(`Structured Workspace "${name}" not found.`);
	return workspace;
}

/** The workspace with this id, never one merely named like it. */
function loadedWorkspace(
	store: StructuredWorkspaceRepository,
	workspaceId: string,
): StructuredWorkspaceDefinition | null {
	const workspace = store.loadStructuredWorkspace(workspaceId);
	return workspace?.id === workspaceId ? workspace : null;
}

function requiredReadyWorkspace(
	deps: EngineDeps,
	reference: string,
): StructuredWorkspaceDefinition {
	const workspace = requiredWorkspace(deps.store, reference);
	const integrity = workspaceIntegrity(deps, workspace);
	if (integrity.status === "incomplete") {
		throw new Error(
			`Workspace "${workspace.name}" is incomplete:\n${integrity.issues.join("\n")}`,
		);
	}
	return workspace;
}

function requiredItem(
	store: StructuredWorkspaceRepository,
	workspace: StructuredWorkspaceDefinition,
	itemId: string,
): StructuredWorkspaceItemReference {
	const row = store.loadStructuredWorkspaceItem(workspace.id, itemId);
	if (!row) {
		throw new Error(
			`Item "${itemId}" not found in Structured Workspace "${workspace.name}".`,
		);
	}
	return itemReference(row);
}

/** The reference part of an item row, without its data. */
function itemReference(
	row: StructuredWorkspaceItemReference,
): StructuredWorkspaceItemReference {
	return {
		id: row.id,
		sequence: row.sequence,
		collectionId: row.collectionId,
		bindingId: row.bindingId,
		documentId: row.documentId,
		documentName: row.documentName,
	};
}

function requiredCollection(
	workspace: StructuredWorkspaceDefinition,
	collectionId: string,
) {
	const collection = workspace.representationSchema.collections[collectionId];
	if (!collection) {
		throw new Error(
			`Collection "${collectionId}" not found in Structured Workspace "${workspace.name}".`,
		);
	}
	return collection;
}

function requiredDocument(
	documents: Documents,
	documentId: string,
	role: string,
): Document {
	const document = documents.resolveById(documentId);
	if (!document) throw new Error(`Structured Workspace ${role} not found.`);
	return document;
}

function assertValidItemData(
	schema: StructuredWorkspaceDataSchema,
	data: Record<string, unknown>,
): void {
	const issues = structuredWorkspaceItemDataIssues(schema, data);
	if (issues.length === 0) return;
	throw new Error(
		[
			`Item data breaks the schema (${issues.length} issue(s)):`,
			...issues.map(
				(issue) =>
					`- ${issue.path} [rule ${issue.rule}]: ${issue.message}. Fix: ${issue.fix}`,
			),
		].join("\n"),
	);
}

function restorePageProvenance(
	document: Document,
	sourceId: string,
	workspaceId: string,
	provenanceByPage: ReadonlyMap<string, NonNullable<Page["provenance"]>>,
	resolveId: (id: string) => string,
): void {
	for (const page of document.pages) {
		const source = provenanceByPage.get(`${sourceId}:${page.id}`);
		if (!source) continue;
		page.provenance =
			source.kind === "instance"
				? { kind: "instance", workspaceId }
				: {
						kind: "template",
						workspaceId,
						templateDocumentId: resolveId(source.templateDocumentId),
						templatePageId: source.templatePageId,
					};
	}
}

function assertDocumentUnlocked(document: Document): void {
	if (document.meta.locked === true)
		throw new MessageError(
			`Document "${document.name}" is locked. Unlock it before changing its Workspace.`,
			"msg_document_locked",
			{ name: document.name },
		);
}

function assertWorkspaceUnlocked(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
): void {
	const locked = deps.store.loadLockedStructuredWorkspaceDocument(workspace.id);
	if (locked) {
		const document = deps.documents.resolveOrLoad(locked);
		if (document) assertDocumentUnlocked(document);
	}
	for (const document of deps.documents.all().values()) {
		if (
			document.meta.structuredWorkspace?.workspaceId === workspace.id ||
			templateRoles(workspace).has(document.id)
		)
			assertDocumentUnlocked(document);
	}
}

function assertCollectionUnlocked(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
	collectionId: string,
): void {
	const document = findCollectionDocument(
		deps.documents,
		workspace.id,
		collectionId,
	);
	if (document) assertDocumentUnlocked(document);
}

function publishWorkspaceDeletion(
	deps: EngineDeps,
	workspaceId: string,
	deleted: Array<{ name: string }>,
): void {
	for (const document of deleted) {
		deps.documents.all().delete(document.name);
		deps.bus.emit("document:deleted", { docName: document.name });
	}
	deps.bus.emit("structured-workspace:deleted", { workspaceId });
	deps.bus.emit("structured-workspace:changed", { workspaceId });
}

function assertTemplatesUnlocked(
	documents: Documents,
	representationSchema: StructuredWorkspaceRepresentationSchema,
): void {
	for (const collection of Object.values(representationSchema.collections)) {
		for (const id of [
			collection.collectionTemplateDocumentId,
			...Object.values(collection.bindings).flatMap((binding) => [
				binding.detailTemplateDocumentId,
				...(binding.compactTemplateDocumentId
					? [binding.compactTemplateDocumentId]
					: []),
			]),
		]) {
			const document = documents.resolveById(id);
			if (document) assertDocumentUnlocked(document);
		}
	}
}

const templateCanvas = {
	format: "A4",
	orientation: "portrait",
	w: 210,
	h: 297,
	bg: "#ffffff",
};

/** Whether the index template is one Maket generated from the schema alone
 * (not written inline nor named by the agent), unedited apart from its title,
 * that still has the former A4 canvas or the former A4 markup. A narrow index
 * whose title or canvas the agent changed is current. */
function outdatedGeneratedIndex(template: Document): boolean {
	const [page, ...rest] = template.pages;
	if (
		template.meta.structuredWorkspaceGenerated !== true ||
		!page?.html ||
		rest.length > 0
	)
		return false;
	const generated = generatedStructuredWorkspaceIndex(page.html);
	return (
		generated !== null &&
		(generated.kind === "legacy" ||
			template.canvas.format !== structuredWorkspaceIndexCanvas.format)
	);
}

/** Give the outdated index templates Maket generated (see
 * outdatedGeneratedIndex) the narrow markup with their own title and, when
 * not already AUTO, the narrow content-height canvas; their collection
 * documents follow. Locked templates stay as they are. */
function reformatGeneratedIndexes(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
	onlyCollectionId?: string,
): void {
	for (const [collectionId, collection] of Object.entries(
		workspace.representationSchema.collections ?? {},
	)) {
		if (onlyCollectionId && collectionId !== onlyCollectionId) continue;
		const template = deps.documents.resolveById(
			collection.collectionTemplateDocumentId,
		);
		if (
			!template ||
			template.meta.locked === true ||
			!outdatedGeneratedIndex(template)
		)
			continue;
		const [page] = template.pages;
		const generated = page?.html
			? generatedStructuredWorkspaceIndex(page.html)
			: null;
		if (!page || !generated) continue;
		if (template.canvas.format !== structuredWorkspaceIndexCanvas.format)
			template.canvas = {
				...structuredClone(structuredWorkspaceIndexCanvas),
				bg: template.canvas.bg,
			};
		page.html = structuredWorkspaceGeneratedIndexHtml(generated.title);
		deps.documents.persist(template.name);
		deps.bus.emit("document:loaded", { docName: template.name });
		const document = findCollectionDocument(
			deps.documents,
			workspace.id,
			collectionId,
		);
		if (!document || document.meta.locked === true) continue;
		document.canvas = structuredClone(template.canvas);
		document.pages = synchronizedPages(workspace.id, template, document.pages);
		document.activePage = Math.min(
			document.activePage,
			Math.max(0, document.pages.length - 1),
		);
		deps.documents.persist(document.name);
		deps.bus.emit("document:loaded", { docName: document.name });
	}
}

interface MaterializeRequest {
	workspaceName: string;
	dataSchema: StructuredWorkspaceDataSchema;
	input: StructuredWorkspaceRepresentationInput | undefined;
	current: StructuredWorkspaceRepresentationSchema | null;
}

interface MaterializedRepresentation {
	representation: StructuredWorkspaceRepresentationSchema;
	/** Template documents written for this call, discarded on refusal. */
	created: Document[];
	preferredNames: ReadonlyMap<string, string>;
}

function templateReferences(deps: EngineDeps) {
	const resolve = (id: string | undefined) =>
		id === undefined
			? null
			: (deps.documents.resolveById(id) ??
				deps.documents.all().get(id) ??
				null);
	return {
		live: (id: string | undefined) => (resolve(id) ? id : undefined),
		generatedTemplate: (id: string | undefined) =>
			resolve(id)?.meta.structuredWorkspaceGenerated === true,
	};
}

/** Writes template documents in the workspace category and records them. */
function templateWriter(deps: EngineDeps, workspaceName: string) {
	const created: Document[] = [];
	const preferredNames = new Map<string, string>();
	const write = (
		name: string,
		html: string,
		form?: JsonFormsTemplate,
		canvas: Document["canvas"] = templateCanvas,
		meta: Document["meta"] = { structuredWorkspaceGenerated: true },
	) => {
		const document = createDocument({
			name: allocatedDocumentName(deps.documents, name),
			category: `Structured Workspaces/${workspaceName}`,
			canvas: structuredClone(canvas),
			meta,
			pages: [
				{ name: "Template", elements: [], html },
				...(form ? [{ name: "Form", elements: [], jsonForms: form }] : []),
			],
		});
		deps.documents.all().set(document.name, document);
		deps.documents.persist(document.name);
		created.push(document);
		preferredNames.set(document.id, name);
		return document.id;
	};
	return { write, created, preferredNames };
}

interface BindingMaterialization {
	dataSchema: StructuredWorkspaceDataSchema;
	collection: StructuredWorkspaceCollectionInput;
	name: string;
	/** The collection identity, read-only in the generated form. */
	identity: string | undefined;
	/** Prefix of the names of the template documents written for the binding. */
	label: string;
	before:
		| StructuredWorkspaceCollectionRepresentation["bindings"][string]
		| undefined;
	references: ReturnType<typeof templateReferences>;
	write: ReturnType<typeof templateWriter>["write"];
}

/** One binding with its detail template and, when it has one, its card. */
function materializeBinding(
	binding: StructuredWorkspaceBindingInput,
	context: BindingMaterialization,
): StructuredWorkspaceCollectionRepresentation["bindings"][string] {
	const { dataSchema, collection, name, label, before, references, write } =
		context;
	const schemaPath = binding.schemaPath ?? before?.schemaPath ?? "";
	const generated = generateStructuredWorkspaceTemplates(
		name,
		bindingSchemaOrEmpty(dataSchema, schemaPath),
		context.identity,
	);
	const detailHtml =
		binding.detailTemplateHtml ?? collection.detailTemplateHtml;
	const detailForm = binding.detailForm ?? collection.detailForm;
	const inlineDetail = detailHtml !== undefined || detailForm !== undefined;
	const rebound = before !== undefined && schemaPath !== before.schemaPath;
	const kept = (id: string | undefined) =>
		rebound && references.generatedTemplate(id)
			? undefined
			: references.live(id);
	let detailId =
		binding.detailTemplateDocumentId ??
		(inlineDetail ? undefined : kept(before?.detailTemplateDocumentId));
	if (detailId === undefined) {
		const form =
			detailForm ??
			(detailHtml === undefined ? generated.detailForm : undefined);
		const html = detailHtml ?? generated.detailHtml;
		detailId = write(`${label} — detail template`, html, form);
	}
	const compactHtml =
		binding.compactTemplateHtml ?? collection.compactTemplateHtml;
	let compactId =
		binding.compactTemplateDocumentId ??
		(compactHtml === undefined
			? kept(before?.compactTemplateDocumentId)
			: undefined);
	if (
		compactId === undefined &&
		(compactHtml !== undefined ||
			(binding.detailTemplateDocumentId === undefined &&
				(!before ||
					(before.compactTemplateDocumentId !== undefined &&
						!kept(before.compactTemplateDocumentId)))))
	) {
		compactId = write(
			`${label} — card template`,
			compactHtml ?? generated.compactHtml,
		);
	}
	return {
		schemaPath,
		detailTemplateDocumentId: detailId,
		...(compactId === undefined
			? {}
			: { compactTemplateDocumentId: compactId }),
	};
}

/**
 * The representation schema with a template document behind every
 * reference. A reference given by name or id stays as given; a template given
 * inline, or absent and absent from the current definition (or named there
 * by a reference that no longer resolves), becomes a new document in the
 * Workspace category, generated from the binding schema when no HTML is
 * given. `preferredNames` holds the name each new document asked for.
 */
function materializeRepresentation(
	deps: EngineDeps,
	request: MaterializeRequest,
): MaterializedRepresentation {
	const { workspaceName, dataSchema, input, current } = request;
	const references = templateReferences(deps);
	const { write, created, preferredNames } = templateWriter(
		deps,
		workspaceName,
	);
	const collectionsInput: Record<string, StructuredWorkspaceCollectionInput> =
		input?.collections ?? { items: { name: "Items" } };
	const collections: StructuredWorkspaceRepresentationSchema["collections"] =
		{};
	try {
		for (const [collectionId, collection] of Object.entries(collectionsInput)) {
			const previous = current?.collections[collectionId];
			const name = collection.name ?? previous?.name ?? collectionId;
			const label = `${workspaceName} — ${name}`;
			const bindingsInput: Record<string, StructuredWorkspaceBindingInput> =
				collection.bindings ??
				(previous
					? Object.fromEntries(
							Object.keys(previous.bindings).map((id) => [id, {}]),
						)
					: { item: {} });
			const identity =
				collection.identity ??
				previous?.identity ??
				structuredWorkspaceDefaultIdentity(
					Object.entries(bindingsInput).map(([id, binding]) =>
						bindingSchemaOrEmpty(
							dataSchema,
							binding.schemaPath ?? previous?.bindings[id]?.schemaPath ?? "",
						),
					),
				);
			const bindingIds = Object.keys(bindingsInput);
			const bindings: StructuredWorkspaceCollectionRepresentation["bindings"] =
				{};
			for (const [bindingId, binding] of Object.entries(bindingsInput)) {
				bindings[bindingId] = materializeBinding(binding, {
					dataSchema,
					collection,
					name,
					identity,
					label: `${label}${bindingIds.length > 1 ? ` (${bindingId})` : ""}`,
					before: previous?.bindings[bindingId],
					references,
					write,
				});
			}
			const {
				name: _name,
				collectionTemplateDocumentId,
				indexTemplateHtml,
				detailTemplateHtml: _detail,
				compactTemplateHtml: _compact,
				detailForm: _form,
				bindings: _bindings,
				...layout
			} = collection;
			const collectionTemplateId =
				collectionTemplateDocumentId ??
				(indexTemplateHtml === undefined
					? references.live(previous?.collectionTemplateDocumentId)
					: undefined) ??
				(indexTemplateHtml === undefined
					? write(
							`${label} — index template`,
							generateStructuredWorkspaceTemplates(name, {}).indexHtml,
							undefined,
							structuredWorkspaceIndexCanvas,
						)
					: write(
							`${label} — index template`,
							indexTemplateHtml,
							undefined,
							templateCanvas,
							{ structuredWorkspaceInline: true },
						));
			collections[collectionId] = {
				...layout,
				name,
				...(identity === undefined ? {} : { identity }),
				collectionTemplateDocumentId: collectionTemplateId,
				bindings,
			};
		}
	} catch (error) {
		discardDocuments(deps, created);
		throw error;
	}
	return {
		representation: {
			version: (input?.version ?? 1) as 1,
			collections,
		},
		created,
		preferredNames,
	};
}

function bindingSchemaOrEmpty(
	dataSchema: StructuredWorkspaceDataSchema,
	schemaPath: string,
): StructuredWorkspaceDataSchema {
	try {
		return structuredWorkspaceBindingSchema(dataSchema, {
			schemaPath,
			detailTemplateDocumentId: "",
		});
	} catch {
		return {};
	}
}

function discardDocuments(deps: EngineDeps, documents: Document[]): void {
	for (const document of documents) deps.documents.delete(document.name);
}

/** Delete the templates Maket wrote for this Workspace that its definition
 * no longer references. */
function retireReplacedTemplates(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
): void {
	const referenced = templateRoles(workspace);
	for (const document of [...deps.documents.all().values()]) {
		const owner = document.meta.structuredWorkspace;
		if (
			(document.meta.structuredWorkspaceGenerated !== true &&
				document.meta.structuredWorkspaceInline !== true) ||
			owner?.role !== "template" ||
			owner.workspaceId !== workspace.id ||
			referenced.has(document.id)
		)
			continue;
		deps.documents.delete(document.name, { allowStructuredWorkspace: true });
		deps.bus.emit("document:deleted", { docName: document.name });
	}
}

/** Give each template written for the call the name it asked for once the
 * template it replaces is gone. */
function adoptPreferredNames(
	deps: EngineDeps,
	materialized: MaterializedRepresentation,
): void {
	for (const document of materialized.created) {
		const preferred = materialized.preferredNames.get(document.id);
		if (
			!preferred ||
			preferred === document.name ||
			!documentNameFree(deps.documents, preferred, document)
		)
			continue;
		const oldName = document.name;
		deps.documents.rename(oldName, preferred);
		deps.bus.emit("document:renamed", { oldName, docName: preferred });
	}
}

function announceCreatedTemplates(
	deps: EngineDeps,
	documents: Document[],
): void {
	for (const document of documents)
		deps.bus.emit("document:created", { docName: document.name });
}

function definitionErrors(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
	next: string,
): StructuredWorkspaceFinding[] {
	return diagnoseWorkspace(deps, workspace, { items: false, next }).filter(
		(finding) => finding.severity === "error",
	);
}

function checkWorkspace(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
): StructuredWorkspaceCheck {
	const findings = diagnoseWorkspace(deps, workspace, {
		items: true,
		next: `maket_structured_workspace action=update_definition workspace=${workspace.id} expected_workspace_revision=${workspace.revision} representation_schema=<corrected>`,
	});
	return {
		workspace: workspace.name,
		verdict: findings.some((finding) => finding.severity === "error")
			? "not ready"
			: "ready",
		findings,
	};
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Workspace diagnosis: reads the definition, its template documents and its items, each owning its own rule.
function diagnoseWorkspace(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
	options: { items: boolean; next: string },
): StructuredWorkspaceFinding[] {
	const { next } = options;
	const findings: StructuredWorkspaceFinding[] =
		diagnoseStructuredWorkspaceDefinition(
			workspace.dataSchema,
			workspace.representationSchema,
		).map((finding) => ({ ...finding, next }));
	for (const [collectionId, collection] of Object.entries(
		workspace.representationSchema.collections ?? {},
	)) {
		const base = `representation_schema.collections.${collectionId}`;
		const reference = { workspace, collectionId, next };
		const index = collection.collectionTemplateDocumentId
			? templateDocument(deps, reference, findings, {
					path: `${base}.collectionTemplateDocumentId`,
					id: collection.collectionTemplateDocumentId,
				})
			: null;
		let cards = false;
		for (const [bindingId, binding] of Object.entries(
			collection.bindings ?? {},
		)) {
			const path = `${base}.bindings.${bindingId}`;
			const detail = binding.detailTemplateDocumentId
				? templateDocument(deps, reference, findings, {
						path: `${path}.detailTemplateDocumentId`,
						id: binding.detailTemplateDocumentId,
					})
				: null;
			const compact = binding.compactTemplateDocumentId
				? templateDocument(deps, reference, findings, {
						path: `${path}.compactTemplateDocumentId`,
						id: binding.compactTemplateDocumentId,
					})
				: null;
			if (binding.compactTemplateDocumentId) cards = true;
			let schema: StructuredWorkspaceDataSchema;
			try {
				schema = structuredWorkspaceBindingSchema(
					workspace.dataSchema,
					binding,
				);
			} catch {
				continue;
			}
			for (const document of [detail, compact]) {
				if (document)
					findings.push(...templatePageFindings(document, schema, reference));
			}
			if (detail?.meta.structuredWorkspaceGenerated === true)
				findings.push(
					...hiddenPropertyFindings(workspace, schema, {
						collectionId,
						path,
						next,
					}),
				);
		}
		if (index && outdatedGeneratedIndex(index)) {
			const sync = `maket_structured_workspace action=sync_template workspace=${workspace.id} collection=${collectionId}`;
			const locked = index.meta.locked === true;
			findings.push({
				severity: "warning",
				object: "index",
				collection: collectionId,
				path: `document "${index.name}"`,
				message: `The index template "${index.name}" that Maket generated is a full page, unreadable in the list pane${locked ? "; it is locked" : ""}.`,
				fix: locked
					? "Unlock the index template, then synchronize the collection: Maket gives its generated index a narrow page of content height."
					: "Synchronize the collection: Maket gives its generated index a narrow page of content height.",
				next: locked
					? `maket_workspace action=lock doc="${index.name}" locked=false, then ${sync}`
					: sync,
			});
		}
		if (index) {
			findings.push(
				...templatePageFindings(
					index,
					collectionDocumentStateSchema,
					reference,
					"warning",
				),
			);
			if (
				!index.pages.some((page) =>
					page.html?.includes("data-maket-structured-items"),
				)
			)
				findings.push({
					severity: "warning",
					object: "index",
					collection: collectionId,
					path: `document "${index.name}"`,
					message: `The index template "${index.name}" has no item slot, so the index shows no item.`,
					fix: `Add <section data-maket-structured-items></section> to the index template, or remove collectionTemplateDocumentId so Maket generates it.`,
					next,
				});
		}
		if (!cards && Object.keys(collection.bindings ?? {}).length > 0)
			findings.push({
				severity: "hint",
				object: "index",
				collection: collectionId,
				path: `${base}.bindings`,
				message: `No binding of collection "${collectionId}" has a compact template, so its index shows no card.`,
				fix: "Give compactTemplateHtml (or compactTemplateDocumentId) to the binding.",
				next,
			});
		for (const field of ["groupBy", "sortBy"] as const) {
			const pointer = collection[field];
			if (
				pointer?.startsWith("/") &&
				!structuredWorkspaceSchemaDeclaresPath(workspace.dataSchema, pointer)
			)
				findings.push({
					severity: "error",
					object: "index",
					collection: collectionId,
					path: `${base}.${field}`,
					message: `Collection "${collectionId}" ${field} "${pointer}" names no property of the data schema.`,
					fix: `Point ${field} at a declared property${suggestedPointer(workspace.dataSchema, collection)}, or declare "${pointer}" in data_schema.`,
					next,
				});
		}
	}
	if (options.items) findings.push(...itemFindings(deps, workspace));
	const integrity = workspaceIntegrity(deps, workspace);
	if (
		integrity.status === "incomplete" &&
		!findings.some((finding) => finding.severity === "error")
	) {
		for (const issue of integrity.issues)
			findings.push({
				severity: "error",
				object: "collection",
				path: "representation_schema",
				message: issue,
				fix: "Correct the definition or the template document it names, then call check.",
				next,
			});
	}
	return findings;
}

function suggestedPointer(
	dataSchema: StructuredWorkspaceDataSchema,
	collection: StructuredWorkspaceCollectionRepresentation,
): string {
	const binding = Object.values(collection.bindings ?? {})[0];
	const field = binding
		? structuredWorkspaceTemplateFields(
				bindingSchemaOrEmpty(dataSchema, binding.schemaPath),
			)[0]
		: undefined;
	return field ? ` such as "/${field.name}"` : "";
}

interface FindingReference {
	workspace: StructuredWorkspaceDefinition;
	collectionId: string;
	next: string;
}

/** The template document a reference names, or null with a finding. */
function templateDocument(
	deps: EngineDeps,
	reference: FindingReference,
	findings: StructuredWorkspaceFinding[],
	target: { path: string; id: string },
): Document | null {
	const { workspace, collectionId, next } = reference;
	const field = target.path.slice(target.path.lastIndexOf(".") + 1);
	const document =
		deps.documents.resolveById(target.id) ??
		deps.documents.all().get(target.id) ??
		null;
	if (!document) {
		const close = closeDocumentNames(deps, target.id);
		findings.push({
			severity: "error",
			object: "template",
			collection: collectionId,
			path: target.path,
			message: `No document is named or identified "${target.id}".`,
			fix: `Remove ${field} so Maket creates the template itself${close.length ? `, or use the exact name ${close.map((name) => `"${name}"`).join(" or ")}` : ", or give the template HTML inline"}.`,
			next,
		});
		return null;
	}
	const owner = document.meta.structuredWorkspace;
	if (
		owner &&
		(owner.workspaceId !== workspace.id || owner.role !== "template")
	) {
		findings.push({
			severity: "error",
			object: "template",
			collection: collectionId,
			path: target.path,
			message: `Template document "${document.name}" is owned by another resource.`,
			fix: `Remove ${field} so Maket creates a template owned by this Workspace, or give the template HTML inline.`,
			next,
		});
		return document;
	}
	const category = `Structured Workspaces/${workspace.name}`;
	if (owner && document.category !== category)
		findings.push({
			severity: "warning",
			object: "template",
			collection: collectionId,
			path: target.path,
			message: `Template document "${document.name}" sits in category "${document.category}", outside the Workspace category "${category}".`,
			fix: "Open the Workspace with view, which files its templates in the Workspace category.",
			next: `maket_structured_workspace action=view workspace=${workspace.id}`,
		});
	return document;
}

/** Findings of a template's pages. A placeholder the schema does not declare
 * renders empty: an error on item templates, a warning on an index template,
 * which still composes its cards. */
function templatePageFindings(
	document: Document,
	schema: StructuredWorkspaceDataSchema,
	reference: FindingReference,
	placeholderSeverity: StructuredWorkspaceFinding["severity"] = "error",
): StructuredWorkspaceFinding[] {
	const { collectionId, next } = reference;
	const findings: StructuredWorkspaceFinding[] = [];
	const fields = structuredWorkspaceTemplateFields(schema)
		.slice(0, 5)
		.map((field) => `{{ state.${field.name} }}`)
		.join(", ");
	const add = (
		object: StructuredWorkspaceFinding["object"],
		path: string,
		message: string,
		fix: string,
	) =>
		findings.push({
			severity: "error",
			object,
			collection: collectionId,
			path,
			message,
			fix,
			next,
		});
	for (const page of document.pages) {
		if (!page.html && !page.jsonForms) continue;
		const path = `document "${document.name}" page "${page.name ?? page.id}"`;
		try {
			validateDocumentStatePageTemplate(page);
		} catch (error) {
			add(
				page.jsonForms ? "form" : "template",
				path,
				errorMessage(error),
				"Correct the template page; a page with a form needs exactly one <!--maket-json-form--> slot inside a block element.",
			);
			continue;
		}
		if (page.html) {
			try {
				validateDocumentStateTemplateBindings(page.html, schema);
			} catch (error) {
				add(
					"template",
					path,
					errorMessage(error),
					unsupportedKeywordFix(error, schema) ??
						`Bind only declared properties${fields ? `, such as ${fields}` : ""}.`,
				);
			}
			for (const issue of documentStateTemplateReferenceIssues(
				page.html,
				schema,
			))
				findings.push({
					severity: placeholderSeverity,
					object: "template",
					collection: collectionId,
					path,
					message: issue,
					fix:
						unsupportedKeywordFix(issue, schema) ??
						`Declare that property in data_schema, or use a declared one${fields ? ` such as ${fields}` : ""}.`,
					next,
				});
			if (hasJsonFormSlot(page.html) && !page.jsonForms)
				add(
					"form",
					path,
					"The page has a <!--maket-json-form--> slot but no form definition.",
					"Remove the <!--maket-json-form--> slot from the HTML: the form goes in detailForm, which Maket places on its own page of the detail template.",
				);
		}
		if (page.jsonForms) {
			try {
				renderJsonFormsTemplate(page.jsonForms, {}, schema);
			} catch (error) {
				add(
					"form",
					path,
					errorMessage(error),
					`Point every form Control scope at a declared property, such as "#/properties/${structuredWorkspaceTemplateFields(schema)[0]?.name ?? "title"}".`,
				);
			}
		}
	}
	return findings;
}

/** The fix of a template error caused by a binding schema that combines
 * alternatives: bind a concrete branch instead. */
function unsupportedKeywordFix(
	error: unknown,
	schema: StructuredWorkspaceDataSchema,
): string | null {
	const message = typeof error === "string" ? error : errorMessage(error);
	if (!message.includes("unsupported schema keyword")) return null;
	return `Set the binding schemaPath to a concrete branch such as "${concreteBranchPath(schema)}", whose properties the template can name.`;
}

/** A path of the data schema that names one concrete alternative: its first
 * definition, else its first oneOf, anyOf or allOf branch. */
function concreteBranchPath(schema: StructuredWorkspaceDataSchema): string {
	for (const key of ["$defs", "definitions"] as const) {
		const definitions = schema[key];
		const first =
			definitions && typeof definitions === "object"
				? Object.keys(definitions)[0]
				: undefined;
		if (first !== undefined) return `/${key}/${first}`;
	}
	for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
		if (Array.isArray(schema[keyword]) && schema[keyword].length > 0)
			return `/${keyword}/0`;
	}
	return "/$defs/<name>";
}

/** Hints for the properties generated templates leave out, so a ready
 * verdict never hides one. */
function hiddenPropertyFindings(
	workspace: StructuredWorkspaceDefinition,
	schema: StructuredWorkspaceDataSchema,
	at: { collectionId: string; path: string; next: string },
): StructuredWorkspaceFinding[] {
	return structuredWorkspaceHiddenProperties(schema).map((hidden) => ({
		severity: "hint",
		object: "template",
		collection: at.collectionId,
		path: at.path,
		message: hidden.name
			? `Property "${hidden.name}" is not shown by the generated templates: ${hidden.reason}.`
			: `The generated templates show no property: ${hidden.reason}.`,
		fix: hidden.name
			? `Give detailTemplateHtml (and compactTemplateHtml) that show "${hidden.name}", or make it a plain property of data_schema.`
			: (unsupportedKeywordFix(
					"unsupported schema keyword",
					bindingSchemaOrEmpty(workspace.dataSchema, ""),
				) ?? "Bind a concrete branch of the data schema."),
		next: at.next,
	}));
}

/** Names of documents within a small edit distance of a reference, closest
 * first, so a typo gets a suggestion. */
function closeDocumentNames(deps: EngineDeps, reference: string): string[] {
	const wanted = reference.toLowerCase();
	const limit = Math.max(2, Math.floor(wanted.length / 4));
	return [...deps.documents.all().values()]
		.map((document) => ({
			name: document.name,
			distance: editDistance(wanted, document.name.toLowerCase()),
		}))
		.filter((candidate) => candidate.distance <= limit)
		.sort((left, right) => left.distance - right.distance)
		.slice(0, 3)
		.map((candidate) => candidate.name);
}

function editDistance(left: string, right: string): number {
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let row = 1; row <= left.length; row += 1) {
		const current = [row];
		for (let column = 1; column <= right.length; column += 1) {
			current[column] = Math.min(
				(previous[column] ?? 0) + 1,
				(current[column - 1] ?? 0) + 1,
				(previous[column - 1] ?? 0) +
					(left[row - 1] === right[column - 1] ? 0 : 1),
			);
		}
		previous = current;
	}
	return previous[right.length] ?? 0;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Item diagnosis: reads the items by batches through their source, and the item documents that exist.
function itemFindings(
	deps: EngineDeps,
	workspace: StructuredWorkspaceDefinition,
): StructuredWorkspaceFinding[] {
	const findings: StructuredWorkspaceFinding[] = [];
	const ref = workspace.id;
	const [firstCollectionId, firstCollection] =
		Object.entries(workspace.representationSchema.collections ?? {})[0] ?? [];
	if (Object.values(workspace.itemCounts).every((count) => count === 0))
		findings.push({
			severity: "hint",
			object: "item",
			path: "items",
			message: `Workspace "${workspace.name}" has no item yet.`,
			fix: "Add the first item; its data must satisfy the data schema.",
			next: `maket_structured_workspace action=add_item workspace=${ref} collection=${firstCollectionId ?? "<collection>"} binding=${Object.keys(firstCollection?.bindings ?? {})[0] ?? "<binding>"} document_name=<name> data=<json>`,
		});
	const conflicts = new Map(
		deps.store
			.loadStructuredWorkspaceItemNameConflicts(workspace.id)
			.map((conflict) => [conflict.item.id, conflict.holder]),
	);
	const source = deps.itemSources.sourceFor(workspace.id);
	for (const [collectionId, collection] of Object.entries(
		workspace.representationSchema.collections ?? {},
	)) {
		if ((workspace.itemCounts[collectionId] ?? 0) === 0) continue;
		forEachSourceBatch(source, collectionId, (items) => {
			for (const item of items)
				findings.push(
					...recordFindings(
						workspace,
						{ collectionId, collection, item },
						conflicts.get(item.id),
					),
				);
			return true;
		});
	}
	const unsynced = new Set<string>();
	for (const item of deps.store.loadOpenedStructuredWorkspaceItems(
		workspace.id,
	)) {
		if (item.owner.itemId !== item.id)
			findings.push({
				severity: "error",
				object: "item",
				collection: item.collectionId,
				path: `document "${item.documentName}"`,
				message: `Document "${item.documentName}" renders item "${item.id}" but names item "${item.owner.itemId ?? ""}".`,
				fix: "Delete the document; it is created again from the item when the item is opened.",
				next: `maket_doc action=delete doc=${item.documentName}`,
			});
		const binding =
			workspace.representationSchema.collections[item.collectionId]?.bindings[
				item.bindingId
			];
		const template = binding
			? deps.documents.resolveById(binding.detailTemplateDocumentId)
			: null;
		const document = itemDocument(deps.documents, item);
		if (document && template && !pagesInSync(template, document.pages))
			unsynced.add(item.collectionId);
	}
	for (const [collectionId, collection] of Object.entries(
		workspace.representationSchema.collections ?? {},
	)) {
		const document = findCollectionDocument(
			deps.documents,
			workspace.id,
			collectionId,
		);
		const template = deps.documents.resolveById(
			collection.collectionTemplateDocumentId,
		);
		if (document && template && !pagesInSync(template, document.pages))
			unsynced.add(collectionId);
	}
	for (const collectionId of unsynced)
		findings.push({
			severity: "warning",
			object: "template",
			collection: collectionId,
			path: `collection "${collectionId}"`,
			message: `Template-controlled pages of collection "${collectionId}" differ from their templates.`,
			fix: "Synchronize the instantiated documents with their templates.",
			next: `maket_structured_workspace action=sync_template workspace=${ref} collection=${collectionId}`,
		});
	return findings;
}

/** The findings of one item record: its reserved name held by another
 * document, missing data, schema issues, an identity value that is not its
 * id. */
function recordFindings(
	workspace: StructuredWorkspaceDefinition,
	target: {
		collectionId: string;
		collection: StructuredWorkspaceCollectionRepresentation;
		item: ItemSummary;
	},
	holder: string | undefined,
): StructuredWorkspaceFinding[] {
	const { collectionId, collection, item } = target;
	const ref = workspace.id;
	const path = `item "${item.id}"`;
	const findings: StructuredWorkspaceFinding[] = [];
	const error = (at: string, message: string, fix: string, next: string) =>
		findings.push({
			severity: "error",
			object: "item",
			collection: collectionId,
			path: at,
			message,
			fix,
			next,
		});
	if (holder)
		error(
			path,
			`Document "${holder}" holds the name reserved for the document of item "${item.id}", so the item can be neither opened nor exported.`,
			`Rename the document "${holder}"; the name stays reserved for the item.`,
			`maket_doc action=rename doc=${holder} name=<new name>`,
		);
	const update = `maket_structured_workspace action=update_item workspace=${ref} item=${item.id} expected_revision=${item.revision}`;
	if (item.issues?.some((issue) => issue.rule === "missing")) {
		error(
			path,
			`Item "${item.id}" has no data in its source.`,
			"Write the item data with update_item; it keeps the item id and position.",
			`${update} data=<item data>`,
		);
		return findings;
	}
	const binding = collection.bindings[item.bindingId];
	if (!binding) return findings;
	const seen = new Set<string>();
	for (const schema of [
		workspace.dataSchema,
		bindingSchemaOrEmpty(workspace.dataSchema, binding.schemaPath),
	])
		for (const issue of structuredWorkspaceItemDataIssues(
			schema,
			item.fields,
		)) {
			if (seen.has(issue.message)) continue;
			seen.add(issue.message);
			error(
				`${path} ${issue.path}`,
				`${issue.message} (rule ${issue.rule}).`,
				issue.fix,
				`${update} data=<corrected>`,
			);
		}
	if (
		collection.identity !== undefined &&
		structuredWorkspaceIdentityValue(item.fields, collection.identity) !==
			item.id
	)
		error(
			`${path} ${collection.identity}`,
			`Item "${item.id}" does not hold its id at the identity "${collection.identity}".`,
			`Give "${collection.identity}" the value ${JSON.stringify(item.id)}.`,
			`${update} data=<data with ${collection.identity} = ${JSON.stringify(item.id)}>`,
		);
	return findings;
}

/** Whether the template-controlled pages match the template's pages. */
function pagesInSync(template: Document, pages: Page[]): boolean {
	const controlled = pages.filter(
		(page) => page.provenance?.kind === "template",
	);
	if (controlled.length !== template.pages.length) return false;
	return template.pages.every((source) => {
		const page = controlled.find(
			(candidate) =>
				candidate.provenance?.kind === "template" &&
				candidate.provenance.templatePageId === source.id,
		);
		return (
			page !== undefined &&
			(page.html ?? "") === (source.html ?? "") &&
			JSON.stringify(page.jsonForms ?? null) ===
				JSON.stringify(source.jsonForms ?? null)
		);
	});
}
