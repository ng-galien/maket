import { describe, expect, it } from "vitest";
import {
	type Collection,
	escapeCollectionValue,
	formatCollectionTemplateIssues,
	listCollectionPlaceholders,
	markCollectionPlaceholders,
	parseCollectionPlaceholder,
	parseCollectionPlaceholderName,
	resolveCollectionText,
	validateCollection,
	validateCollectionTemplate,
} from "./collections.js";

const collection: Collection = {
	name: "clients",
	schema: {
		type: "object",
		properties: {
			client_name: { type: "string", title: "Client" },
			offer_summary: { type: "string", title: "Offre" },
			budget: { type: "number", title: "Budget" },
			active: { type: "boolean", title: "Actif" },
			address: {
				type: "object",
				properties: { city: { type: "string" } },
				additionalProperties: false,
			},
		},
		required: ["client_name", "offer_summary"],
		additionalProperties: false,
	},
	members: [
		{
			id: "member_1",
			position: 0,
			data: {
				client_name: "Acme & Partners",
				offer_summary: "Audit <premium>",
				budget: 12000.5,
				active: true,
				address: { city: "Paris" },
			},
		},
	],
};

describe("parseCollectionPlaceholder", () => {
	it("parses collection fields and generated values", () => {
		expect(parseCollectionPlaceholder("{{ client_name }}")).toEqual({
			kind: "collectionField",
			field: "client_name",
		});
		expect(parseCollectionPlaceholderName("page.total")).toEqual({
			kind: "generatedValue",
			value: "page.total",
		});
	});

	it("rejects expressions, paths and malformed placeholders", () => {
		expect(parseCollectionPlaceholder("{{ client.name }}")).toBeNull();
		expect(parseCollectionPlaceholder("{{ client-name }}")).toBeNull();
		expect(parseCollectionPlaceholder("client_name")).toBeNull();
	});
});

describe("listCollectionPlaceholders", () => {
	it("keeps source ranges for every placeholder", () => {
		expect(
			listCollectionPlaceholders(
				"<h1>{{ client_name }}</h1><span>{{ page.number }}</span>",
			),
		).toEqual([
			{
				raw: "{{ client_name }}",
				name: "client_name",
				start: 4,
				end: 21,
				placeholder: { kind: "collectionField", field: "client_name" },
			},
			{
				raw: "{{ page.number }}",
				name: "page.number",
				start: 32,
				end: 49,
				placeholder: { kind: "generatedValue", value: "page.number" },
			},
		]);
	});

	it("reports unclosed placeholders as malformed occurrences", () => {
		expect(listCollectionPlaceholders("<p>{{ client_name</p>")).toEqual([]);
	});
});

describe("validateCollectionTemplate", () => {
	it("accepts known collection fields and generated values", () => {
		expect(
			validateCollectionTemplate(
				"<h1>{{ client_name }}</h1><p>{{ page.number }} / {{ page.total }}</p>",
				collection,
			),
		).toEqual([]);
	});

	it("rejects unknown collection fields", () => {
		expect(
			validateCollectionTemplate("<h1>{{ prospect_name }}</h1>", collection),
		).toEqual([
			expect.objectContaining({
				code: "unknownCollectionField",
				field: "prospect_name",
			}),
		]);
	});

	it("rejects unknown generated values", () => {
		expect(
			validateCollectionTemplate("<p>{{ page.index }}</p>", collection),
		).toEqual([
			expect.objectContaining({
				code: "unknownGeneratedValue",
				placeholder: "{{ page.index }}",
			}),
		]);
	});

	it("rejects malformed placeholders", () => {
		expect(
			validateCollectionTemplate("<h1>{{ client-name }}</h1>", collection),
		).toEqual([
			expect.objectContaining({
				code: "malformedPlaceholder",
				placeholder: "{{ client-name }}",
			}),
		]);
	});

	it("rejects invalid template syntax", () => {
		expect(
			validateCollectionTemplate("<p>{{ client_name</p>", collection),
		).toEqual([
			expect.objectContaining({
				code: "invalidTemplate",
			}),
		]);
	});

	it("rejects unsupported template features", () => {
		expect(
			validateCollectionTemplate(
				"<p>{{#client_name}}{{ client_name }}{{/client_name}}</p>",
				collection,
			),
		).toEqual([
			expect.objectContaining({
				code: "unsupportedTemplateFeature",
			}),
		]);
	});

	it("rejects placeholders inside HTML attributes", () => {
		expect(
			validateCollectionTemplate('<img alt="{{ client_name }}">', collection),
		).toEqual([
			expect.objectContaining({
				code: "placeholderInAttribute",
				placeholder: "{{ client_name }}",
			}),
		]);
	});

	it("rejects members that do not match the JSON schema", () => {
		const incompleteCollection: Collection = {
			name: "clients",
			schema: collection.schema,
			members: [{ id: "member_1", position: 0, data: { client_name: "Acme" } }],
		};

		expect(validateCollection(incompleteCollection)).toEqual([
			expect.objectContaining({
				code: "invalidMember",
				memberId: "member_1",
			}),
		]);
	});

	it("rejects invalid schema and invalid field names", () => {
		const invalidCollection: Collection = {
			name: "clients",
			schema: {
				type: "object",
				properties: {
					ClientName: { type: "string" },
				},
			},
			members: [{ id: "member_1", position: 0, data: { ClientName: "" } }],
		};

		expect(validateCollection(invalidCollection)).toEqual([
			expect.objectContaining({ code: "invalidField", field: "ClientName" }),
		]);
	});

	it("rejects object fields as inline placeholders", () => {
		expect(
			validateCollectionTemplate("<p>{{ address }}</p>", collection),
		).toEqual([
			expect.objectContaining({
				code: "unsupportedCollectionField",
				field: "address",
			}),
		]);
	});
});

