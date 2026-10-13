import { describe, expect, it } from "vitest";
import {
	diagnoseStructuredWorkspaceDefinition,
	generateStructuredWorkspaceTemplates,
	structuredWorkspaceHiddenProperties,
	structuredWorkspaceItemDataIssues,
	structuredWorkspaceSchemaDeclaresPath,
	structuredWorkspaceTemplateFields,
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

describe("Structured Workspace diagnosis", () => {
	it("names the collection, the path and the fix of each definition error", () => {
		expect(
			diagnoseStructuredWorkspaceDefinition(dataSchema, {
				version: 1,
				collections: {
					backlog: {
						name: "Backlog",
						collectionTemplateDocumentId: "",
						bindings: {},
						sortBy: "place",
					},
				},
			}),
		).toEqual([
			expect.objectContaining({
				severity: "error",
				object: "template",
				collection: "backlog",
				path: "representation_schema.collections.backlog.collectionTemplateDocumentId",
				fix: expect.stringContaining("Remove collectionTemplateDocumentId"),
			}),
			expect.objectContaining({
				object: "index",
				path: "representation_schema.collections.backlog.sortBy",
				fix: 'Write sortBy with a leading slash, for example "/place".',
			}),
			expect.objectContaining({
				object: "collection",
				path: "representation_schema.collections.backlog.bindings",
			}),
		]);
	});

	it("gives each item data issue its path, rule and fix", () => {
		expect(
			structuredWorkspaceItemDataIssues(
				{
					type: "object",
					properties: { title: { type: "string" } },
					required: ["title"],
					additionalProperties: false,
				},
				{ colour: "red" },
			),
		).toEqual([
			{
				path: "/",
				rule: "required",
				message: "Invalid item data: must have required property 'title'",
				fix: 'Add "/title" to data.',
			},
			{
				path: "/",
				rule: "additionalProperties",
				message: "Invalid item data: must NOT have additional properties",
				fix: 'Remove "/colour" from data, or declare it in the data schema with update_definition.',
			},
		]);
	});

	it("tells whether item data can hold a pointer, through $ref and oneOf", () => {
		expect(structuredWorkspaceSchemaDeclaresPath(dataSchema, "/title")).toBe(
			true,
		);
		expect(structuredWorkspaceSchemaDeclaresPath(dataSchema, "/genre")).toBe(
			false,
		);
		expect(
			structuredWorkspaceSchemaDeclaresPath(
				{ type: "object", properties: { a: { type: "string" } } },
				"/b",
			),
		).toBe(true);
		expect(structuredWorkspaceSchemaDeclaresPath(dataSchema, "genre")).toBe(
			false,
		);
	});

	it("generates templates from the schema: title, one line per property, editable form, card", () => {
		const schema = {
			type: "object",
			properties: {
				year: { type: "integer", title: "Year" },
				title: { type: "string" },
				isbn: { type: "string", readOnly: true },
				status: { enum: ["open", "done"] },
				meta: { type: "object" },
			},
		};
		expect(structuredWorkspaceTemplateFields(schema)).toEqual([
			{ name: "year", label: "Year", kind: "value", editable: true },
			{ name: "title", label: "Title", kind: "value", editable: true },
			{ name: "isbn", label: "Isbn", kind: "value", editable: false },
			{ name: "status", label: "Status", kind: "value", editable: true },
		]);
		const templates = generateStructuredWorkspaceTemplates("Books", schema);
		expect(templates.detailHtml).toContain(
			'<h1 data-id="detail-title">{{ state.title }}</h1>',
		);
		expect(templates.detailHtml).toContain(
			'<div data-id="field-year"><dt>Year</dt><dd>{{ state.year }}</dd></div>',
		);
		expect(templates.detailHtml).not.toContain("maket-json-form");
		expect(templates.detailForm?.uischema.elements).toEqual([
			{ type: "Control", scope: "#/properties/year" },
			{ type: "Control", scope: "#/properties/title" },
			{ type: "Control", scope: "#/properties/status" },
		]);
		expect(templates.compactHtml).toContain("Year: {{ state.year }}");
		expect(templates.compactHtml).toContain("Isbn: {{ state.isbn }}");
		expect(templates.compactHtml).not.toContain("Status:");
		expect(templates.indexHtml).toContain(
			'<h1 data-id="index-title">Books</h1>',
		);
		expect(templates.indexHtml).toContain("data-maket-structured-items");
		expect(
			generateStructuredWorkspaceTemplates("Empty", { type: "object" })
				.detailForm,
		).toBeUndefined();
	});
});

describe("Structured Workspace generated fields", () => {
	it("keeps Unicode names and lists what generated templates leave out", () => {
		const schema = {
			type: "object",
			properties: {
				année: { type: "integer" },
				"x-y": { type: "string" },
				"a.b": { type: "string" },
				lieu: { type: "object" },
				gens: { type: "array", items: { type: "object" } },
			},
		};
		expect(
			structuredWorkspaceTemplateFields(schema).map((field) => field.name),
		).toEqual(["année", "x-y"]);
		expect(
			generateStructuredWorkspaceTemplates("Livres", schema).detailHtml,
		).toContain(
			'<div data-id="field-ann_e"><dt>Année</dt><dd>{{ state.année }}</dd></div>',
		);
		expect(structuredWorkspaceHiddenProperties(schema)).toEqual([
			{ name: "a.b", reason: "its name cannot be used in a placeholder" },
			{ name: "lieu", reason: "it is a nested object" },
			{ name: "gens", reason: "it is a list of objects or lists" },
		]);
		expect(structuredWorkspaceHiddenProperties(dataSchema)).toEqual([
			{
				name: "",
				reason: "the binding schema has no direct properties (it uses oneOf)",
			},
		]);
	});
});
