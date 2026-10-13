import type { CallToolResult } from "@modelcontextprotocol/server";
import { asValue } from "awilix";
import { describe, expect, it } from "vitest";
import { createAppContainer } from "../bootstrap.js";
import {
	STRUCTURED_WORKSPACE_FAILURES,
	STRUCTURED_WORKSPACE_METHOD,
} from "../lib/learn-content.js";
import { registerServerEvents } from "../server-events.js";
import { type Bus, createBus } from "../services/bus.js";
import { createConfig } from "../services/config.js";
import { createDocumentStates } from "../services/document-states.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore, type Store } from "../services/store.js";
import { createStructuredWorkspaces } from "../services/structured-workspaces.js";
import { createDocument } from "../types.js";
import { text } from "./_helpers.js";
import { createMaketDocTool, type DocumentsDeps } from "./documents.js";
import {
	createMaketStructuredWorkspaceTool,
	structuredWorkspacesPack,
} from "./structured-workspaces.js";

function textOf(result: CallToolResult): string {
	return result.content
		.filter(
			(item): item is Extract<typeof item, { type: "text" }> =>
				item.type === "text",
		)
		.map((item) => item.text)
		.join("\n");
}

describe("maket_structured_workspace", () => {
	it("reports incompatible collection templates as incomplete and keeps listing usable", async () => {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const documents = createDocuments({ store });
		const documentStates = createDocumentStates({ store, bus, documents });
		const structuredWorkspaces = createStructuredWorkspaces({
			store,
			bus,
			documents,
			documentStates,
		});
		const tool = createMaketStructuredWorkspaceTool({ structuredWorkspaces });
		try {
			const template = createDocument({
				name: "Incompatible template",
				canvas: {
					format: "A4",
					orientation: "portrait",
					w: 210,
					h: 297,
					bg: "#fff",
				},
				pages: [
					{
						name: "Page",
						elements: [],
						html: '<input type="text" data-maket-bind="state.missing">',
					},
				],
			});
			documents.all().set(template.name, template);
			documents.persist(template.name);
			const incompleteArgs = {
				action: "create",
				workspace: "Incomplete",
				data_schema: {
					type: "object",
					properties: { title: { type: "string" } },
				},
				representation_schema: {
					version: 1,
					collections: {
						backlog: {
							name: "Backlog",
							collectionTemplateDocumentId: template.id,
							bindings: {
								task: {
									schemaPath: "",
									detailTemplateDocumentId: template.id,
								},
							},
						},
					},
				},
			};
			const refused = await tool.handler(incompleteArgs, {} as never);
			expect(refused.isError).toBe(true);
			expect(textOf(refused)).toContain(
				'Structured Workspace "Incomplete" was not created',
			);
			expect(textOf(refused)).toContain("state.missing");
			expect(textOf(refused)).toContain("next:");
			expect(structuredWorkspaces.list()).toEqual([]);
			const result = await tool.handler(
				{ ...incompleteArgs, allow_incomplete: true },
				{} as never,
			);
			expect(result.isError).toBeUndefined();
			expect(textOf(result)).toContain("incomplete");
			const listed = await tool.handler({ action: "list" }, {} as never);
			expect(listed.isError).toBeUndefined();
			expect(textOf(listed)).toContain("- [incomplete] Incomplete (");
			expect(structuredWorkspaces.listViews()[0]?.integrity).toMatchObject({
				status: "incomplete",
				issues: expect.arrayContaining([
					expect.stringContaining("state.missing"),
				]),
			});
			expect(documents.resolveOrLoad("Incomplete — Backlog")).toBeNull();
		} finally {
			store.close();
		}
	});
	it("accepts and shows collection grouping through update_definition and view", async () => {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const documents = createDocuments({ store });
		const documentStates = createDocumentStates({ store, bus, documents });
		const structuredWorkspaces = createStructuredWorkspaces({
			store,
			bus,
			documents,
			documentStates,
		});
		const tool = createMaketStructuredWorkspaceTool({ structuredWorkspaces });
		try {
			const canvas = {
				format: "A4" as const,
				orientation: "portrait" as const,
				w: 210,
				h: 297,
				bg: "#fff",
			};
			const detail = createDocument({
				name: "Detail",
				canvas,
				pages: [
					{ name: "Page", elements: [], html: "<h1>{{ state.title }}</h1>" },
				],
			});
			const board = createDocument({
				name: "Board",
				canvas,
				pages: [
					{
						name: "Index",
						elements: [],
						html: '<section data-maket-structured-items="item"></section>',
					},
				],
			});
			for (const document of [detail, board]) {
				documents.all().set(document.name, document);
				documents.persist(document.name);
			}
			const collection = {
				name: "Items",
				collectionTemplateDocumentId: board.id,
				bindings: {
					item: { schemaPath: "", detailTemplateDocumentId: detail.id },
				},
			};
			const dataSchema = {
				type: "object",
				properties: { title: { type: "string" }, status: { type: "string" } },
			};
			await tool.handler(
				{
					action: "create",
					workspace: "Grouped",
					data_schema: dataSchema,
					representation_schema: {
						version: 1,
						collections: { items: collection },
					},
				},
				{} as never,
			);
			const updated = await tool.handler(
				{
					action: "update_definition",
					workspace: "Grouped",
					expected_workspace_revision: 1,
					representation_schema: {
						version: 1,
						collections: {
							items: {
								...collection,
								groupBy: "/status",
								groupOrder: ["live", "dormant"],
								pageSize: 12,
								sortBy: "/place",
								sortDirection: "descending",
							},
						},
					},
				},
				{} as never,
			);
			expect(updated.isError).toBeUndefined();
			const view = await tool.handler(
				{ action: "view", workspace: "Grouped" },
				{} as never,
			);
			expect(view.structuredContent).toEqual(JSON.parse(textOf(view)));
			expect(
				JSON.parse(textOf(view)).representationSchema.collections.items,
			).toMatchObject({
				groupBy: "/status",
				groupOrder: ["live", "dormant"],
				pageSize: 12,
				sortBy: "/place",
				sortDirection: "descending",
			});
			const refused = await tool.handler(
				{
					action: "update_definition",
					workspace: "Grouped",
					expected_workspace_revision: 2,
					representation_schema: {
						version: 1,
						collections: { items: { ...collection, pageSize: 1.5 } },
					},
				},
				{} as never,
			);
			expect(refused.isError).toBe(true);
			expect(textOf(refused)).toContain("pageSize");
			const refusedSort = await tool.handler(
				{
					action: "update_definition",
					workspace: "Grouped",
					expected_workspace_revision: 2,
					representation_schema: {
						version: 1,
						collections: {
							items: { ...collection, sortBy: "/place", sortDirection: "up" },
						},
					},
				},
				{} as never,
			);
			expect(refusedSort.isError).toBe(true);
			expect(textOf(refusedSort)).toContain("sortDirection");
		} finally {
			store.close();
		}
	});

	it("registers its dedicated tool pack", () => {
		expect(structuredWorkspacesPack.declaresTools).toEqual([
			"maket_structured_workspace",
		]);
		expect(structuredWorkspacesPack.requires).toEqual(["structuredWorkspaces"]);
	});

	it("creates a workspace and operates its instantiated item through MCP", async () => {
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
					html: "<h1>{{ state.title }}</h1>",
				},
			],
		});
		documents.all().set(template.name, template);
		documents.persist(template.name);
		const documentStates = createDocumentStates({ store, documents, bus });
		const structuredWorkspaces = createStructuredWorkspaces({
			store,
			documents,
			documentStates,
			bus,
		});
		const tool = createMaketStructuredWorkspaceTool({ structuredWorkspaces });
		const invalidArgs = {
			action: "create",
			workspace: "Invalid delivery",
			data_schema: {
				$defs: {
					task: {
						type: "object",
						properties: { title: { type: "string" } },
						required: ["title"],
					},
				},
			},
			representation_schema: {
				version: 1,
				collections: {
					backlog: {
						name: "Backlog",
						collectionTemplateDocumentId: "Invalid template",
						bindings: {
							"": {
								schemaPath: "/$defs/task",
								detailTemplateDocumentId: "Invalid template",
							},
						},
					},
				},
			},
		};
		const emptyBinding = await tool.handler(invalidArgs, {} as never);
		expect(emptyBinding.isError).toBe(true);
		expect(textOf(emptyBinding)).toContain(
			'Structured Workspace "Invalid delivery" was not created',
		);
		expect(textOf(emptyBinding)).toContain(
			'- collection "backlog" · representation_schema.collections.backlog.bindings.: Binding ids must not be empty.',
		);
		expect(structuredWorkspaces.get("Invalid delivery")).toBeNull();
		const kept = await tool.handler(
			{ ...invalidArgs, allow_incomplete: true },
			{} as never,
		);
		expect(kept.isError).toBeUndefined();
		expect(textOf(kept)).toContain(
			'Structured Workspace "Invalid delivery" created',
		);
		expect(textOf(kept)).toContain("Verdict: incomplete");
		expect(structuredWorkspaces.get("Invalid delivery")?.integrity).toEqual({
			status: "incomplete",
			issues: expect.arrayContaining(["Binding ids must not be empty."]),
		});

		const created = await tool.handler(
			{
				action: "create",
				workspace: "Delivery",
				data_schema: {
					$defs: {
						task: {
							type: "object",
							properties: {
								kind: { const: "task" },
								title: { type: "string" },
							},
							required: ["kind", "title"],
							additionalProperties: false,
						},
					},
					oneOf: [{ $ref: "#/$defs/task" }],
				},
				representation_schema: {
					version: 1,
					collections: {
						backlog: {
							name: "Backlog",
							collectionTemplateDocumentId: "Task template",
							bindings: {
								task: {
									schemaPath: "/$defs/task",
									detailTemplateDocumentId: "Task template",
								},
							},
						},
					},
				},
			},
			{} as never,
		);
		expect(created.isError).toBeUndefined();
		expect(textOf(created)).toContain(
			'Structured Workspace "Delivery" created',
		);

		const added = await tool.handler(
			{
				action: "add_item",
				workspace: "Delivery",
				item: "task-1",
				collection: "backlog",
				binding: "task",
				document_name: "Release task",
				data: { kind: "task", title: "Ship" },
			},
			{} as never,
		);
		expect(added.isError).toBeUndefined();
		expect(textOf(added)).toContain("data revision 1");

		const definitionUpdated = await tool.handler(
			{
				action: "update_definition",
				workspace: "Delivery",
				expected_workspace_revision: 1,
				representation_schema: {
					version: 1,
					collections: {
						backlog: {
							name: "Backlog",
							collectionTemplateDocumentId: "Task template",
							bindings: {
								task: {
									schemaPath: "/$defs/task",
									detailTemplateDocumentId: "Task template",
								},
							},
						},
					},
				},
			},
			{} as never,
		);
		expect(definitionUpdated.isError).toBeUndefined();
		expect(textOf(definitionUpdated)).toContain("revision 2");

		const updated = await tool.handler(
			{
				action: "update_item",
				workspace: "Delivery",
				item: "task-1",
				expected_revision: 1,
				data: { kind: "task", title: "Ship now" },
			},
			{} as never,
		);
		expect(updated.isError).toBeUndefined();
		expect(textOf(updated)).toContain("revision 2");

		const lockedItem = documents.resolveOrLoad("Release task");
		if (!lockedItem) throw new Error("Expected instantiated document");
		lockedItem.meta.locked = true;
		documents.persist(lockedItem.name);
		for (const args of [
			{
				action: "update_item",
				workspace: "Delivery",
				item: "task-1",
				expected_revision: 2,
				data: { kind: "task", title: "Forbidden" },
			},
			{ action: "delete_item", workspace: "Delivery", item: "task-1" },
			{ action: "delete", workspace: "Delivery" },
			{
				action: "rename",
				workspace: "Delivery",
				new_name: "Forbidden",
				expected_workspace_revision: 2,
			},
			{ action: "sync_template", workspace: "Delivery" },
			{
				action: "update_definition",
				workspace: "Delivery",
				expected_workspace_revision: 2,
				data_schema: { type: "object" },
			},
		]) {
			const rejected = await tool.handler(args, {} as never);
			expect(rejected.isError).toBe(true);
			expect(textOf(rejected)).toContain("locked");
		}
		expect(documentStates.get(lockedItem.name)?.current.data.title).toBe(
			"Ship now",
		);
		expect(store.loadOne(lockedItem.name)).not.toBeNull();
		lockedItem.meta.locked = false;
		documents.persist(lockedItem.name);
		const viewed = await tool.handler(
			{ action: "view", workspace: "Delivery" },
			{} as never,
		);
		expect(textOf(viewed)).toContain('"documentName": "Release task"');
		expect(textOf(viewed)).toContain('"title": "Ship now"');

		for (const [item, documentName] of [
			["task-2", "Second task"],
			["task-3", "Third task"],
		] as const) {
			const result = await tool.handler(
				{
					action: "add_item",
					workspace: "Delivery",
					item,
					collection: "backlog",
					binding: "task",
					document_name: documentName,
					data: { kind: "task", title: documentName },
				},
				{} as never,
			);
			expect(result.isError).toBeUndefined();
		}
		const deletedMiddle = await tool.handler(
			{
				action: "delete_item",
				workspace: "Delivery",
				item: "task-2",
			},
			{} as never,
		);
		expect(deletedMiddle.isError).toBeUndefined();
		const addedAfterDelete = await tool.handler(
			{
				action: "add_item",
				workspace: "Delivery",
				item: "task-4",
				collection: "backlog",
				binding: "task",
				document_name: "Fourth task",
				data: { kind: "task", title: "Fourth task" },
			},
			{} as never,
		);
		expect(addedAfterDelete.isError).toBeUndefined();
		const compacted = structuredWorkspaces.get("Delivery");
		expect(
			compacted?.items.map(({ id, position }) => ({ id, position })),
		).toEqual([
			{ id: "task-1", position: 0 },
			{ id: "task-3", position: 1 },
			{ id: "task-4", position: 2 },
		]);
		const renamed = await tool.handler(
			{
				action: "rename",
				workspace: compacted?.id,
				new_name: "Operations",
				expected_workspace_revision: 2,
			},
			{} as never,
		);
		expect(renamed.isError).toBeUndefined();
		expect(textOf(renamed)).toContain(
			'Workspace "Operations" renamed without regenerating',
		);
		const removed = await tool.handler(
			{ action: "delete", workspace: compacted?.id },
			{} as never,
		);
		expect(removed.isError).toBeUndefined();
		expect(textOf(removed)).toContain("owned document(s)");
		expect(structuredWorkspaces.get(compacted?.id ?? "")).toBeNull();
		store.close();
	});
});

