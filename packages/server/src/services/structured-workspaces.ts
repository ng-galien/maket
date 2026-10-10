import crypto from "node:crypto";
import type {
	BundleStructuredWorkspaceSnapshot,
	StructuredWorkspaceCollectionDocumentView,
	StructuredWorkspaceCollectionRepresentation,
	StructuredWorkspaceDataSchema,
	StructuredWorkspaceDefinition,
	StructuredWorkspaceGroupValue,
	StructuredWorkspaceItemView,
	StructuredWorkspaceRepresentationSchema,
	StructuredWorkspaceTemplateDocumentView,
	StructuredWorkspaceView,
} from "@maket/shared";
import {
	readJsonPointer,
	renderDocumentStatePage,
	structuredWorkspaceBindingSchema,
	structuredWorkspaceDefaultPageSize,
	validateStructuredWorkspaceDefinition,
	validateStructuredWorkspaceItemData,
} from "@maket/shared";
import { parseHTML } from "linkedom";
import { MessageError } from "../lib/message-error.js";
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

export interface CreateStructuredWorkspaceInput {
	name: string;
	description?: string;
	dataSchema: StructuredWorkspaceDataSchema;
	representationSchema: StructuredWorkspaceRepresentationSchema;
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
	representationSchema?: StructuredWorkspaceRepresentationSchema;
}

