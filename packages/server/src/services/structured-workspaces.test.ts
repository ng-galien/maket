import { describe, expect, it, vi } from "vitest";
import { createDocument } from "../types.js";
import { createBus } from "./bus.js";
import { createDocumentStates } from "./document-states.js";
import { createDocuments } from "./documents.js";
import { createSQLiteStore } from "./store.js";
import { createStructuredWorkspaces } from "./structured-workspaces.js";

const taskSchema = {
	type: "object",
	properties: {
		kind: { const: "task" },
		title: { type: "string" },
		done: { type: "boolean" },
	},
	required: ["kind", "title", "done"],
	additionalProperties: false,
};

const decisionSchema = {
	type: "object",
	properties: {
		kind: { const: "decision" },
		title: { type: "string" },
		outcome: { type: "string" },
	},
	required: ["kind", "title", "outcome"],
	additionalProperties: false,
};

const dataSchema = {
	$defs: { task: taskSchema, decision: decisionSchema },
	oneOf: [{ $ref: "#/$defs/task" }, { $ref: "#/$defs/decision" }],
};

function fixture() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const template = createDocument({
		name: "Task template",
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
		pages: [
			{
				name: "Task",
				elements: [],
				html: '<h1 data-id="title">{{ state.title }}</h1>',
			},
		],
	});
	const collectionTemplate = createDocument({
		name: "Collection template",
		canvas: template.canvas,
		pages: [
			{
				name: "Collection",
				elements: [],
				html: '<main data-id="collection"><section data-maket-structured-items="task"></section></main>',
			},
		],
	});
	for (const document of [template, collectionTemplate]) {
		documents.all().set(document.name, document);
		documents.persist(document.name);
	}
	const documentStates = createDocumentStates({ store, documents, bus });
	const workspaces = createStructuredWorkspaces({
		store,
		documents,
		documentStates,
		bus,
	});
	const workspace = workspaces.create({
		name: "Delivery",
		dataSchema,
		representationSchema: {
			version: 1,
			collections: {
				backlog: {
					name: "Backlog",
					collectionTemplateDocumentId: collectionTemplate.name,
					bindings: {
						task: {
							schemaPath: "/$defs/task",
							detailTemplateDocumentId: template.name,
						},
					},
				},
			},
		},
	});
	return {
		store,
		bus,
		documents,
		documentStates,
		workspaces,
		template,
		collectionTemplate,
		workspace,
	};
}

function addTask(workspaces: ReturnType<typeof createStructuredWorkspaces>) {
	return workspaces.addItem({
		workspace: "Delivery",
		itemId: "task-1",
		collectionId: "backlog",
		bindingId: "task",
		documentName: "Ship the release",
		data: { kind: "task", title: "Ship", done: false },
	});
}