describe("maket_structured_workspace update_item propagation", () => {
	it("writes and broadcasts only the touched item and the collection index of a 100-item workspace", async () => {
		const writes: string[] = [];
		const reads: string[] = [];
		const sqlite = createSQLiteStore(":memory:");
		const store = new Proxy(sqlite, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (typeof value !== "function" || typeof property !== "string")
					return value;
				return (...args: unknown[]) => {
					(/^(load|list|is)/.test(property) ? reads : writes).push(property);
					return value.apply(target, args);
				};
			},
		}) as Store;
		const broadcasts: Array<{
			type: string;
			doc?: string;
			bytes: number;
			message: Record<string, unknown>;
		}> = [];
		const container = createAppContainer({
			config: createConfig({
				env: { MAKET_DATA_DIR: "/nonexistent/maket-test" },
				homedir: () => "/nowhere",
			}),
			ensure: false,
			store,
			browserPool: {
				async get(): Promise<never> {
					throw new Error("Browser rendering is not used by this test");
				},
				async dispose() {},
			},
		});
		container.register({
			wsRegistry: asValue({
				broadcast(message: { type: string; docName?: string }) {
					broadcasts.push({
						type: message.type,
						doc: message.docName,
						bytes: JSON.stringify(message).length,
						message: message as Record<string, unknown>,
					});
				},
			}),
		});
		registerServerEvents({
			bus: container.resolve("bus"),
			collections: container.resolve("collections"),
			collectionCursors: container.resolve("collectionCursors"),
			documents: container.resolve("documents"),
			documentRenderer: container.resolve("documentRenderer"),
			mermaidDiagrams: container.resolve("mermaidDiagrams"),
			structuredWorkspaces: container.resolve("structuredWorkspaces"),
			wsRegistry: container.resolve("wsRegistry"),
			pending: container.resolve("pending"),
		});
		const bus = container.resolve<Bus>("bus");
		const events: string[] = [];
		const emit = bus.emit.bind(bus);
		bus.emit = (event, payload) => {
			events.push(event);
			emit(event, payload);
		};
		const documents =
			container.resolve<ReturnType<typeof createDocuments>>("documents");
		const canvas = {
			format: "A4",
			orientation: "portrait" as const,
			w: 210,
			h: 297,
			bg: "#fff",
		};
		for (const document of [
			createDocument({
				name: "Topic detail",
				canvas,
				pages: [
					{ name: "Detail", elements: [], html: "<h1>{{ state.title }}</h1>" },
				],
			}),
			createDocument({
				name: "Topic card",
				canvas,
				pages: [
					{
						name: "Card",
						elements: [],
						html: "<article data-maket-compact-root><h2>{{ state.title }}</h2><p>{{ state.status }}</p></article>",
					},
				],
			}),
			createDocument({
				name: "Topic board",
				canvas,
				pages: [
					{
						name: "Board",
						elements: [],
						html: '<main><section data-maket-structured-items="topic"></section></main>',
					},
				],
			}),
		]) {
			documents.all().set(document.name, document);
			documents.persist(document.name);
		}
		const tool = createMaketStructuredWorkspaceTool({
			structuredWorkspaces: container.resolve("structuredWorkspaces"),
		});
		const created = await tool.handler(
			{
				action: "create",
				workspace: "Graph",
				data_schema: {
					$defs: {
						topic: {
							type: "object",
							properties: {
								title: { type: "string" },
								status: { type: "string" },
							},
							required: ["title", "status"],
						},
					},
				},
				representation_schema: {
					version: 1,
					collections: {
						topics: {
							name: "Topics",
							collectionTemplateDocumentId: "Topic board",
							bindings: {
								topic: {
									schemaPath: "/$defs/topic",
									compactTemplateDocumentId: "Topic card",
									detailTemplateDocumentId: "Topic detail",
								},
							},
						},
					},
				},
			},
			{} as never,
		);
		expect(created.isError).toBeUndefined();
		for (let index = 0; index < 100; index += 1) {
			const added = await tool.handler(
				{
					action: "add_item",
					workspace: "Graph",
					item: `topic-${index}`,
					collection: "topics",
					binding: "topic",
					document_name: `Topic ${index}`,
					data: { title: `Topic ${index}`, status: "open" },
				},
				{} as never,
			);
			expect(added.isError).toBeUndefined();
		}
		writes.length = 0;
		reads.length = 0;
		events.length = 0;
		broadcasts.length = 0;

		const updated = await tool.handler(
			{
				action: "update_item",
				workspace: "Graph",
				item: "topic-30",
				expected_revision: 1,
				data: { title: "Topic 30", status: "closed" },
			},
			{} as never,
		);

		expect(textOf(updated)).toBe('Item "topic-30" updated to data revision 2.');
		expect(writes).toEqual([
			"appendDocumentStateRevision",
			"replaceCurrentDocumentStateValue",
		]);
		expect(events.sort()).toEqual([
			"document-state:changed",
			"document-state:changed",
			"structured-workspace:item-changed",
		]);
		expect(broadcasts.map(({ type, doc }) => ({ type, doc }))).toEqual([
			{ type: "state_pages", doc: "Graph — Topics" },
			{ type: "structured_workspace_item_changed", doc: undefined },
			{ type: "state_pages", doc: "Topic 30" },
		]);
		const itemBroadcast = broadcasts.find(
			({ type }) => type === "structured_workspace_item_changed",
		);
		expect(itemBroadcast?.bytes).toBeLessThan(1000);
		const documentStates =
			container.resolve<ReturnType<typeof createDocumentStates>>(
				"documentStates",
			);
		const projection = documentStates.get("Graph — Topics")?.current;
		const projected = projection?.data.items as Array<{ status: string }>;
		expect(projected).toHaveLength(100);
		expect(projected[30]?.status).toBe("closed");
		expect(projected.filter(({ status }) => status === "open")).toHaveLength(
			99,
		);
		const index = broadcasts.find(({ doc }) => doc === "Graph — Topics");
		expect(index?.message.documentState).toBeUndefined();
		expect(index?.message.documentStateEntry).toEqual({
			previousRevision: (projection?.revision ?? 0) - 1,
			revision: projection?.revision,
			createdAt: projection?.createdAt,
			pointer: "/items/30",
			value: { title: "Topic 30", status: "closed" },
		});
		const indexPages = (index?.message.pages ?? []) as Array<{
			html?: string;
		}>;
		expect(indexPages[0]?.html).toContain("closed");
		expect(index?.bytes).toBeLessThan(40_000);

		broadcasts.length = 0;
		writes.length = 0;
		const unchanged = await tool.handler(
			{
				action: "update_item",
				workspace: "Graph",
				item: "topic-31",
				expected_revision: 1,
				data: { title: "Topic 31", status: "open" },
			},
			{} as never,
		);
		expect(unchanged.isError).toBeUndefined();
		expect(writes).toEqual(["appendDocumentStateRevision"]);
		expect(
			broadcasts.filter(({ doc }) => doc === "Graph — Topics"),
		).toHaveLength(0);
		store.close();
	});
});

