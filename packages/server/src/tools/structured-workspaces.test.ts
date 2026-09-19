import type { CallToolResult } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createBus } from "../services/bus.js";
import { createDocumentStates } from "../services/document-states.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore } from "../services/store.js";
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
							collectionTemplateDocumentId: "Task template",
							bindings: {
								"": {
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
		expect(emptyBinding.isError).toBe(true);
		expect(textOf(emptyBinding)).toContain("Binding ids must not be empty");
		expect(structuredWorkspaces.get("Invalid delivery")).toBeNull();

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
		store.close();
	});
});
