import { describe, expect, it } from "vitest";
import {
	validateStructuredWorkspaceDefinition,
	validateStructuredWorkspaceItemData,
} from "./structured-workspace.js";

const dataSchema = {
	type: "object",
	oneOf: [{ $ref: "#/$defs/task" }, { $ref: "#/$defs/decision" }],
	$defs: {
		task: {
			type: "object",
			properties: { kind: { const: "task" }, title: { type: "string" } },
			required: ["kind", "title"],
			additionalProperties: false,
		},
		decision: {
			type: "object",
			properties: { kind: { const: "decision" }, title: { type: "string" } },
			required: ["kind", "title"],
			additionalProperties: false,
		},
	},
};

describe("Structured Workspace contracts", () => {
	it("accepts oneOf data schemas with explicit representation bindings", () => {
		expect(
			validateStructuredWorkspaceDefinition(dataSchema, {
				version: 1,
				collections: {
					backlog: {
						name: "Backlog",
						collectionTemplateDocumentId: "board",
						bindings: {
							task: {
								schemaPath: "/$defs/task",
								detailTemplateDocumentId: "task-detail",
							},
							decision: {
								schemaPath: "/$defs/decision",
								detailTemplateDocumentId: "decision-detail",
							},
						},
					},
				},
			}),
		).toEqual([]);
	});

	it("rejects representation bindings that do not resolve into the data schema", () => {
		expect(
			validateStructuredWorkspaceDefinition(dataSchema, {
				version: 1,
				collections: {
					backlog: {
						name: "Backlog",
						collectionTemplateDocumentId: "board",
						bindings: {
							missing: {
								schemaPath: "/$defs/missing",
								detailTemplateDocumentId: "missing-detail",
							},
						},
					},
				},
			}),
		).toEqual([
			expect.stringContaining(
				'Binding "backlog.missing" has an invalid schemaPath',
			),
		]);
	});

	it("rejects empty binding ids independently from their collection path", () => {
		expect(
			validateStructuredWorkspaceDefinition(dataSchema, {
				version: 1,
				collections: {
					backlog: {
						name: "Backlog",
						collectionTemplateDocumentId: "board",
						bindings: {
							"": {
								schemaPath: "/$defs/task",
								detailTemplateDocumentId: "task-detail",
							},
						},
					},
				},
			}),
		).toContain("Binding ids must not be empty.");
	});

	it("validates item data against the complete data schema", () => {
		expect(
			validateStructuredWorkspaceItemData(dataSchema, {
				kind: "task",
				title: "Ship the first slice",
			}),
		).toEqual([]);
		expect(
			validateStructuredWorkspaceItemData(dataSchema, {
				kind: "task",
				title: 42,
			}),
		).not.toEqual([]);
	});
});