/** One Maket on an in-memory store with the calls the method uses. The
 * maket_html set step writes the page as that tool does, without its browser
 * layout measure. */
function methodHarness() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const documentStates = createDocumentStates({ store, bus, documents });
	const structuredWorkspaces = createStructuredWorkspaces({
		store,
		bus,
		documents,
		documentStates,
	});
	const workspaceTool = createMaketStructuredWorkspaceTool({
		structuredWorkspaces,
	});
	const docTool = createMaketDocTool({
		documents,
		bus,
		store,
	} as unknown as DocumentsDeps);
	const run = async (
		tool: string,
		args: Record<string, unknown>,
	): Promise<CallToolResult> => {
		if (tool === "maket_structured_workspace")
			return workspaceTool.handler(args, {} as never);
		if (tool === "maket_doc") return docTool.handler(args, {} as never);
		const document = documents.resolve(String(args.doc));
		const page = document?.pages[Number(args.page) - 1];
		if (!document || !page) return text("missing page", true);
		page.html = String(args.html);
		documents.persist(document.name);
		return text(`Page ${String(args.page)} of "${document.name}" set.`);
	};
	return { store, documents, structuredWorkspaces, run };
}

/** The answer text plus, for a check, every finding sentence unescaped. */
function answerOf(result: CallToolResult): string {
	const findings = (
		result.structuredContent as
			| { findings?: Array<{ message: string }> }
			| undefined
	)?.findings;
	return [
		textOf(result),
		...(Array.isArray(findings) ? findings.map((f) => f.message) : []),
	].join("\n");
}

