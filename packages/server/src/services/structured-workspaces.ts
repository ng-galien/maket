import crypto from "node:crypto";
import type {
	StructuredWorkspaceCollectionDocumentView,
	StructuredWorkspaceDataSchema,
	StructuredWorkspaceDefinition,
	StructuredWorkspaceItemView,
	StructuredWorkspaceRepresentationSchema,
	StructuredWorkspaceView,
} from "@maket/shared";
import {
	renderDocumentStatePage,
	structuredWorkspaceBindingSchema,
	validateStructuredWorkspaceDefinition,
	validateStructuredWorkspaceItemData,
} from "@maket/shared";
import { parseHTML } from "linkedom";
import { createDocument, type Document, type Page } from "../types.js";
import type { Bus } from "./bus.js";
import type { DocumentStates } from "./document-states.js";
import type { Documents } from "./documents.js";
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
}

export interface StructuredWorkspacesDeps {
	bus: Bus;
	documents: Documents;
	documentStates: DocumentStates;
	store: StructuredWorkspaceRepository;
}

export function createStructuredWorkspaces(
	deps: StructuredWorkspacesDeps,
): StructuredWorkspaces {
	deps.bus.on("document-state:changed", ({ docName }) => {
		reconcileItemDocumentState(deps, docName);
	});
	return {
		list() {
			const workspaces = deps.store.loadAllStructuredWorkspaces();
			for (const workspace of workspaces) {
				ensureCollectionDocuments(deps, workspace);
			}
			return workspaces;
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
	};
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
	requiredCollection(workspace, collectionId);
	const collectionDocument = requiredCollectionDocument(
		deps,
		workspace,
		collectionId,
	);
	const items = workspace.items
		.filter((item) => item.collectionId === collectionId)
		.map((item) => itemView(deps, item));
	const collectionState = deps.documentStates.get(collectionDocument.name);
	if (!collectionState) {
		throw new Error(
			`Collection document "${collectionDocument.name}" has no live state.`,
		);
	}
	return {
		...structuredClone(collectionDocument),
		pages: collectionDocument.pages.map((page) => ({
			...structuredClone(page),
			html:
				page.html || page.jsonForms
					? renderCollectionPage(
							deps,
							workspace,
							collectionId,
							renderDocumentStatePage(page, collectionState.current.data, {
								schema: collectionState.current.schema,
							}).html,
							items,
						)
					: page.html,
		})),
	};
}

function renderCollectionPage(
	deps: StructuredWorkspacesDeps,
	workspace: StructuredWorkspaceDefinition,
	collectionId: string,
	html: string,
	items: StructuredWorkspaceItemView[],
): string {
	const collection = requiredCollection(workspace, collectionId);
	const { document } = parseHTML(`<html><body>${html}</body></html>`);
	const slots = document.body.querySelectorAll<HTMLElement>(
		"[data-maket-structured-items]",
	);
	for (const [slotIndex, slot] of [...slots].entries()) {
		const bindingId = slot.getAttribute("data-maket-structured-items") ?? "";
		const filter = parseItemFilter(
			slot.getAttribute("data-maket-structured-filter"),
		);
		slot.replaceChildren();
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
			for (const [pageIndex, page] of compact.pages.entries()) {
				if (!page.html && !page.jsonForms) continue;
				const card = renderCompactCard(
					document,
					page,
					item,
					schema,
					`${slotIndex}-${pageIndex}`,
				);
				slot.appendChild(card);
			}
		}
	}
	return document.body.innerHTML;
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
	const dataSchema = input.dataSchema ?? workspace.dataSchema;
	const representationSchema = input.representationSchema
		? normalizeTemplateDocuments(deps.documents, input.representationSchema)
		: workspace.representationSchema;
	const issues = validateStructuredWorkspaceDefinition(
		dataSchema,
		representationSchema,
	);
	if (issues.length > 0) throw new Error(issues.join("\n"));
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
		workspace.name,
		input.expectedRevision,
		dataSchema,
		representationSchema,
	);
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
	const representationSchema = normalizeTemplateDocuments(
		deps.documents,
		input.representationSchema,
	);
	const issues = validateStructuredWorkspaceDefinition(
		input.dataSchema,
		representationSchema,
	);
	if (issues.length > 0) throw new Error(issues.join("\n"));
	const workspace = deps.store.createStructuredWorkspace({
		id: crypto.randomUUID(),
		...input,
		representationSchema,
	});
	ensureCollectionDocuments(deps, workspace);
	return workspace;
}

function addItem(
	deps: StructuredWorkspacesDeps,
	input: AddStructuredWorkspaceItemInput,
): StructuredWorkspaceItemView {
	const workspace = requiredWorkspace(deps.store, input.workspace);
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
	const workspace = requiredWorkspace(deps.store, workspaceName);
	const item = requiredItem(workspace, itemId);
	assertValidItemData(workspace.dataSchema, data);
	const document = requiredDocument(
		deps.documents,
		item.documentId,
		"instantiated document",
	);
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
	if (!document || !ownership || ownership.role === "collection") return;
	const workspace = deps.store
		.loadAllStructuredWorkspaces()
		.find((candidate) => candidate.id === ownership.workspaceId);
	if (!workspace) return;
	const item = workspace.items.find(
		(candidate) =>
			candidate.id === ownership.itemId && candidate.documentId === document.id,
	);
	if (!item) return;
	refreshCollectionDocumentState(deps, workspace, item.collectionId);
	deps.bus.emit("structured-workspace:changed", {
		workspaceId: workspace.id,
	});
}

function deleteItem(
	deps: StructuredWorkspacesDeps,
	workspaceName: string,
	itemId: string,
): boolean {
	const workspace = requiredWorkspace(deps.store, workspaceName);
	const item = requiredItem(workspace, itemId);
	const document = requiredDocument(
		deps.documents,
		item.documentId,
		"instantiated document",
	);
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
	const workspace = requiredWorkspace(deps.store, workspaceName);
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
	return {
		...workspace,
		items: workspace.items.map((item) => itemView(deps, item)),
		collectionDocuments: ensureCollectionDocuments(deps, workspace),
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

function normalizeTemplateDocuments(
	documents: Documents,
	representation: StructuredWorkspaceRepresentationSchema,
): StructuredWorkspaceRepresentationSchema {
	const normalized = structuredClone(representation);
	for (const collection of Object.values(normalized.collections)) {
		collection.collectionTemplateDocumentId = resolveTemplateDocument(
			documents,
			collection.collectionTemplateDocumentId,
		).id;
		for (const binding of Object.values(collection.bindings)) {
			binding.detailTemplateDocumentId = resolveTemplateDocument(
				documents,
				binding.detailTemplateDocumentId,
			).id;
			if (binding.compactTemplateDocumentId) {
				binding.compactTemplateDocumentId = resolveTemplateDocument(
					documents,
					binding.compactTemplateDocumentId,
				).id;
			}
		}
	}
	return normalized;
}

function resolveTemplateDocument(
	documents: Documents,
	reference: string,
): Document {
	const document =
		documents.resolveById(reference) ?? documents.resolveOrLoad(reference);
	if (!document) {
		throw new Error(
			`Structured Workspace representation template "${reference}" not found.`,
		);
	}
	return document;
}

function requiredWorkspace(
	store: StructuredWorkspaceRepository,
	name: string,
): StructuredWorkspaceDefinition {
	const workspace = store.loadStructuredWorkspace(name);
	if (!workspace) throw new Error(`Structured Workspace "${name}" not found.`);
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