describe("StructuredWorkspaces", () => {
	it("persists normalized template references and instantiates a real state document", () => {
		const {
			store,
			documents,
			documentStates,
			workspaces,
			template,
			workspace,
		} = fixture();
		expect(
			workspace.representationSchema.collections.backlog?.bindings.task
				?.detailTemplateDocumentId,
		).toBe(template.id);
		const collectionDocument =
			workspaces.get("Delivery")?.collectionDocuments[0];
		expect(collectionDocument).toMatchObject({
			collectionId: "backlog",
			documentName: "Delivery — Backlog",
		});
		expect(
			documents.resolve(collectionDocument?.documentName ?? ""),
		).toMatchObject({
			dataModel: "state",
			meta: {
				structuredWorkspace: {
					role: "collection",
					workspaceId: workspace.id,
					collectionId: "backlog",
				},
			},
		});
		expect(
			documentStates.get(collectionDocument?.documentName ?? "")?.current,
		).toMatchObject({ revision: 1, data: { items: [] } });

		const item = addTask(workspaces);
		const document = documents.resolve(item.documentName);
		expect(document).toMatchObject({
			name: "Ship the release",
			category: "Structured Workspaces/Delivery",
			dataModel: "state",
			meta: {
				structuredWorkspace: {
					workspaceId: workspace.id,
					collectionId: "backlog",
					itemId: "task-1",
					bindingId: "task",
				},
			},
		});
		expect(document?.pages[0]?.provenance).toEqual({
			kind: "template",
			workspaceId: workspace.id,
			templateDocumentId: template.id,
			templatePageId: template.pages[0]?.id,
		});
		expect(documentStates.get(item.documentName)?.current).toMatchObject({
			revision: 1,
			schema: taskSchema,
			data: { kind: "task", title: "Ship", done: false },
		});
		expect(store.loadStructuredWorkspace("Delivery")?.items).toEqual([
			expect.objectContaining({
				id: "task-1",
				collectionId: "backlog",
				bindingId: "task",
				documentId: document?.id,
			}),
		]);
		store.close();
	});

	it("validates an item against both the workspace union and its concrete binding", () => {
		const { store, workspaces } = fixture();
		expect(() =>
			workspaces.addItem({
				workspace: "Delivery",
				collectionId: "backlog",
				bindingId: "task",
				documentName: "Wrong binding",
				data: { kind: "decision", title: "Choose", outcome: "Go" },
			}),
		).toThrow(/Invalid item data/);
		expect(workspaces.get("Delivery")?.items).toEqual([]);
		store.close();
	});

	it("composes a collection page from item data and its compact template", () => {
		const { store, documents, workspaces, template, workspace } = fixture();
		const board = createDocument({
			name: "Delivery board",
			canvas: template.canvas,
			pages: [
				{
					name: "Board",
					elements: [],
					html: '<main data-id="board"><section data-maket-structured-items="task"></section></main>',
				},
			],
		});
		const compact = createDocument({
			name: "Task compact",
			canvas: template.canvas,
			pages: [
				{
					name: "Card",
					elements: [],
					html: '<article data-id="compact" data-maket-compact-root><h2 data-id="title">{{ state.title }}</h2><button data-id="open" type="button" data-maket-action="open-document">Open</button></article>',
				},
			],
		});
		for (const document of [board, compact]) {
			documents.all().set(document.name, document);
			documents.persist(document.name);
		}
		workspaces.updateDefinition({
			workspace: workspace.name,
			expectedRevision: 1,
			representationSchema: {
				version: 1,
				collections: {
					backlog: {
						name: "Backlog",
						collectionTemplateDocumentId: board.name,
						bindings: {
							task: {
								schemaPath: "/$defs/task",
								compactTemplateDocumentId: compact.name,
								detailTemplateDocumentId: template.name,
							},
						},
					},
				},
			},
		});
		const item = addTask(workspaces);

		const rendered = workspaces.renderCollection(workspace.id, "backlog");
		expect(rendered.name).toBe("Delivery — Backlog");
		expect(rendered.meta.structuredWorkspace).toEqual({
			role: "collection",
			workspaceId: workspace.id,
			collectionId: "backlog",
		});
		expect(rendered.pages[0]?.html).toContain("Ship");
		expect(rendered.pages[0]?.html).toContain(
			`data-maket-document="${item.documentName}"`,
		);
		expect(rendered.pages[0]?.html).toContain(
			'data-maket-action="open-document"',
		);
		expect(rendered.pages[0]?.html).not.toContain("{{ state.title }}");
		store.close();
	});

	it("updates item data with optimistic revisions", () => {
		const { store, documentStates, workspaces } = fixture();
		addTask(workspaces);
		const collectionDocument =
			workspaces.get("Delivery")?.collectionDocuments[0]?.documentName;
		expect(documentStates.get(collectionDocument ?? "")?.current).toMatchObject(
			{
				revision: 2,
				data: { items: [{ kind: "task", title: "Ship", done: false }] },
			},
		);
		expect(
			workspaces.updateItem("Delivery", "task-1", 1, {
				kind: "task",
				title: "Ship now",
				done: true,
			}),
		).toMatchObject({
			dataRevision: 2,
			data: { kind: "task", title: "Ship now", done: true },
		});
		expect(documentStates.get(collectionDocument ?? "")?.current).toMatchObject(
			{
				revision: 3,
				data: { items: [{ kind: "task", title: "Ship now", done: true }] },
			},
		);
		expect(() =>
			workspaces.updateItem("Delivery", "task-1", 1, {
				kind: "task",
				title: "Stale",
				done: false,
			}),
		).toThrow(/expected 1, current 2/);
		store.close();
	});

	it("cascades generic live-document updates into the collection state", () => {
		const { store, bus, documentStates, workspaces, workspace } = fixture();
		const item = addTask(workspaces);
		const collectionDocument =
			workspaces.get("Delivery")?.collectionDocuments[0]?.documentName;
		const changed = vi.fn();
		const itemChanged = vi.fn();
		bus.on("structured-workspace:changed", changed);
		bus.on("structured-workspace:item-changed", itemChanged);

		documentStates.update(item.documentName, 1, {
			kind: "task",
			title: "Ship from live controls",
			done: true,
		});

		expect(documentStates.get(collectionDocument ?? "")?.current).toMatchObject(
			{
				revision: 3,
				data: {
					items: [
						{ kind: "task", title: "Ship from live controls", done: true },
					],
				},
			},
		);
		expect(itemChanged).toHaveBeenCalledWith({
			workspaceId: workspace.id,
			itemId: "task-1",
		});
		expect(changed).not.toHaveBeenCalled();
		expect(workspaces.getItem(workspace.id, "task-1")).toMatchObject({
			dataRevision: 2,
			data: { title: "Ship from live controls" },
		});
		store.close();
	});

	it("rebuilds a drifted collection projection and announces the whole Workspace", () => {
		const { store, bus, documentStates, workspaces, workspace } = fixture();
		const item = addTask(workspaces);
		const collectionDocument =
			workspaces.get("Delivery")?.collectionDocuments[0];
		if (!collectionDocument) throw new Error("Collection projection missing.");
		const projection = documentStates.get(collectionDocument.documentName);
		store.appendDocumentStateRevision(
			collectionDocument.documentId,
			projection?.current.revision ?? 0,
			{ items: [] },
		);
		const changed = vi.fn();
		const itemChanged = vi.fn();
		bus.on("structured-workspace:changed", changed);
		bus.on("structured-workspace:item-changed", itemChanged);

		documentStates.update(item.documentName, 1, {
			kind: "task",
			title: "Ship after drift",
			done: false,
		});

		expect(
			documentStates.get(collectionDocument.documentName)?.current.data,
		).toEqual({
			items: [{ kind: "task", title: "Ship after drift", done: false }],
		});
		expect(changed).toHaveBeenCalledWith({ workspaceId: workspace.id });
		expect(itemChanged).not.toHaveBeenCalled();
		store.close();
	});

	it("updates schemas and template bindings with workspace revision control", () => {
		const { store, documents, documentStates, workspaces, collectionTemplate } =
			fixture();
		const item = addTask(workspaces);
		const alternate = createDocument({
			name: "Alternate task template",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					name: "Alternate",
					elements: [],
					html: "<h2>Alternate {{ state.title }}</h2>",
				},
			],
		});
		documents.all().set(alternate.name, alternate);
		documents.persist(alternate.name);

		const represented = workspaces.updateDefinition({
			workspace: "Delivery",
			expectedRevision: 1,
			representationSchema: {
				version: 1,
				collections: {
					backlog: {
						name: "Backlog",
						collectionTemplateDocumentId: collectionTemplate.name,
						bindings: {
							task: {
								schemaPath: "/$defs/task",
								detailTemplateDocumentId: alternate.name,
							},
						},
					},
				},
			},
		});
		expect(represented.revision).toBe(2);
		expect(documents.resolve(item.documentName)?.pages[0]?.html).toContain(
			"Alternate",
		);
		expect(documentStates.get(item.documentName)?.current.revision).toBe(1);

		const expandedTaskSchema = {
			...taskSchema,
			properties: {
				...taskSchema.properties,
				priority: { type: "number" },
			},
		};
		const schemaUpdated = workspaces.updateDefinition({
			workspace: "Delivery",
			expectedRevision: 2,
			dataSchema: {
				$defs: { task: expandedTaskSchema, decision: decisionSchema },
				oneOf: [{ $ref: "#/$defs/task" }, { $ref: "#/$defs/decision" }],
			},
		});
		expect(schemaUpdated.revision).toBe(3);
		expect(documentStates.get(item.documentName)?.current).toMatchObject({
			revision: 2,
			schema: expandedTaskSchema,
		});
		expect(() =>
			workspaces.updateDefinition({
				workspace: "Delivery",
				expectedRevision: 2,
				representationSchema: represented.representationSchema,
			}),
		).toThrow(/expected 2, current 3/);
		store.close();
	});

	it("rejects removing a binding that is still used by an item", () => {
		const { store, workspaces } = fixture();
		addTask(workspaces);
		expect(() =>
			workspaces.updateDefinition({
				workspace: "Delivery",
				expectedRevision: 1,
				representationSchema: {
					version: 1,
					collections: {
						backlog: {
							name: "Backlog",
							collectionTemplateDocumentId: "Collection template",
							bindings: {
								other: {
									schemaPath: "/$defs/decision",
									detailTemplateDocumentId: "Task template",
								},
							},
						},
					},
				},
			}),
		).toThrow(/binding "backlog\.task" is required by item "task-1"/);
		expect(workspaces.get("Delivery")?.revision).toBe(1);
		store.close();
	});

	it("synchronizes template pages and preserves instance-owned pages", () => {
		const {
			store,
			bus,
			documents,
			workspaces,
			template,
			collectionTemplate,
			workspace,
		} = fixture();
		const loaded = vi.fn();
		bus.on("document:loaded", loaded);
		const item = addTask(workspaces);
		const document = documents.resolve(item.documentName);
		if (!document) throw new Error("Instantiated document missing.");
		const collectionDocumentName =
			workspaces.get("Delivery")?.collectionDocuments[0]?.documentName;
		const collectionDocument = collectionDocumentName
			? documents.resolve(collectionDocumentName)
			: null;
		if (!collectionDocument)
			throw new Error("Instantiated collection document missing.");
		const originalTemplatePageId = document.pages[0]?.id;
		document.pages.push({
			id: "local-page",
			name: "Notes",
			elements: [],
			html: "<p>Local notes</p>",
			provenance: { kind: "instance", workspaceId: workspace.id },
		});
		documents.persist(document.name);
		collectionDocument.pages.push({
			id: "collection-local-page",
			name: "Collection notes",
			elements: [],
			html: "<p>Collection notes</p>",
			provenance: { kind: "instance", workspaceId: workspace.id },
		});
		documents.persist(collectionDocument.name);

		if (!template.pages[0]) throw new Error("Template page missing.");
		template.pages[0].html = '<h1 data-id="title">Task: {{ state.title }}</h1>';
		template.pages.push({
			id: "template-page-2",
			name: "Status",
			elements: [],
			html: "<p>{{ state.done }}</p>",
		});
		documents.persist(template.name);
		if (!collectionTemplate.pages[0])
			throw new Error("Collection template page missing.");
		collectionTemplate.pages[0].html =
			'<main data-id="collection-updated"><section data-maket-structured-items="task"></section></main>';
		collectionTemplate.pages.push({
			id: "collection-template-page-2",
			name: "Summary",
			elements: [],
			html: "<p>Collection summary</p>",
		});
		documents.persist(collectionTemplate.name);

		expect(workspaces.syncTemplates("Delivery")).toBe(2);
		expect(document.pages).toHaveLength(3);
		expect(document.pages[0]).toMatchObject({
			id: originalTemplatePageId,
			html: '<h1 data-id="title">Task: {{ state.title }}</h1>',
			provenance: { kind: "template" },
		});
		expect(document.pages[1]).toMatchObject({
			name: "Status",
			provenance: { kind: "template", templatePageId: "template-page-2" },
		});
		expect(document.pages[2]).toMatchObject({
			id: "local-page",
			html: "<p>Local notes</p>",
			provenance: { kind: "instance" },
		});
		expect(collectionDocument.pages).toHaveLength(3);
		expect(collectionDocument.pages[0]).toMatchObject({
			html: '<main data-id="collection-updated"><section data-maket-structured-items="task"></section></main>',
			provenance: { kind: "template" },
		});
		expect(collectionDocument.pages[2]).toMatchObject({
			id: "collection-local-page",
			html: "<p>Collection notes</p>",
			provenance: { kind: "instance" },
		});
		expect(loaded).toHaveBeenCalledWith({ docName: document.name });
		store.close();
	});

	it("rejects an incompatible template update without changing the instance", () => {
		const { store, documents, workspaces, template } = fixture();
		const item = addTask(workspaces);
		const document = documents.resolve(item.documentName);
		if (!document || !template.pages[0]) throw new Error("Fixture incomplete.");
		const previous = structuredClone(document.pages);
		template.pages[0].html =
			'<input type="text" data-maket-bind="state.missing">';
		documents.persist(template.name);

		expect(() => workspaces.syncTemplates("Delivery")).toThrow(/not declared/);
		expect(document.pages).toEqual(previous);
		expect(store.loadOne(document.name)?.pages).toEqual(previous);
		store.close();
	});

	it("deletes the item and its instantiated document together", () => {
		const { store, documents, documentStates, workspaces } = fixture();
		const item = addTask(workspaces);
		const collectionDocument =
			workspaces.get("Delivery")?.collectionDocuments[0]?.documentName;
		expect(workspaces.deleteItem("Delivery", "task-1")).toBe(true);
		expect(documents.resolve(item.documentName)).toBeNull();
		expect(workspaces.get("Delivery")?.items).toEqual([]);
		expect(documentStates.get(collectionDocument ?? "")?.current).toMatchObject(
			{
				revision: 3,
				data: { items: [] },
			},
		);
		store.close();
	});

	it("keeps incomplete Workspaces visible while withholding projections", () => {
		const { store, documents, documentStates, bus } = fixture();
		const workspaces = createStructuredWorkspaces({
			store,
			documents,
			documentStates,
			bus,
		});
		const incomplete = workspaces.create({
			name: "Needs templates",
			dataSchema: {},
			representationSchema: {
				version: 1,
				collections: {
					missing: {
						name: "Missing",
						collectionTemplateDocumentId: "missing-collection",
						bindings: {
							item: {
								schemaPath: "",
								detailTemplateDocumentId: "missing-detail",
							},
						},
					},
				},
			},
		});

		const view = workspaces.get(incomplete.id);
		expect(view?.integrity).toMatchObject({ status: "incomplete" });
		expect(view?.integrity.issues).toEqual(
			expect.arrayContaining([
				'Template document "missing-collection" was not found.',
				'Template document "missing-detail" was not found.',
			]),
		);
		expect(view?.collectionDocuments).toEqual([]);
		expect(workspaces.list().map((workspace) => workspace.id)).toContain(
			incomplete.id,
		);
		expect(() =>
			workspaces.addItem({
				workspace: incomplete.id,
				collectionId: "missing",
				bindingId: "item",
				documentName: "Blocked projection",
				data: {},
			}),
		).toThrow(/is incomplete/);
		store.close();
	});

	it("renames by stable identity without regenerating documents", () => {
		const { store, documents, documentStates, workspaces, workspace } =
			fixture();
		const item = addTask(workspaces);
		const itemDocument = documents.resolve(item.documentName);
		const collection = workspaces.get(workspace.id)?.collectionDocuments[0];
		if (!itemDocument || !collection) throw new Error("Fixture incomplete.");
		const collectionDocument = documents.resolve(collection.documentName);
		if (!collectionDocument) throw new Error("Collection document missing.");
		const itemPageIds = itemDocument.pages.map((page) => page.id);
		const itemHistory = documentStates.history(item.documentName);
		store.saveAnnotation({
			id: "collection-note",
			docName: collectionDocument.name,
			type: "note",
			text: "Keep",
			ts: 1,
		});

		const renamed = workspaces.rename(workspace.id, "Operations", 1);

		expect(renamed).toMatchObject({
			id: workspace.id,
			name: "Operations",
			revision: 2,
		});
		expect(documents.resolve(item.documentName)).toMatchObject({
			id: itemDocument.id,
			name: "Ship the release",
			category: "Structured Workspaces/Operations",
		});
		expect(itemDocument.pages.map((page) => page.id)).toEqual(itemPageIds);
		expect(documentStates.history(item.documentName)).toEqual(itemHistory);
		expect(collectionDocument.id).toBe(collection.documentId);
		expect(collectionDocument.name).toBe("Operations — Backlog");
		expect(collectionDocument.category).toBe(
			"Structured Workspaces/Operations",
		);
		expect(store.loadAnnotations()).toEqual([
			expect.objectContaining({
				id: "collection-note",
				docName: "Operations — Backlog",
			}),
		]);
		expect(workspaces.get("Delivery")).toBeNull();
		expect(workspaces.get(workspace.id)?.name).toBe("Operations");
		store.close();
	});

	it("deletes the aggregate cascade without touching global resources", () => {
		const { store, documents, workspaces, workspace, template } = fixture();
		const item = addTask(workspaces);
		const itemDocumentId = documents.resolve(item.documentName)?.id;
		const collection = workspaces.get(workspace.id)?.collectionDocuments[0];
		if (!collection) throw new Error("Collection document missing.");
		const free = createDocument({ name: "Free", canvas: template.canvas });
		store.saveCharte({ name: "Global brand", tokens: {} });
		documents.all().set(free.name, free);
		documents.persist(free.name);
		store.saveAnnotation({
			id: "owned-note",
			docName: item.documentName,
			type: "note",
			text: "Remove me",
			ts: 1,
		});
		store.saveAnnotation({
			id: "template-note",
			docName: template.name,
			type: "note",
			text: "Remove template note",
			ts: 2,
		});
		store.saveAnnotation({
			id: "collection-note",
			docName: collection.documentName,
			type: "note",
			text: "Remove collection note",
			ts: 3,
		});
		store.saveAnnotation({
			id: "free-note",
			docName: free.name,
			type: "note",
			text: "Keep me",
			ts: 4,
		});

		const deleted = workspaces.delete(workspace.id);

		expect(deleted).toEqual(
			expect.arrayContaining([
				template.name,
				item.documentName,
				collection.documentName,
			]),
		);
		expect(workspaces.get(workspace.id)).toBeNull();
		expect(documents.resolve(template.name)).toBeNull();
		expect(documents.resolve(item.documentName)).toBeNull();
		expect(
			itemDocumentId ? store.loadDocumentState(itemDocumentId) : null,
		).toBeNull();
		expect(store.loadAnnotations()).toEqual([
			expect.objectContaining({ id: "free-note", docName: free.name }),
		]);
		expect(documents.resolve(free.name)).toMatchObject({ id: free.id });
		expect(store.loadCharte("Global brand")).toEqual({
			name: "Global brand",
			tokens: {},
		});
		store.close();
	});

	it("rejects rename collisions without partially moving the aggregate", () => {
		const { store, documents, workspaces, workspace, template } = fixture();
		const collision = createDocument({
			name: "Operations — Backlog",
			canvas: template.canvas,
		});
		documents.all().set(collision.name, collision);
		documents.persist(collision.name);

		expect(() => workspaces.rename(workspace.id, "Operations", 1)).toThrow(
			'Document "Operations — Backlog" already exists.',
		);
		expect(workspaces.get(workspace.id)).toMatchObject({
			name: "Delivery",
			revision: 1,
		});
		expect(
			workspaces.get(workspace.id)?.collectionDocuments[0]?.documentName,
		).toBe("Delivery — Backlog");
		store.close();
	});
});
