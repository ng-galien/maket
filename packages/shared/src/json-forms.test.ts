import { describe, expect, it } from "vitest";
import { renderDocumentStatePage } from "./document-state-page.js";

const schema = {
	type: "object",
	properties: {
		title: { type: "string", title: "Titre", minLength: 2 },
		description: { type: "string", title: "Description" },
		priority: { type: "integer", title: "Priorité", minimum: 1 },
		done: { type: "boolean", title: "Terminé" },
		status: {
			type: "string",
			title: "Statut",
			oneOf: [
				{ const: "todo", title: "À faire" },
				{ const: "done", title: "Fait" },
			],
		},
		dueDate: { type: "string", format: "date", title: "Échéance" },
	},
	required: ["title", "status"],
};

describe("JSON Forms page rendering", () => {
	it("generates native bound controls from the document state schema", () => {
		const rendered = renderDocumentStatePage(
			{ jsonForms: {} },
			{
				title: "Audit",
				description: "Doors",
				priority: 2,
				done: false,
				status: "todo",
				dueDate: "2026-09-21",
			},
			{ schema },
		);

		expect(rendered.html).toContain("data-maket-json-forms");
		expect(rendered.html).toContain('data-maket-path="/title"');
		expect(rendered.html).toContain('value="Audit"');
		expect(rendered.html).toContain('type="number"');
		expect(rendered.html).toContain('type="checkbox"');
		expect(rendered.html).toContain(
			'<option value="todo" selected>À faire</option>',
		);
		expect(rendered.html).toContain('type="date"');
		expect(rendered.html).toContain("--charte-color-primary");
		expect(rendered.html).toContain("--charte-color-text");
		expect(rendered.html).toContain("--charte-font-body");
		expect(rendered.html).not.toContain("var(--charte-text,");
		expect(rendered.bindingPaths).toEqual([
			"/title",
			"/description",
			"/priority",
			"/done",
			"/status",
			"/dueDate",
		]);
	});

	it("honours layouts, multiline controls, radio choices and visibility rules", () => {
		const rendered = renderDocumentStatePage(
			{
				jsonForms: {
					uischema: {
						type: "VerticalLayout",
						elements: [
							{
								type: "Control",
								scope: "#/properties/description",
								options: { multi: true },
							},
							{
								type: "Control",
								scope: "#/properties/status",
								options: { format: "radio" },
							},
							{
								type: "Control",
								scope: "#/properties/priority",
								rule: {
									effect: "HIDE",
									condition: {
										scope: "#/properties/done",
										schema: { const: true },
									},
								},
							},
						],
					},
				},
			},
			{ description: "Long", status: "done", priority: 2, done: true },
			{ schema },
		);

		expect(rendered.html).toContain("<textarea");
		expect(rendered.html).toContain('type="radio"');
		expect(rendered.html).not.toContain('data-maket-path="/priority"');
		expect(rendered.dependencies).toContain("/done");
	});

	it("rejects ambiguous and unsupported templates", () => {
		expect(() =>
			renderDocumentStatePage(
				{ html: "<p>Legacy</p>", jsonForms: {} },
				{},
				{ schema },
			),
		).toThrow(/either HTML or JSON Forms/);
		expect(() =>
			renderDocumentStatePage(
				{
					jsonForms: {
						uischema: { type: "Categorization", elements: [] },
					},
				},
				{},
				{ schema },
			),
		).toThrow(/Unsupported JSON Forms element type/);
		expect(() =>
			renderDocumentStatePage(
				{ jsonForms: {} },
				{ score: 1 },
				{
					schema: {
						type: "object",
						properties: { score: { type: "number", enum: [1, 2] } },
					},
				},
			),
		).toThrow(/require string values/);
	});
});
