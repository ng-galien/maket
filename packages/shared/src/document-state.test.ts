import { describe, expect, it } from "vitest";
import {
	resolveDocumentStateText,
	validateDocumentState,
} from "./document-state.js";

const schema = {
	type: "object",
	properties: {
		title: { type: "string" },
		done: { type: "boolean" },
	},
	required: ["title", "done"],
	additionalProperties: false,
};

describe("document state primitives", () => {
	it("validates a complete state snapshot", () => {
		expect(
			validateDocumentState(schema, { title: "Audit", done: false }),
		).toEqual([]);
		expect(validateDocumentState(schema, { title: "Audit" })).toEqual([
			expect.stringContaining("done"),
		]);
	});

	it("renders state in its own namespace", () => {
		expect(
			resolveDocumentStateText("<h1>{{ state.title }}</h1>", {
				title: "Safety & quality",
			}),
		).toBe("<h1>Safety &amp; quality</h1>");
	});

	it("renders Mustache sections from document state", () => {
		expect(
			resolveDocumentStateText(
				"{{#state.items}}<li>{{label}}</li>{{/state.items}}",
				{ items: [{ label: "One" }, { label: "Two" }] },
			),
		).toBe("<li>One</li><li>Two</li>");
	});

	it("renders inverted sections for an empty state value", () => {
		expect(
			resolveDocumentStateText(
				"{{^state.items}}<p>Nothing to do</p>{{/state.items}}",
				{ items: [] },
			),
		).toBe("<p>Nothing to do</p>");
	});

	it("rejects unsafe or unscoped Mustache features", () => {
		expect(() =>
			resolveDocumentStateText("{{{ state.title }}}", { title: "<b>x</b>" }),
		).toThrow(/escaped values/);
		expect(() =>
			resolveDocumentStateText("{{> shared}}", { title: "x" }),
		).toThrow(/sections/);
		expect(() =>
			resolveDocumentStateText("{{ title }}", { title: "x" }),
		).toThrow(/state namespace/);
		expect(() =>
			resolveDocumentStateText("{{#items}}{{title}}{{/items}}", {
				items: [{ title: "x" }],
			}),
		).toThrow(/state namespace/);
	});
});