describe("markCollectionPlaceholders", () => {
	it("marks collection fields with stable DOM attributes", () => {
		expect(markCollectionPlaceholders("<h1>Hello {{ client_name }}</h1>")).toBe(
			'<h1>Hello <span data-collection-placeholder="client_name" data-collection-placeholder-kind="collectionField" data-collection-bound="true">{{ client_name }}</span></h1>',
		);
	});

	it("marks generated placeholders as bound — they always resolve", () => {
		expect(
			markCollectionPlaceholders("<p>{{ page.number }} / {{ page.total }}</p>"),
		).toBe(
			'<p><span data-collection-placeholder="page.number" data-collection-placeholder-kind="generatedValue" data-collection-bound="true">{{ page.number }}</span> / <span data-collection-placeholder="page.total" data-collection-placeholder-kind="generatedValue" data-collection-bound="true">{{ page.total }}</span></p>',
		);
	});

	it("marks unknown fields as unbound when a collection is provided", () => {
		const collection = {
			name: "clients",
			schema: {
				type: "object",
				properties: { client_name: { type: "string" } },
			},
			members: [],
		};
		const marked = markCollectionPlaceholders(
			"<p>{{ client_name }} — {{ contact }}</p>",
			collection,
		);
		expect(marked).toContain(
			'data-collection-placeholder="client_name" data-collection-placeholder-kind="collectionField" data-collection-bound="true"',
		);
		expect(marked).toContain(
			'data-collection-placeholder="contact" data-collection-placeholder-kind="collectionField" data-collection-bound="false"',
		);
	});

	it("does not mark attribute placeholders", () => {
		expect(markCollectionPlaceholders('<img alt="{{ client_name }}">')).toBe(
			'<img alt="{{ client_name }}">',
		);
	});

	it("throws on invalid template syntax", () => {
		expect(() => markCollectionPlaceholders("<p>{{ client_name</p>")).toThrow();
	});
});

describe("resolveCollectionText", () => {
	it("escapes collection values and resolves generated values", () => {
		expect(
			resolveCollectionText(
				"<h1>{{ client_name }}</h1><p>{{ offer_summary }}</p><span>{{ budget }} {{ active }} {{ page.number }}/{{ page.total }}</span>",
				collection,
				{
					member: collection.members[0],
					memberNumber: 1,
					memberTotal: 12,
					pageNumber: 3,
					pageTotal: 12,
				},
			),
		).toBe(
			"<h1>Acme &amp; Partners</h1><p>Audit &lt;premium&gt;</p><span>12000.5 true 3/12</span>",
		);
	});

	it("keeps explicit empty values", () => {
		const emptyCollection: Collection = {
			name: "clients",
			schema: {
				type: "object",
				properties: { client_name: { type: "string" } },
				required: ["client_name"],
				additionalProperties: false,
			},
			members: [{ id: "member_1", position: 0, data: { client_name: "" } }],
		};

		expect(
			resolveCollectionText("<h1>{{ client_name }}</h1>", emptyCollection, {
				member: emptyCollection.members[0],
				memberNumber: 1,
				memberTotal: 1,
				pageNumber: 1,
				pageTotal: 1,
			}),
		).toBe("<h1></h1>");
	});

	it("throws with formatted validation issues before resolving", () => {
		expect(() =>
			resolveCollectionText("<h1>{{ prospect_name }}</h1>", collection, {
				member: collection.members[0],
				memberNumber: 1,
				memberTotal: 1,
				pageNumber: 1,
				pageTotal: 1,
			}),
		).toThrow('Unknown collection field "prospect_name".');
	});

	it("throws when the rendered member misses an explicit field value", () => {
		expect(() =>
			resolveCollectionText("<h1>{{ offer_summary }}</h1>", collection, {
				member: {
					id: "external_member",
					position: 0,
					data: { client_name: "Acme" },
				},
				memberNumber: 1,
				memberTotal: 1,
				pageNumber: 1,
				pageTotal: 1,
			}),
		).toThrow('Collection member "external_member" does not match schema:');
	});
});

describe("escapeCollectionValue", () => {
	it("escapes HTML-sensitive characters", () => {
		expect(escapeCollectionValue(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
	});
});

describe("formatCollectionTemplateIssues", () => {
	it("formats issues for UI or tool output", () => {
		expect(
			formatCollectionTemplateIssues(
				validateCollectionTemplate(
					"<h1>{{ prospect_name }}</h1><p>{{ page.index }}</p>",
					collection,
				),
			),
		).toBe(
			'Unknown collection field "prospect_name".\nUnknown generated value "page.index".',
		);
	});
});