describe("maket_structured_workspace documented method", () => {
	it.each(STRUCTURED_WORKSPACE_METHOD.map((path) => [path.title, path]))(
		"runs %s exactly as documented",
		async (_title, path) => {
			const { store, documents, structuredWorkspaces, run } = methodHarness();
			try {
				for (const step of path.steps) {
					const result = await run(step.tool, step.args);
					expect(result.isError, JSON.stringify(step.args)).toBeUndefined();
					for (const line of step.answer)
						expect(answerOf(result)).toContain(line);
				}
				const [workspace] = structuredWorkspaces.list();
				if (!workspace) throw new Error("Workspace missing.");
				expect(structuredWorkspaces.check(workspace.id).verdict).toBe("ready");
				const category = `Structured Workspaces/${workspace.name}`;
				expect(
					[...documents.all().values()].map((document) => document.category),
				).toEqual([...documents.all().values()].map(() => category));
				const [collectionId] = Object.keys(
					workspace.representationSchema.collections,
				);
				const index = structuredWorkspaces.renderCollection(
					workspace.id,
					collectionId ?? "",
				);
				expect(index.pages[0]?.html).toContain("data-maket-compact-root");
			} finally {
				store.close();
			}
		},
	);

	it("generates a detail page, a card and a form from the data schema alone", async () => {
		const { store, documents, structuredWorkspaces, run } = methodHarness();
		try {
			const [create] = STRUCTURED_WORKSPACE_METHOD[0]?.steps ?? [];
			if (!create) throw new Error("Method missing.");
			await run(create.tool, {
				...create.args,
				data_schema: {
					type: "object",
					properties: {
						title: { type: "string" },
						isbn: { type: "string", readOnly: true },
						pages: { type: "integer" },
						tags: { type: "array", items: { type: "string" } },
					},
					required: ["title"],
				},
			});
			const detail = documents.resolve(
				"Reading list — Items — detail template",
			);
			expect(detail?.pages[0]?.html).toContain(
				'<h1 data-id="detail-title">{{ state.title }}</h1>',
			);
			expect(detail?.pages[0]?.html).toContain(
				"<dt>Isbn</dt><dd>{{ state.isbn }}</dd>",
			);
			expect(detail?.pages[0]?.html).toContain("{{#state.tags}}");
			expect(detail?.pages[1]?.jsonForms).toEqual({
				uischema: {
					type: "VerticalLayout",
					elements: [
						{ type: "Control", scope: "#/properties/title" },
						{ type: "Control", scope: "#/properties/pages" },
					],
				},
			});
			const card = documents.resolve("Reading list — Items — card template");
			expect(card?.pages[0]?.html).toContain("Isbn: {{ state.isbn }}");
			expect(card?.pages[0]?.html).toContain("Pages: {{ state.pages }}");
			expect(card?.pages[0]?.html).not.toContain("state.tags");
			const added = await run("maket_structured_workspace", {
				action: "add_item",
				workspace: "Reading list",
				collection: "items",
				binding: "item",
				document_name: "Dune",
				data: { title: "Dune", isbn: "978", pages: 412, tags: ["sf"] },
			});
			expect(added.isError).toBeUndefined();
			expect(documents.resolve("Dune")?.pages).toHaveLength(2);
			expect(structuredWorkspaces.check("Reading list").verdict).toBe("ready");
		} finally {
			store.close();
		}
	});

	it.each(
		STRUCTURED_WORKSPACE_FAILURES.map((failure) => [failure.title, failure]),
	)("shows the documented answer when %s", async (_title, failure) => {
		const { store, documents, structuredWorkspaces, run } = methodHarness();
		try {
			let last: CallToolResult | null = null;
			for (const step of failure.steps) {
				if ("manual" in step) {
					const document = documents.resolve(step.document);
					const page = document?.pages[0];
					if (!document || !page) throw new Error("Template missing.");
					if (step.manual === "edit-template")
						page.html = `${page.html ?? ""}<p data-id="edited">Edited</p>`;
					else document.category = "general";
					documents.persist(document.name);
					continue;
				}
				last = await run(step.tool, step.args);
			}
			if (!last) throw new Error("No call.");
			expect(answerOf(last)).toContain(failure.seen);
			const lastStep = failure.steps.at(-1);
			if (lastStep && "args" in lastStep && lastStep.args.action === "create") {
				expect(last.isError).toBe(true);
				const name = String(lastStep.args.workspace);
				expect(
					structuredWorkspaces
						.list()
						.filter((workspace) => workspace.name === name)
						.map((workspace) => workspace.revision),
				).toEqual(
					failure.steps.length > 1 && name === "Reading list" ? [1] : [],
				);
			}
		} finally {
			store.close();
		}
	});

	it("never writes during check, and list and view lead with the verdict", async () => {
		const { store, documents, run } = methodHarness();
		try {
			await run("maket_structured_workspace", {
				action: "create",
				workspace: "Reading list",
				data_schema: {
					type: "object",
					properties: { title: { type: "string" } },
				},
			});
			const card = documents.resolve("Reading list — Items — card template");
			if (!card) throw new Error("Card missing.");
			card.category = "general";
			const before = JSON.stringify(
				store.loadStructuredWorkspace("Reading list"),
			);
			const check = await run("maket_structured_workspace", {
				action: "check",
				workspace: "Reading list",
			});
			expect(check.structuredContent).toMatchObject({
				workspace: "Reading list",
				verdict: "ready",
				findings: expect.arrayContaining([
					expect.objectContaining({ severity: "warning", object: "template" }),
					expect.objectContaining({
						severity: "hint",
						object: "item",
						next: expect.stringContaining("action=add_item"),
					}),
				]),
			});
			expect(card.category).toBe("general");
			expect(
				JSON.stringify(store.loadStructuredWorkspace("Reading list")),
			).toBe(before);
			const listed = await run("maket_structured_workspace", {
				action: "list",
			});
			expect(textOf(listed)).toMatch(/^- \[ready\] Reading list \(/);
			const viewed = await run("maket_structured_workspace", {
				action: "view",
				workspace: "Reading list",
			});
			expect(Object.keys(viewed.structuredContent ?? {}).slice(0, 3)).toEqual([
				"verdict",
				"findings",
				"check",
			]);
			expect(viewed.structuredContent).toMatchObject({
				verdict: "ready",
				findings: 1,
				check: expect.stringContaining("action=check"),
			});
		} finally {
			store.close();
		}
	});

	it("keeps the previous definition when update_definition has errors, unless allow_incomplete", async () => {
		const { store, structuredWorkspaces, run } = methodHarness();
		try {
			const [create] = STRUCTURED_WORKSPACE_METHOD[0]?.steps ?? [];
			if (!create) throw new Error("Method missing.");
			await run(create.tool, create.args);
			const change = {
				action: "update_definition",
				workspace: "Reading list",
				expected_workspace_revision: 1,
				representation_schema: {
					collections: { items: { groupBy: "/genre" } },
				},
			};
			const refused = await run("maket_structured_workspace", change);
			expect(refused.isError).toBe(true);
			expect(textOf(refused)).toContain(
				'Structured Workspace "Reading list" keeps its definition at revision 1: the new definition has 1 error(s).',
			);
			expect(textOf(refused)).toContain(
				'- collection "items" · representation_schema.collections.items.groupBy: Collection "items" groupBy "/genre" names no property of the data schema. Fix:',
			);
			expect(textOf(refused)).toContain("action=update_definition workspace=");
			expect(structuredWorkspaces.get("Reading list")).toMatchObject({
				revision: 1,
				representationSchema: {
					collections: { items: { name: "Items" } },
				},
			});
			expect(
				structuredWorkspaces.get("Reading list")?.representationSchema
					.collections.items?.groupBy,
			).toBeUndefined();
			const forced = await run("maket_structured_workspace", {
				...change,
				allow_incomplete: true,
			});
			expect(forced.isError).toBeUndefined();
			expect(textOf(forced)).toContain(
				"updated to revision 2. Verdict: incomplete, 1 error(s):",
			);
			expect(structuredWorkspaces.check("Reading list").verdict).toBe(
				"not ready",
			);
		} finally {
			store.close();
		}
	});

	it("never retires a duplicated or instantiated copy of a generated template", async () => {
		const { store, documents, run } = methodHarness();
		try {
			const [create, add] = STRUCTURED_WORKSPACE_METHOD[0]?.steps ?? [];
			if (!create || !add) throw new Error("Method missing.");
			await run(create.tool, create.args);
			await run(add.tool, add.args);
			for (const name of ["Dune", "Reading list — Items"])
				expect(
					documents.resolve(name)?.meta.structuredWorkspaceGenerated,
				).toBeUndefined();
			const duplicated = await run("maket_doc", {
				action: "duplicate",
				doc: "Reading list — Items — detail template",
				name: "Detail copy",
			});
			expect(duplicated.isError).toBeUndefined();
			const copy = documents.resolve("Detail copy");
			expect(copy?.category).toBe("general");
			expect(copy?.meta.structuredWorkspace).toBeUndefined();
			expect(copy?.meta.structuredWorkspaceGenerated).toBeUndefined();
			const original = documents.resolve(
				"Reading list — Items — detail template",
			);
			const updated = await run("maket_structured_workspace", {
				action: "update_definition",
				workspace: "Reading list",
				expected_workspace_revision: 1,
				representation_schema: {
					collections: {
						items: {
							detailTemplateHtml:
								'<article data-id="book"><h1 data-id="title">{{ state.title }}</h1></article>',
						},
					},
				},
			});
			expect(updated.isError).toBeUndefined();
			expect(documents.resolveById(original?.id ?? "")).toBeNull();
			expect(documents.resolve("Detail copy")).toMatchObject({
				category: "general",
			});
			expect(
				documents.resolve("Detail copy")?.meta.structuredWorkspace,
			).toBeUndefined();
		} finally {
			store.close();
		}
	});

	it("refuses update_item data that breaks the schema with path, rule and fix", async () => {
		const { store, run } = methodHarness();
		try {
			const [create, add] = STRUCTURED_WORKSPACE_METHOD[0]?.steps ?? [];
			if (!create || !add) throw new Error("Method missing.");
			await run(create.tool, create.args);
			await run(add.tool, add.args);
			const view = await run("maket_structured_workspace", {
				action: "view",
				workspace: "Reading list",
			});
			const itemId = (
				view.structuredContent as { items: Array<{ id: string }> }
			).items[0]?.id;
			const refused = await run("maket_structured_workspace", {
				action: "update_item",
				workspace: "Reading list",
				item: itemId,
				expected_revision: 1,
				data: { title: "Dune", status: "lost" },
			});
			expect(refused.isError).toBe(true);
			expect(textOf(refused)).toContain(
				'- /status [rule enum]: Invalid item data/status: must be equal to one of the allowed values. Fix: Use one of ["to read","reading","done"] at /status.',
			);
		} finally {
			store.close();
		}
	});
});

describe("maket_structured_workspace Mermaid sources", () => {
	it("refuses add_item and update_item when a maket-mermaid value cannot be drawn, writing nothing", async () => {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const documents = createDocuments({ store });
		const documentStates = createDocumentStates({ store, bus, documents });
		const structuredWorkspaces = createStructuredWorkspaces({
			store,
			bus,
			documents,
			documentStates,
		});
		const tool = createMaketStructuredWorkspaceTool({ structuredWorkspaces });
		try {
			const created = await tool.handler(
				{
					action: "create",
					workspace: "Flows",
					data_schema: {
						type: "object",
						properties: {
							title: { type: "string" },
							flow: { type: "string", format: "maket-mermaid" },
						},
						required: ["title"],
					},
				},
				{} as never,
			);
			expect(created.isError).toBeUndefined();
			const definition = structuredWorkspaces.get("Flows");
			const [collectionId, collection] = Object.entries(
				definition?.representationSchema.collections ?? {},
			)[0] ?? ["", undefined];
			const bindingId = Object.keys(collection?.bindings ?? {})[0] ?? "";
			const add = (documentName: string, flow: string) =>
				tool.handler(
					{
						action: "add_item",
						workspace: "Flows",
						item: documentName,
						collection: collectionId,
						binding: bindingId,
						document_name: documentName,
						data: { title: documentName, flow },
					},
					{} as never,
				);

			const refused = await add("Broken", "not a diagram");
			expect(refused.isError).toBe(true);
			expect(textOf(refused)).toMatch(
				/^State value \/flow \(format maket-mermaid\) is not a Mermaid diagram Maket can draw: Invalid mermaid header.* Fix: /,
			);
			expect(documents.resolveOrLoad("Broken")).toBeNull();
			expect(structuredWorkspaces.get("Flows")?.items).toEqual([]);

			const added = await add("Release", "flowchart LR\n  Draft --> Signed");
			expect(added.isError).toBeUndefined();
			const update = await tool.handler(
				{
					action: "update_item",
					workspace: "Flows",
					item: "Release",
					expected_revision: 1,
					data: {
						title: "Release",
						flow: "flowchart LR\n  classDef hot fill:#f00",
					},
				},
				{} as never,
			);
			expect(update.isError).toBe(true);
			expect(textOf(update)).toContain(
				"State value /flow (format maket-mermaid) is not a Mermaid diagram Maket can draw: Mermaid styling directives are not supported.",
			);
			expect(documentStates.get("Release")?.current).toMatchObject({
				revision: 1,
				data: { title: "Release", flow: "flowchart LR\n  Draft --> Signed" },
			});
		} finally {
			store.close();
		}
	});
});
