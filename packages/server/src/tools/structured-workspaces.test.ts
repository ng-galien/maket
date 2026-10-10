import type { CallToolResult } from "@modelcontextprotocol/server";
import { asValue } from "awilix";
import { describe, expect, it } from "vitest";
import { createAppContainer } from "../bootstrap.js";
import { registerServerEvents } from "../server-events.js";
import { type Bus, createBus } from "../services/bus.js";
import { createConfig } from "../services/config.js";
import { createDocumentStates } from "../services/document-states.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore, type Store } from "../services/store.js";
import { createStructuredWorkspaces } from "../services/structured-workspaces.js";
import { createDocument } from "../types.js";
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
			const result = await tool.handler(
				{
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
				},
				{} as never,
			);
			expect(result.isError).toBeUndefined();
			expect(textOf(result)).toContain("incomplete");
			const listed = await tool.handler({ action: "list" }, {} as never);
			expect(listed.isError).toBeUndefined();
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
			expect(
				JSON.parse(textOf(view)).representationSchema.collections.items,
			).toMatchObject({
				groupBy: "/status",
				groupOrder: ["live", "dormant"],
				pageSize: 12,
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
		const emptyBinding = await tool.handler(
			{
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
			},
			{} as never,
		);
		expect(emptyBinding.isError).toBeUndefined();
		expect(textOf(emptyBinding)).toContain(
			'Structured Workspace "Invalid delivery" created',
		);
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
	it("writes and broadcasts one item of a 60-item workspace", async () => {
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
		const broadcasts: Array<{ type: string; doc?: string; bytes: number }> = [];
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
		for (let index = 0; index < 60; index += 1) {
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
			"appendDocumentStateRevision",
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
		expect(projected).toHaveLength(60);
		expect(projected[30]?.status).toBe("closed");
		expect(projected.filter(({ status }) => status === "open")).toHaveLength(
			59,
		);
		store.close();
	});
});
