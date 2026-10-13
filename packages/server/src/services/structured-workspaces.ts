import crypto from "node:crypto";
import type {
	BundleStructuredWorkspaceSnapshot,
	JsonFormsTemplate,
	StructuredWorkspaceCheck,
	StructuredWorkspaceCollectionDocumentView,
	StructuredWorkspaceCollectionRepresentation,
	StructuredWorkspaceDataSchema,
	StructuredWorkspaceDefinition,
	StructuredWorkspaceFinding,
	StructuredWorkspaceGroupValue,
	StructuredWorkspaceItemView,
	StructuredWorkspaceRepresentationSchema,
	StructuredWorkspaceTemplateDocumentView,
	StructuredWorkspaceView,
} from "@maket/shared";
import {
	diagnoseStructuredWorkspaceDefinition,
	documentStateTemplateReferenceIssues,
	generateStructuredWorkspaceTemplates,
	hasJsonFormSlot,
	readJsonPointer,
	renderDocumentStatePage,
	renderJsonFormsTemplate,
	structuredWorkspaceBindingSchema,
	structuredWorkspaceDefaultPageSize,
	structuredWorkspaceHiddenProperties,
	structuredWorkspaceItemDataIssues,
	structuredWorkspaceSchemaDeclaresPath,
	structuredWorkspaceTemplateFields,
	validateDocumentStatePageTemplate,
	validateDocumentStateTemplateBindings,
	validateStructuredWorkspaceDefinition,
} from "@maket/shared";
import { parseHTML } from "linkedom";
import { MessageError } from "../lib/message-error.js";
import { scopeCssToElement } from "../lib/scoped-css.js";
import { createDocument, type Document, type Page } from "../types.js";
import type { Bus } from "./bus.js";
import type { DocumentStates } from "./document-states.js";
import type { Documents } from "./documents.js";
import {
	type FlowRanges,
	flowedPageIdentity,
	markFlowedPage,
	type PageFlow,
	remapPageLinkNumbers,
} from "./page-flow.js";
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
	addItem(input: AddStructuredWorkspaceItemInput): StructuredWorkspaceItemView;
	updateItem(
		workspaceName: string,
		itemId: string,
		expectedRevision: number,
		data: Record<string, unknown>,
	): StructuredWorkspaceItemView;
	deleteItem(workspaceName: string, itemId: string): boolean;
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

export interface StructuredWorkspacesDeps {
	bus: Bus;
	documents: Documents;
	documentStates: DocumentStates;
	store: StructuredWorkspaceRepository;
	pageFlow?: Pick<PageFlow, "pages">;
}