export interface StructuredWorkspaces {
	list(): StructuredWorkspaceDefinition[];
	listViews(): StructuredWorkspaceView[];
	get(name: string): StructuredWorkspaceView | null;
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
			return renderCollection(deps, workspaceId, collectionId);
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
	workspaceId: string,
	collectionId: string,
): Document {
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
			{ workspace, collection, items },
			{ doc: collectionDocument, pageId: page.id },
			renderDocumentStatePage(page, collectionState.current.data, {
				schema: collectionState.current.schema,
			}).html,
		);
		for (const [index, html] of flowed.entries()) {
			pages.push({
				...structuredClone(page),
				...flowedPageIdentity(page, index),
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
	cards: HTMLElement[];
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
	cards: HTMLElement[];
}

interface CollectionPageSource {
	workspace: StructuredWorkspaceDefinition;
	collection: StructuredWorkspaceCollectionRepresentation;
	items: StructuredWorkspaceItemView[];
}

/**
 * Compose one collection template page. Each items slot is cut into pages of
 * at most `pageSize` cards when the collection is grouped; each such page then
 * flows onto as many continuation pages as its cards need once laid out.
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
	const slotPages = slots.map((slot, slotIndex) => {
		const entries = collectionCardEntries(
			deps,
			source,
			document,
			slot,
			slotIndex,
		);
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
			groupCollectionCards(
				entries,
				collection.groupBy,
				collection.groupOrder ?? [],
			),
			collection.pageSize ?? structuredWorkspaceDefaultPageSize,
		);
	});
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
			deps.pageFlow && segments.some((slot) => slot.length > 0)
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
		const cards = compact.pages.flatMap((page, pageIndex) =>
			page.html || page.jsonForms
				? [
						renderCompactCard(
							document,
							page,
							item,
							schema,
							`${slotIndex}-${pageIndex}`,
						),
					]
				: [],
		);
		entries.push({ item, cards });
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

function renderCompactCard(
	document: ReturnType<typeof parseHTML>["document"],
	page: Pick<Page, "html" | "jsonForms">,
	item: StructuredWorkspaceItemView,
	schema: StructuredWorkspaceDataSchema,
	suffix: string,
): HTMLElement {
	const prefix = `structured-${safeToken(item.id)}-${suffix}`;
	const compactRoot = renderedCompactRoot(page, item, schema);
	prefixDataIds(compactRoot, prefix);
	stripCompactBindings(compactRoot);
	linkCompactActions(compactRoot, item.documentName);
	return compactCardWrapper(document, compactRoot, item.documentName, prefix);
}

function renderedCompactRoot(
	page: Pick<Page, "html" | "jsonForms">,
	item: StructuredWorkspaceItemView,
	schema: StructuredWorkspaceDataSchema,
): HTMLElement {
	const rendered = renderDocumentStatePage(page, item.data, { schema }).html;
	const compactDom = parseHTML(
		`<html><body>${rendered}</body></html>`,
	).document;
	return (
		compactDom.body.querySelector<HTMLElement>("[data-maket-compact-root]") ??
		compactDom.body
	);
}

function stripCompactBindings(compactRoot: HTMLElement): void {
	for (const binding of compactRoot.querySelectorAll<HTMLElement>(
		"[data-maket-bind], [data-maket-path], [data-maket-type]",
	)) {
		binding.removeAttribute("data-maket-bind");
		binding.removeAttribute("data-maket-path");
		binding.removeAttribute("data-maket-type");
	}
}

function linkCompactActions(
	compactRoot: HTMLElement,
	documentName: string,
): void {
	for (const action of compactRoot.querySelectorAll<HTMLElement>(
		'[data-maket-action="open-document"]',
	)) {
		action.setAttribute("data-maket-document", documentName);
	}
}

function compactCardWrapper(
	document: ReturnType<typeof parseHTML>["document"],
	compactRoot: HTMLElement,
	documentName: string,
	prefix: string,
): HTMLElement {
	const wrapper = document.createElement("article");
	wrapper.setAttribute("data-id", `${prefix}-card`);
	wrapper.setAttribute("data-maket-action", "open-document");
	wrapper.setAttribute("data-maket-document", documentName);
	wrapper.setAttribute("role", "button");
	wrapper.setAttribute("tabindex", "0");
	wrapper.setAttribute("style", "cursor:pointer");
	wrapper.innerHTML = compactRoot.outerHTML;
	return wrapper;
}

function prefixDataIds(root: HTMLElement, prefix: string): void {
	const elements = [root, ...root.querySelectorAll<HTMLElement>("[data-id]")];
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
	const representationSchema = input.representationSchema
		? normalizeTemplateDocumentReferences(
				deps.documents,
				input.representationSchema,
			)
		: workspace.representationSchema;
	assertTemplatesUnlocked(deps.documents, representationSchema);
	const issues = validateStructuredWorkspaceDefinition(
		dataSchema,
		representationSchema,
	);
	if (issues.length > 0) {
		const updated = deps.store.updateStructuredWorkspace(
			workspace.id,
			input.expectedRevision,
			dataSchema,
			representationSchema,
		);
		reconcileTemplateOwnership(deps, updated);
		return workspaceView(deps, updated);
	}
	const candidate = { ...workspace, dataSchema, representationSchema };
	if (workspaceIntegrity(deps, candidate).status === "incomplete") {
		const updated = deps.store.updateStructuredWorkspace(
			workspace.id,
			input.expectedRevision,
			dataSchema,
			representationSchema,
		);
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
	const representationSchema = normalizeTemplateDocumentReferences(
		deps.documents,
		input.representationSchema,
	);
	assertTemplatesUnlocked(deps.documents, representationSchema);
	const workspace = deps.store.createStructuredWorkspace({
		id: crypto.randomUUID(),
		...input,
		representationSchema,
	});
	reconcileTemplateOwnership(deps, workspace);
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
	deps.documentStates.patch(
		collectionDocument.name,
		collectionState.current.revision,
		[
			{
				op: "replace",
				path: `/items/${index}`,
				value: structuredClone(itemState.current.data),
			},
		],
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
			...structuredClone(template.meta),
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
): Record<string, unknown> {
	return {
		items: workspace.items
			.filter((item) => item.collectionId === collectionId)
			.sort((left, right) => left.position - right.position)
			.map((item) => structuredClone(itemView(deps, item).data)),
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
	const state = deps.documentStates.get(document.name);
	if (!state) throw new Error(`Document "${document.name}" has no item data.`);
	return {
		...item,
		documentName: document.name,
		data: state.current.data,
		dataRevision: state.current.revision,
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
			...structuredClone(template.meta),
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
		document.meta.structuredWorkspace = {
			role: "template",
			workspaceId: workspace.id,
			templateRoles: roles,
		};
		document.category = `Structured Workspaces/${workspace.name}`;
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
		if (!deps.documentStates.get(document.name)) {
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
				const data = collectionDocumentStateData(deps, workspace, collectionId);
				for (const page of [
					...template.pages,
					...(document !== template ? document.pages : []),
				])
					renderDocumentStatePage(page, data, { schema });
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
	const issues = validateStructuredWorkspaceItemData(schema, data);
	if (issues.length > 0) throw new Error(issues.join("\n"));
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
