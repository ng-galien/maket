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

	it("rejects raw or non-state placeholders", () => {
		expect(() =>
			resolveDocumentStateText("{{{ state.title }}}", { title: "<b>x</b>" }),
		).toThrow(/escaped value placeholders/);
		expect(() =>
			resolveDocumentStateText("{{ title }}", { title: "x" }),
		).toThrow(/state namespace/);
	});
});