export function createStructuredWorkspaces(
	deps: StructuredWorkspacesDeps,
): StructuredWorkspaces {
	const compactCards: CompactCardCache = new Map();
	deps.bus.on("document-state:changed", ({ docName }) => {
		reconcileItemDocumentState(deps, docName);
	});
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
		addItem(input) {
			const item = addItem(deps, input);
			const workspace = requiredWorkspace(deps.store, input.workspace);
			deps.bus.emit("structured-workspace:changed", {
				workspaceId: workspace.id,
			});
			return item;
		},
		updateItem(workspaceName, itemId, expectedRevision, data) {
			return updateItem(deps, workspaceName, itemId, expectedRevision, data);
		},
		deleteItem(workspaceName, itemId) {
			const workspace = requiredWorkspace(deps.store, workspaceName);
			const deleted = deleteItem(deps, workspaceName, itemId);
			deps.bus.emit("structured-workspace:changed", {
				workspaceId: workspace.id,
			});
			return deleted;
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
			const item = deps.store
				.loadAllStructuredWorkspaces()
				.find((candidate) => candidate.id === workspaceId)
				?.items.find((candidate) => candidate.id === itemId);
			if (!item) return null;
			try {
				return itemView(deps, item);
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
	deps: StructuredWorkspacesDeps,
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
	for (const item of source.items) {
		const document = documentsBySourceId.get(item.documentId);
		if (!document || !deps.documentStates.get(document.name))
			throw new Error(
				`Portable workspace item "${item.id}" has no imported state-backed document.`,
			);
	}
	const workspace = deps.store.createStructuredWorkspace({
		id: crypto.randomUUID(),
		name,
		description: source.description,
		dataSchema: structuredClone(source.dataSchema),
		representationSchema,
	});
	reconcileTemplateOwnership(deps, workspace);
	const provenanceByPage = new Map(
		snapshot.pageProvenance.map((entry) => [
			`${entry.documentId}:${entry.pageId}`,
			entry.provenance,
		]),
	);
	for (const item of [...source.items].sort(
		(a, b) => a.position - b.position,
	)) {
		const document = documentsBySourceId.get(item.documentId);
		if (!document)
			throw new Error(
				`Portable workspace item document "${item.documentId}" is missing.`,
			);
		document.category = `Structured Workspaces/${name}`;
		document.meta.structuredWorkspace = {
			role: "item",
			workspaceId: workspace.id,
			collectionId: item.collectionId,
			itemId: item.id,
			bindingId: item.bindingId,
		};
		restorePageProvenance(
			document,
			item.documentId,
			workspace.id,
			provenanceByPage,
			resolveId,
		);
		deps.documents.persist(document.name);
		deps.store.addStructuredWorkspaceItem(workspace.id, {
			id: item.id,
			collectionId: item.collectionId,
			bindingId: item.bindingId,
			documentId: document.id,
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
				availableCollectionDocumentName(deps.documents, preferredName),
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

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Aggregate rename owns the domain plan and cache/event reconciliation around
// the repository's single atomic persistence transaction.
function renameWorkspace(
	deps: StructuredWorkspacesDeps,
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
				? [{ id: document.id, newName: `${trimmed} — ${collection.name}` }]
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
	deps: StructuredWorkspacesDeps,
	compactCards: CompactCardCache,
	target: { workspaceId: string; collectionId: string },
): Document {
	const { workspaceId, collectionId } = target;
	const workspace = deps.store
		.loadAllStructuredWorkspaces()
		.find((candidate) => candidate.id === workspaceId);
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
	const items = workspace.items
		.filter((item) => item.collectionId === collectionId)
		.map((item) => itemView(deps, item));
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
			{ workspace, collection, items, compactCards },
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

interface CollectionCardEntry {
	item: StructuredWorkspaceItemView;
	cards: Element[];
	/** Scoped style sheets of the compact templates, by template key. */
	styles: Map<string, string>;
}

interface CompactCard {
	element: Element;
	style: { key: string; css: string } | null;
}

interface CollectionCardGroup {
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
	items: StructuredWorkspaceItemView[];
	compactCards: CompactCardCache;
}

/** Rendered compact cards by template content, item data revision and slot,
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
	deps: StructuredWorkspacesDeps,
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
						cards: sortCollectionEntries(entries, collection).flatMap(
							(entry) => entry.cards,
						),
					},
				],
			];
		}
		return flowCollectionGroups(
			groupCollectionCards(
				entries,
				collection.groupBy,
				collection.groupOrder ?? [],
			).map((group) => ({
				...group,
				entries: sortCollectionEntries(group.entries, collection),
			})),
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
	deps: StructuredWorkspacesDeps,
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
				item.dataRevision,
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

function groupCollectionCards(
	entries: CollectionCardEntry[],
	groupBy: string,
	groupOrder: StructuredWorkspaceGroupValue[],
): CollectionCardGroup[] {
	const groups = new Map<string, CollectionCardGroup>();
	for (const value of groupOrder) {
		groups.set(groupKey(value), { label: groupLabel(value), entries: [] });
	}
	for (const entry of entries) {
		const value = groupValue(entry.item.data, groupBy);
		const key = groupKey(value);
		const group = groups.get(key) ?? { label: groupLabel(value), entries: [] };
		group.entries.push(entry);
		groups.set(key, group);
	}
	return [...groups.values()].filter((group) => group.entries.length > 0);
}

/** Entries ordered by `sortBy`; without it, insertion order. Items without a
 * value come last in both directions; equal values keep insertion order. */
function sortCollectionEntries(
	entries: CollectionCardEntry[],
	collection: Pick<
		StructuredWorkspaceCollectionRepresentation,
		"sortBy" | "sortDirection"
	>,
): CollectionCardEntry[] {
	const { sortBy } = collection;
	if (sortBy === undefined) return entries;
	const sign = collection.sortDirection === "descending" ? -1 : 1;
	return entries
		.map((entry) => ({ entry, value: groupValue(entry.item.data, sortBy) }))
		.sort((left, right) => {
			const leftMissing = left.value === null;
			const rightMissing = right.value === null;
			if (leftMissing || rightMissing) {
				return Number(leftMissing) - Number(rightMissing);
			}
			return sign * compareSortValues(left.value, right.value);
		})
		.map(({ entry }) => entry);
}

function compareSortValues(left: unknown, right: unknown): number {
	const rank = (value: unknown) =>
		typeof value === "number"
			? 0
			: typeof value === "string"
				? 1
				: typeof value === "boolean"
					? 2
					: 3;
	const byRank = rank(left) - rank(right);
	if (byRank !== 0) return byRank;
	if (typeof left === "number" && typeof right === "number") {
		return left - right;
	}
	if (typeof left === "string" && typeof right === "string") {
		return left.localeCompare(right, undefined, { numeric: true });
	}
	if (typeof left === "boolean" && typeof right === "boolean") {
		return Number(left) - Number(right);
	}
	return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function groupValue(data: Record<string, unknown>, groupBy: string): unknown {
	try {
		return readJsonPointer(data, groupBy) ?? null;
	} catch {
		return null;
	}
}

function groupKey(value: unknown): string {
	return JSON.stringify(value ?? null);
}

function groupLabel(value: unknown): string {
	if (value === null || value === undefined || value === "") return "—";
	return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Pages of at most `pageSize` cards, laid out group by group. */
function flowCollectionGroups(
	groups: CollectionCardGroup[],
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
				count: cards.length,
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
	item: StructuredWorkspaceItemView,
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
	item: StructuredWorkspaceItemView,
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
	wrapper.setAttribute("data-id", `${prefix}-card`);
	wrapper.setAttribute("data-maket-action", "open-document");
	wrapper.setAttribute("data-maket-document", documentName);
	wrapper.setAttribute("role", "button");
	wrapper.setAttribute("tabindex", "0");
	wrapper.setAttribute("style", "cursor:pointer");
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
	deps: StructuredWorkspacesDeps,
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
	deps: StructuredWorkspacesDeps,
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
		return workspaceView(deps, requiredWorkspace(deps.store, workspace.id));
	} catch (error) {
		const persisted = deps.store.loadStructuredWorkspace(workspace.id);
		if (persisted?.revision === workspace.revision)
			discardDocuments(deps, materialized.created);
		throw error;
	}
}

function replaceDefinition(
	deps: StructuredWorkspacesDeps,
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
	const errors = definitionErrors(
		deps,
		candidate,
		`maket_structured_workspace action=update_definition workspace=${workspace.id} expected_workspace_revision=${workspace.revision} representation_schema=<corrected>`,
	);
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

	const plans = workspace.items.map((item) => {
		const collection = representationSchema.collections[item.collectionId];
		if (!collection) {
			throw new Error(
				`Representation collection "${item.collectionId}" is required by item "${item.id}".`,
			);
		}
		const binding = collection.bindings[item.bindingId];
		if (!binding) {
			throw new Error(
				`Representation binding "${item.collectionId}.${item.bindingId}" is required by item "${item.id}".`,
			);
		}
		const document = requiredDocument(
			deps.documents,
			item.documentId,
			"instantiated document",
		);
		const state = deps.documentStates.get(document.name);
		if (!state)
			throw new Error(`Document "${document.name}" has no item data.`);
		assertValidItemData(dataSchema, state.current.data);
		const concreteSchema = structuredWorkspaceBindingSchema(
			dataSchema,
			binding,
		);
		assertValidItemData(concreteSchema, state.current.data);
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
				state.current.data,
			);
		} finally {
			document.pages = previousPages;
		}
		return { document, state, concreteSchema, pages };
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
		if (
			JSON.stringify(plan.state.current.schema) !==
			JSON.stringify(plan.concreteSchema)
		) {
			deps.documentStates.changeSchema(
				plan.document.name,
				plan.state.current.revision,
				plan.concreteSchema,
				plan.state.current.data,
			);
		}
		deps.documents.persist(plan.document.name);
		deps.bus.emit("document:loaded", { docName: plan.document.name });
	}
	return workspaceView(deps, updated);
}

function createWorkspace(
	deps: StructuredWorkspacesDeps,
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
			items: [],
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

function addItem(
	deps: StructuredWorkspacesDeps,
	input: AddStructuredWorkspaceItemInput,
): StructuredWorkspaceItemView {
	const workspace = requiredReadyWorkspace(deps, input.workspace);
	assertCollectionUnlocked(deps, workspace, input.collectionId);
	const collection = requiredCollection(workspace, input.collectionId);
	const binding = collection.bindings[input.bindingId];
	if (!binding) {
		throw new Error(
			`Representation binding "${input.collectionId}.${input.bindingId}" is not defined in "${workspace.name}".`,
		);
	}
	assertValidItemData(workspace.dataSchema, input.data);
	const bindingSchema = structuredWorkspaceBindingSchema(
		workspace.dataSchema,
		binding,
	);
	assertValidItemData(bindingSchema, input.data);
	if (deps.documents.resolveOrLoad(input.documentName)) {
		throw new Error(`Document "${input.documentName}" already exists.`);
	}
	const template = requiredDocument(
		deps.documents,
		binding.detailTemplateDocumentId,
		"detail template",
	);
	const itemId = input.itemId ?? crypto.randomUUID();
	if (workspace.items.some((item) => item.id === itemId)) {
		throw new Error(`Item "${itemId}" already exists in "${workspace.name}".`);
	}
	const document = instantiateDocument(
		workspace,
		itemId,
		input.collectionId,
		input.bindingId,
		input.documentName,
		template,
	);
	deps.documents.all().set(document.name, document);
	try {
		deps.documents.persist(document.name);
		const state = deps.documentStates.initialize(
			document.name,
			bindingSchema,
			input.data,
		);
		deps.documents.persist(document.name);
		const item = deps.store.addStructuredWorkspaceItem(workspace.id, {
			id: itemId,
			collectionId: input.collectionId,
			bindingId: input.bindingId,
			documentId: document.id,
		});
		refreshCollectionDocumentState(
			deps,
			requiredWorkspace(deps.store, input.workspace),
			input.collectionId,
		);
		deps.bus.emit("document:created", { docName: document.name });
		return {
			...item,
			documentName: document.name,
			data: state.current.data,
			dataRevision: state.current.revision,
		};
	} catch (error) {
		deps.documents.delete(document.name, { allowStructuredWorkspace: true });
		throw error;
	}
}

function updateItem(
	deps: StructuredWorkspacesDeps,
	workspaceName: string,
	itemId: string,
	expectedRevision: number,
	data: Record<string, unknown>,
): StructuredWorkspaceItemView {
	const workspace = requiredReadyWorkspace(deps, workspaceName);
	const item = requiredItem(workspace, itemId);
	assertValidItemData(workspace.dataSchema, data);
	const binding =
		workspace.representationSchema.collections[item.collectionId]?.bindings[
			item.bindingId
		];
	if (binding)
		assertValidItemData(
			structuredWorkspaceBindingSchema(workspace.dataSchema, binding),
			data,
		);
	const document = requiredDocument(
		deps.documents,
		item.documentId,
		"instantiated document",
	);
	assertDocumentUnlocked(document);
	assertCollectionUnlocked(deps, workspace, item.collectionId);
	const revision = deps.documentStates.update(
		document.name,
		expectedRevision,
		data,
	);
	return {
		...item,
		documentName: document.name,
		data: revision.data,
		dataRevision: revision.revision,
	};
}

function reconcileItemDocumentState(
	deps: StructuredWorkspacesDeps,
	docName: string,
): void {
	const document = deps.documents.resolveOrLoad(docName);
	const ownership = document?.meta.structuredWorkspace;
	if (
		!document ||
		!ownership ||
		ownership.role === "collection" ||
		ownership.role === "template"
	)
		return;
	const workspace = deps.store
		.loadAllStructuredWorkspaces()
		.find((candidate) => candidate.id === ownership.workspaceId);
	if (!workspace) return;
	const item = workspace.items.find(
		(candidate) =>
			candidate.id === ownership.itemId && candidate.documentId === document.id,
	);
	if (!item) return;
	if (alignCollectionEntry(deps, workspace, item, document) === "rebuilt") {
		deps.bus.emit("structured-workspace:changed", {
			workspaceId: workspace.id,
		});
		return;
	}
	deps.bus.emit("structured-workspace:item-changed", {
		workspaceId: workspace.id,
		itemId: item.id,
	});
}

/**
 * Replace only this item's entry in its collection projection state. A
 * projection whose shape no longer matches the items is rebuilt whole, which
 * may create or replace the projection document.
 */
function alignCollectionEntry(
	deps: StructuredWorkspacesDeps,
	workspace: StructuredWorkspaceDefinition,
	item: StructuredWorkspaceDefinition["items"][number],
	document: Document,
): "entry" | "rebuilt" {
	const collectionDocument = findCollectionDocument(
		deps.documents,
		workspace.id,
		item.collectionId,
	);
	const collectionState =
		collectionDocument && deps.documentStates.get(collectionDocument.name);
	const itemState = deps.documentStates.get(document.name);
	const entries = workspace.items
		.filter((candidate) => candidate.collectionId === item.collectionId)
		.sort((left, right) => left.position - right.position);
	const index = entries.findIndex((candidate) => candidate.id === item.id);
	const projected = collectionState?.current.data.items;
	if (
		!collectionDocument ||
		!collectionState ||
		!itemState ||
		collectionDocument.dataModel !== "state" ||
		!Array.isArray(projected) ||
		projected.length !== entries.length ||
		JSON.stringify(collectionState.current.schema) !==
			JSON.stringify(collectionDocumentStateSchema(workspace))
	) {
		refreshCollectionDocumentState(deps, workspace, item.collectionId);
		return "rebuilt";
	}
	if (
		JSON.stringify(projected[index]) === JSON.stringify(itemState.current.data)
	)
		return "entry";
	deps.documentStates.replaceProjectionEntry(
		collectionDocument.name,
		collectionState.current.revision,
		`/items/${index}`,
		itemState.current.data,
	);
	return "entry";
}

function deleteItem(
	deps: StructuredWorkspacesDeps,
	workspaceName: string,
	itemId: string,
): boolean {
	const workspace = requiredReadyWorkspace(deps, workspaceName);
	const item = requiredItem(workspace, itemId);
	const document = requiredDocument(
		deps.documents,
		item.documentId,
		"instantiated document",
	);
	assertDocumentUnlocked(document);
	assertCollectionUnlocked(deps, workspace, item.collectionId);
	const deleted = deps.store.deleteStructuredWorkspaceItem(
		workspace.id,
		item.id,
	);
	if (!deleted) return false;
	deps.documents.delete(document.name, { allowStructuredWorkspace: true });
	const updatedWorkspace = requiredWorkspace(deps.store, workspaceName);
	refreshCollectionDocumentState(deps, updatedWorkspace, item.collectionId);
	deps.bus.emit("document:deleted", { docName: document.name });
	return deleted;
}

function syncTemplates(
	deps: StructuredWorkspacesDeps,
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
	for (const item of workspace.items) {
		if (collectionId && item.collectionId !== collectionId) continue;
		if (bindingId && item.bindingId !== bindingId) continue;
		const collection = requiredCollection(workspace, item.collectionId);
		const binding = collection.bindings[item.bindingId];
		if (!binding) {
			throw new Error(
				`Unknown binding "${item.collectionId}.${item.bindingId}".`,
			);
		}
		const template = requiredDocument(
			deps.documents,
			binding.detailTemplateDocumentId,
			"detail template",
		);
		const document = requiredDocument(
			deps.documents,
			item.documentId,
			"instantiated document",
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
	deps: StructuredWorkspacesDeps,
	workspace: StructuredWorkspaceDefinition,
): StructuredWorkspaceView {
	reconcileTemplateOwnership(deps, workspace);
	const integrity = workspaceIntegrity(deps, workspace);
	return {
		...workspace,
		integrity,
		items: workspace.items.flatMap((item) => {
			try {
				return [itemView(deps, item)];
			} catch {
				return [];
			}
		}),
		collectionDocuments:
			integrity.status === "ready"
				? ensureCollectionDocuments(deps, workspace)
				: [],
		templateDocuments: templateDocumentViews(deps, workspace),
	};
}

function ensureCollectionDocuments(
	deps: StructuredWorkspacesDeps,
	workspace: StructuredWorkspaceDefinition,
): StructuredWorkspaceCollectionDocumentView[] {
	return Object.entries(workspace.representationSchema.collections).map(
		([collectionId, collection]) =>
			ensureCollectionDocument(deps, workspace, collectionId, collection),
	);
}

function ensureCollectionDocument(
	deps: StructuredWorkspacesDeps,
	workspace: StructuredWorkspaceDefinition,
	collectionId: string,
	collection: StructuredWorkspaceRepresentationSchema["collections"][string],
): StructuredWorkspaceCollectionDocumentView {
	const existing = findCollectionDocument(
		deps.documents,
		workspace.id,
		collectionId,
	);
	if (existing) {
		ensureCollectionDocumentState(deps, workspace, collectionId, existing);
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
	ensureCollectionDocumentState(deps, workspace, collectionId, document);
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
	deps: StructuredWorkspacesDeps,
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
	const name = availableCollectionDocumentName(
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

function ensureCollectionDocumentState(
	deps: StructuredWorkspacesDeps,
	workspace: StructuredWorkspaceDefinition,
	collectionId: string,
	document: Document,
): void {
	const schema = collectionDocumentStateSchema(workspace);
	const data = collectionDocumentStateData(deps, workspace, collectionId);
	const state = deps.documentStates.get(document.name);
	if (!state) {
		document.dataModel = "static";
		deps.documents.persist(document.name);
		deps.documentStates.initialize(document.name, schema, data);
		deps.documents.persist(document.name);
		return;
	}
	if (document.dataModel !== "state") {
		document.dataModel = "state";
		deps.documents.persist(document.name);
	}
	if (JSON.stringify(state.current.schema) !== JSON.stringify(schema)) {
		deps.documentStates.changeSchema(
			document.name,
			state.current.revision,
			schema,
			data,
		);
		return;
	}
	if (JSON.stringify(state.current.data) !== JSON.stringify(data)) {
		deps.documentStates.update(document.name, state.current.revision, data);
	}
}

function refreshCollectionDocumentState(
	deps: StructuredWorkspacesDeps,
	workspace: StructuredWorkspaceDefinition,
	collectionId: string,
): void {
	const document = requiredCollectionDocument(deps, workspace, collectionId);
	ensureCollectionDocumentState(deps, workspace, collectionId, document);
}

function collectionDocumentStateSchema(
	workspace: StructuredWorkspaceDefinition,
): StructuredWorkspaceDataSchema {
	const itemSchema = structuredClone(workspace.dataSchema);
	const definitions = itemSchema.$defs;
	const legacyDefinitions = itemSchema.definitions;
	delete itemSchema.$defs;
	delete itemSchema.definitions;
	return {
		type: "object",
		properties: {
			items: {
				type: "array",
				items: itemSchema,
			},
		},
		required: ["items"],
		additionalProperties: false,
		...(definitions ? { $defs: structuredClone(definitions) } : {}),
		...(legacyDefinitions
			? { definitions: structuredClone(legacyDefinitions) }
			: {}),
	};
}

function collectionDocumentStateData(
	deps: StructuredWorkspacesDeps,
	workspace: StructuredWorkspaceDefinition,
	collectionId: string,
	options: { clone: boolean } = { clone: true },
): Record<string, unknown> {
	return {
		items: workspace.items
			.filter((item) => item.collectionId === collectionId)
			.sort((left, right) => left.position - right.position)
			.map((item) => {
				const data = itemView(deps, item).data;
				return options.clone ? structuredClone(data) : data;
			}),
	};
}

function availableCollectionDocumentName(
	documents: Documents,
	base: string,
): string {
	if (!documents.resolveOrLoad(base)) return base;
	let suffix = 2;
	while (documents.resolveOrLoad(`${base} ${suffix}`)) suffix += 1;
	return `${base} ${suffix}`;
}

function itemView(
	deps: StructuredWorkspacesDeps,
	item: StructuredWorkspaceDefinition["items"][number],
): StructuredWorkspaceItemView {
	const document = requiredDocument(
		deps.documents,
		item.documentId,
		"instantiated document",
	);
	const current = deps.documentStates.current(document.name);
	if (!current)
		throw new Error(`Document "${document.name}" has no item data.`);
	return {
		...item,
		documentName: document.name,
		...(document.pinnedAt ? { pinnedAt: document.pinnedAt } : {}),
		data: current.data,
		dataRevision: current.revision,
	};
}

function instantiateDocument(
	workspace: StructuredWorkspaceDefinition,
	itemId: string,
	collectionId: string,
	bindingId: string,
	documentName: string,
	template: Document,
): Document {
	return createDocument({
		name: documentName,
		category: `Structured Workspaces/${workspace.name}`,
		canvas: structuredClone(template.canvas),
		meta: {
			...templateMeta(template),
			locked: false,
			structuredWorkspace: {
				role: "item",
				workspaceId: workspace.id,
				collectionId,
				itemId,
				bindingId,
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
	deps: StructuredWorkspacesDeps,
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
	deps: StructuredWorkspacesDeps,
	workspace: StructuredWorkspaceDefinition,
): StructuredWorkspaceTemplateDocumentView[] {
	return [...templateRoles(workspace)].flatMap(([documentId, roles]) => {
		const document = deps.documents.resolveById(documentId);
		return document ? [{ documentId, documentName: document.name, roles }] : [];
	});
}

function workspaceIntegrity(
	deps: StructuredWorkspacesDeps,
	workspace: StructuredWorkspaceDefinition,
): StructuredWorkspaceView["integrity"] {
	const issues = validateStructuredWorkspaceDefinition(
		workspace.dataSchema,
		workspace.representationSchema,
	);
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
	for (const item of workspace.items) {
		const document = deps.documents.resolveById(item.documentId);
		if (!document) {
			issues.push(`Item "${item.id}" has no document.`);
			continue;
		}
		if (document.meta.structuredWorkspace?.workspaceId !== workspace.id) {
			issues.push(`Item document "${document.name}" has invalid ownership.`);
		}
		if (!deps.documentStates.current(document.name)) {
			issues.push(`Item document "${document.name}" has no state.`);
		}
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
				const schema = collectionDocumentStateSchema(workspace);
				const data = collectionDocumentStateData(
					deps,
					workspace,
					collectionId,
					{
						clone: false,
					},
				);
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
	const { structuredWorkspaceGenerated: _generated, ...meta } = structuredClone(
		template.meta,
	);
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

function requiredReadyWorkspace(
	deps: StructuredWorkspacesDeps,
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
	workspace: StructuredWorkspaceDefinition,
	itemId: string,
) {
	const item = workspace.items.find((candidate) => candidate.id === itemId);
	if (!item) {
		throw new Error(
			`Item "${itemId}" not found in Structured Workspace "${workspace.name}".`,
		);
	}
	return item;
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
	deps: StructuredWorkspacesDeps,
	workspace: StructuredWorkspaceDefinition,
): void {
	for (const document of deps.documents.all().values()) {
		if (
			document.meta.structuredWorkspace?.workspaceId === workspace.id ||
			templateRoles(workspace).has(document.id)
		)
			assertDocumentUnlocked(document);
	}
}

function assertCollectionUnlocked(
	deps: StructuredWorkspacesDeps,
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
	deps: StructuredWorkspacesDeps,
	workspaceId: string,
	deleted: Array<{ name: string }>,
): void {
	for (const document of deleted) {
		deps.documents.all().delete(document.name);
		deps.bus.emit("document:deleted", { docName: document.name });
	}
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

/**
 * The representation schema with a template document behind every
 * reference. A reference given by name or id stays as given; a template given
 * inline, or absent and absent from the current definition (or named there
 * by a reference that no longer resolves), becomes a new document in the
 * Workspace category, generated from the binding schema when no HTML is
 * given. `preferredNames` holds the name each new document asked for.
 */
function materializeRepresentation(
	deps: StructuredWorkspacesDeps,
	request: MaterializeRequest,
): MaterializedRepresentation {
	const { workspaceName, dataSchema, input, current } = request;
	const created: Document[] = [];
	const preferredNames = new Map<string, string>();
	const resolve = (id: string | undefined) =>
		id === undefined
			? null
			: (deps.documents.resolveById(id) ??
				deps.documents.all().get(id) ??
				null);
	const live = (id: string | undefined) => (resolve(id) ? id : undefined);
	const generatedTemplate = (id: string | undefined) =>
		resolve(id)?.meta.structuredWorkspaceGenerated === true;
	const write = (name: string, html: string, form?: JsonFormsTemplate) => {
		const document = createDocument({
			name: availableCollectionDocumentName(deps.documents, name),
			category: `Structured Workspaces/${workspaceName}`,
			canvas: structuredClone(templateCanvas),
			meta: { structuredWorkspaceGenerated: true },
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
			const bindingIds = Object.keys(bindingsInput);
			const bindings: StructuredWorkspaceCollectionRepresentation["bindings"] =
				{};
			for (const [bindingId, binding] of Object.entries(bindingsInput)) {
				const before = previous?.bindings[bindingId];
				const schemaPath = binding.schemaPath ?? before?.schemaPath ?? "";
				const suffix = bindingIds.length > 1 ? ` (${bindingId})` : "";
				const generated = generateStructuredWorkspaceTemplates(
					name,
					bindingSchemaOrEmpty(dataSchema, schemaPath),
				);
				const detailHtml =
					binding.detailTemplateHtml ?? collection.detailTemplateHtml;
				const detailForm = binding.detailForm ?? collection.detailForm;
				const inlineDetail =
					detailHtml !== undefined || detailForm !== undefined;
				const rebound =
					before !== undefined && schemaPath !== before.schemaPath;
				const kept = (id: string | undefined) =>
					rebound && generatedTemplate(id) ? undefined : live(id);
				let detailId =
					binding.detailTemplateDocumentId ??
					(inlineDetail ? undefined : kept(before?.detailTemplateDocumentId));
				if (detailId === undefined) {
					const form =
						detailForm ??
						(detailHtml === undefined ? generated.detailForm : undefined);
					const html = detailHtml ?? generated.detailHtml;
					detailId = write(`${label}${suffix} — detail template`, html, form);
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
						`${label}${suffix} — card template`,
						compactHtml ?? generated.compactHtml,
					);
				}
				bindings[bindingId] = {
					schemaPath,
					detailTemplateDocumentId: detailId,
					...(compactId === undefined
						? {}
						: { compactTemplateDocumentId: compactId }),
				};
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
					? live(previous?.collectionTemplateDocumentId)
					: undefined) ??
				write(
					`${label} — index template`,
					indexTemplateHtml ??
						generateStructuredWorkspaceTemplates(name, {}).indexHtml,
				);
			collections[collectionId] = {
				...layout,
				name,
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

function discardDocuments(
	deps: StructuredWorkspacesDeps,
	documents: Document[],
): void {
	for (const document of documents) deps.documents.delete(document.name);
}

/** Delete the templates Maket wrote for this Workspace that its definition
 * no longer references. */
function retireReplacedTemplates(
	deps: StructuredWorkspacesDeps,
	workspace: StructuredWorkspaceDefinition,
): void {
	const referenced = templateRoles(workspace);
	for (const document of [...deps.documents.all().values()]) {
		const owner = document.meta.structuredWorkspace;
		if (
			document.meta.structuredWorkspaceGenerated !== true ||
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
	deps: StructuredWorkspacesDeps,
	materialized: MaterializedRepresentation,
): void {
	for (const document of materialized.created) {
		const preferred = materialized.preferredNames.get(document.id);
		if (
			!preferred ||
			preferred === document.name ||
			deps.documents.resolveOrLoad(preferred)
		)
			continue;
		const oldName = document.name;
		deps.documents.rename(oldName, preferred);
		deps.bus.emit("document:renamed", { oldName, docName: preferred });
	}
}

function announceCreatedTemplates(
	deps: StructuredWorkspacesDeps,
	documents: Document[],
): void {
	for (const document of documents)
		deps.bus.emit("document:created", { docName: document.name });
}

function definitionErrors(
	deps: StructuredWorkspacesDeps,
	workspace: StructuredWorkspaceDefinition,
	next: string,
): StructuredWorkspaceFinding[] {
	return diagnoseWorkspace(deps, workspace, { items: false, next }).filter(
		(finding) => finding.severity === "error",
	);
}

function checkWorkspace(
	deps: StructuredWorkspacesDeps,
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
	deps: StructuredWorkspacesDeps,
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
		if (index) {
			findings.push(
				...templatePageFindings(
					index,
					collectionDocumentStateSchema(workspace),
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
	deps: StructuredWorkspacesDeps,
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
function closeDocumentNames(
	deps: StructuredWorkspacesDeps,
	reference: string,
): string[] {
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
// Item diagnosis: reads each item's document, state and template provenance.
function itemFindings(
	deps: StructuredWorkspacesDeps,
	workspace: StructuredWorkspaceDefinition,
): StructuredWorkspaceFinding[] {
	const findings: StructuredWorkspaceFinding[] = [];
	const ref = workspace.id;
	const [firstCollectionId, firstCollection] =
		Object.entries(workspace.representationSchema.collections ?? {})[0] ?? [];
	if (workspace.items.length === 0)
		findings.push({
			severity: "hint",
			object: "item",
			path: "items",
			message: `Workspace "${workspace.name}" has no item yet.`,
			fix: "Add the first item; its data must satisfy the data schema.",
			next: `maket_structured_workspace action=add_item workspace=${ref} collection=${firstCollectionId ?? "<collection>"} binding=${Object.keys(firstCollection?.bindings ?? {})[0] ?? "<binding>"} document_name=<name> data=<json>`,
		});
	const unsynced = new Set<string>();
	for (const item of workspace.items) {
		const path = `item "${item.id}"`;
		const document = deps.documents.resolveById(item.documentId);
		const remove = `maket_structured_workspace action=delete_item workspace=${ref} item=${item.id}`;
		if (!document) {
			findings.push({
				severity: "error",
				object: "item",
				collection: item.collectionId,
				path,
				message: `Item "${item.id}" has no document.`,
				fix: "Delete the item and add it again.",
				next: remove,
			});
			continue;
		}
		const state = deps.documentStates.current(document.name);
		if (!state) {
			findings.push({
				severity: "error",
				object: "item",
				collection: item.collectionId,
				path,
				message: `Item document "${document.name}" has no state.`,
				fix: "Delete the item and add it again.",
				next: remove,
			});
			continue;
		}
		const binding =
			workspace.representationSchema.collections[item.collectionId]?.bindings[
				item.bindingId
			];
		if (!binding) continue;
		const schemas = [workspace.dataSchema];
		try {
			schemas.push(
				structuredWorkspaceBindingSchema(workspace.dataSchema, binding),
			);
		} catch {
			// The definition findings report the binding.
		}
		const seen = new Set<string>();
		for (const schema of schemas) {
			for (const issue of structuredWorkspaceItemDataIssues(
				schema,
				state.data,
			)) {
				if (seen.has(issue.message)) continue;
				seen.add(issue.message);
				findings.push({
					severity: "error",
					object: "item",
					collection: item.collectionId,
					path: `${path} ${issue.path}`,
					message: `${issue.message} (rule ${issue.rule}).`,
					fix: issue.fix,
					next: `maket_structured_workspace action=update_item workspace=${ref} item=${item.id} expected_revision=${state.revision} data=<corrected>`,
				});
			}
		}
		const template = deps.documents.resolveById(
			binding.detailTemplateDocumentId,
		);
		if (template && !pagesInSync(template, document.pages))
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
