import type { StructuredWorkspaceView } from "@maket/shared";
import { describe, expect, it } from "vitest";
import { structuredWorkspaceTemplateSchemaView } from "./structuredWorkspaceTemplateSchema";

const workspace: StructuredWorkspaceView = {
	id: "delivery",
	name: "Delivery",
	dataSchema: {
		type: "object",
		properties: {
			tasks: {
				type: "array",
				items: { $ref: "#/$defs/task" },
			},
		},
		$defs: {
			task: {
				type: "object",
				properties: { title: { type: "string" } },
			},
		},
	},
	representationSchema: {
		version: 1,
		collections: {
			backlog: {
				name: "Backlog",
				collectionTemplateDocumentId: "board-template",
				bindings: {
					task: {
						schemaPath: "/$defs/task",
						compactTemplateDocumentId: "card-template",
						detailTemplateDocumentId: "card-template",
					},
				},
			},
		},
	},
	revision: 1,
	items: [],
	collectionDocuments: [],
	templateDocuments: [
		{
			documentId: "board-template",
			documentName: "Board template",
			roles: [{ role: "collection", collectionId: "backlog" }],
		},
		{
			documentId: "card-template",
			documentName: "Card template",
			roles: [
				{ role: "detail", collectionId: "backlog", bindingId: "task" },
				{ role: "compact", collectionId: "backlog", bindingId: "task" },
			],
		},
	],
	integrity: { status: "incomplete", issues: ["Missing projection"] },
	createdAt: "2026-09-21T00:00:00.000Z",
	updatedAt: "2026-09-21T00:00:00.000Z",
};

describe("structuredWorkspaceTemplateSchemaView", () => {
	it("shows collection context for a collection template", () => {
		const view = structuredWorkspaceTemplateSchemaView(
			[workspace],
			"Board template",
		);

		expect(view?.value).toMatchObject({
			role: "collection",
			collectionId: "backlog",
			collectionName: "Backlog",
			dataSchema: workspace.dataSchema,
			representation: workspace.representationSchema.collections.backlog,
		});
	});

	it("resolves binding schemas and orders multiple roles deterministically", () => {
		const view = structuredWorkspaceTemplateSchemaView(
			[workspace],
			"Card template",
		);

		expect(view?.value).toMatchObject({
			documentName: "Card template",
			roles: [
				{
					role: "compact",
					bindingId: "task",
					schemaPath: "/$defs/task",
					schema: {
						type: "object",
						properties: { title: { type: "string" } },
						$defs: workspace.dataSchema.$defs,
					},
				},
				{ role: "detail", bindingId: "task" },
			],
		});
	});
});
