import { describe, expect, it } from "vitest";
import {
	parseDeclaredStateValue,
	renderDocumentStateText,
	resolveDocumentStateText,
	validateDocumentState,
	validateDocumentStateTemplate,
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

	it("can repeatedly validate a persisted schema with an $id", () => {
		const identifiedSchema = { ...schema, $id: "urn:maket:test-state" };
		expect(
			validateDocumentState(identifiedSchema, { title: "Audit", done: false }),
		).toEqual([]);
		expect(
			validateDocumentState(structuredClone(identifiedSchema), {
				title: "Audit",
				done: true,
			}),
		).toEqual([]);
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

	it("keeps Mustache display-only and hydrates explicit native controls", () => {
		const rendered = renderDocumentStateText(
			'{{#state.items}}<label><input type="checkbox" data-maket-bind="done"><span>{{label}} — {{done}}</span></label>{{/state.items}}',
			{
				items: [
					{ label: "Doors", done: true },
					{ label: "Windows", done: false },
				],
			},
			{
				schema: {
					type: "object",
					properties: {
						items: {
							type: "array",
							items: {
								type: "object",
								properties: {
									label: { type: "string" },
									done: { type: "boolean" },
								},
							},
						},
					},
				},
			},
		);
		expect(rendered.html).toContain('data-maket-bind="done"');
		expect(rendered.html).toContain('data-maket-path="/items/0/done"');
		expect(rendered.html).toContain('data-maket-path="/items/1/done"');
		expect(rendered.html).toContain('data-maket-type="boolean"');
		expect(rendered.html.match(/ checked/g)).toHaveLength(1);
		expect(rendered.html).toContain("<span>Doors — true</span>");
		expect(rendered.html).not.toContain('role="button"');
		expect(rendered.dependencies).toContain("/items");
		expect(rendered.dependencies).toContain("/items/0/done");
	});

	it("hydrates a root binding only through the state namespace", () => {
		expect(
			renderDocumentStateText(
				'<button type="button" data-maket-bind="state.title">Edit</button>',
				{ title: "Audit" },
				{ schema },
			).html,
		).toContain('data-maket-path="/title" data-maket-type="string"');
		expect(() =>
			renderDocumentStateText(
				'<button type="button" data-maket-bind="title">Edit</button>',
				{ title: "Audit" },
				{ schema },
			),
		).toThrow(/state namespace/);
	});

	it("hydrates a button bound to null with its validated terminal type", () => {
		const rendered = renderDocumentStateText(
			'<button type="button" data-maket-bind="state.empty">Edit</button>',
			{ empty: null },
			{
				schema: {
					type: "object",
					properties: { empty: { type: "null" } },
				},
			},
		);

		expect(rendered.html).toContain(
			'data-maket-path="/empty" data-maket-type="null"',
		);
	});

	it("hydrates a text input value for live and serializable output", () => {
		const rendered = renderDocumentStateText(
			'<input type="text" value="stale" data-maket-bind="state.title">',
			{ title: 'Safety & "quality"' },
			{ schema },
		);

		expect(rendered.html).toContain('data-maket-path="/title"');
		expect(rendered.html).toContain('data-maket-type="string"');
		expect(rendered.html).toContain('value="Safety &amp; &quot;quality&quot;"');
		expect(rendered.html).not.toContain('value="stale"');
	});

	it("hydrates exactly one selected option from a string enum", () => {
		const statusSchema = {
			type: "object",
			properties: {
				status: { type: "string", enum: ["todo", "doing", "done"] },
			},
		};
		const rendered = renderDocumentStateText(
			'<select data-maket-bind="state.status"><option value="todo" selected>À faire</option><option value="doing">En cours</option><option value="done">Fait</option></select>',
			{ status: "doing" },
			{ schema: statusSchema },
		);

		expect(rendered.html).toContain(
			'<select data-maket-bind="state.status" data-maket-path="/status" data-maket-type="string">',
		);
		expect(rendered.html).toContain(
			'<option value="doing" selected>En cours</option>',
		);
		expect(rendered.html).not.toContain(
			'<option value="todo" selected>À faire</option>',
		);
		expect(rendered.html.match(/ selected/g)).toHaveLength(1);
	});

	it("hydrates text and select bindings inside repeated state sections", () => {
		const repeatedSchema = {
			type: "object",
			properties: {
				items: {
					type: "array",
					items: {
						type: "object",
						properties: {
							label: { type: "string" },
							status: { type: "string", enum: ["todo", "done"] },
						},
					},
				},
			},
		};
		const rendered = renderDocumentStateText(
			'{{#state.items}}<input type="text" data-maket-bind="label"><select data-maket-bind="status"><option value="todo">À faire</option><option value="done">Fait</option></select>{{/state.items}}',
			{
				items: [
					{ label: "Doors", status: "todo" },
					{ label: "Windows", status: "done" },
				],
			},
			{ schema: repeatedSchema },
		);

		expect(rendered.html).toContain('data-maket-path="/items/0/label"');
		expect(rendered.html).toContain('data-maket-path="/items/1/status"');
		expect(rendered.html).toContain(
			'<option value="done" selected>Fait</option>',
		);
	});

	it("recalculates repeated paths after list insertion, removal, and movement", () => {
		const template =
			'{{#state.items}}<input type="checkbox" data-maket-bind="done">{{/state.items}}';
		const itemSchema = {
			type: "object",
			properties: {
				items: {
					type: "array",
					items: {
						type: "object",
						properties: { done: { type: "boolean" } },
					},
				},
			},
		};
		const first = renderDocumentStateText(
			template,
			{ items: [{ done: true }, { done: false }] },
			{ schema: itemSchema },
		).html;
		const moved = renderDocumentStateText(
			template,
			{ items: [{ done: false }, { done: true }] },
			{ schema: itemSchema },
		).html;
		const inserted = renderDocumentStateText(
			template,
			{ items: [{ done: false }, { done: false }, { done: true }] },
			{ schema: itemSchema },
		).html;
		const removed = renderDocumentStateText(
			template,
			{ items: [{ done: true }] },
			{ schema: itemSchema },
		).html;
		expect(first).toMatch(/data-maket-path="\/items\/0\/done"[^>]* checked/);
		expect(moved).toMatch(/data-maket-path="\/items\/1\/done"[^>]* checked/);
		expect(moved).not.toMatch(
			/data-maket-path="\/items\/0\/done"[^>]* checked/,
		);
		expect(inserted).toMatch(/data-maket-path="\/items\/2\/done"[^>]* checked/);
		expect(removed).toMatch(/data-maket-path="\/items\/0\/done"[^>]* checked/);
		expect(removed).not.toContain('data-maket-path="/items/1/done"');
	});

	it("rejects unsupported controls, structural values, and runtime attributes", () => {
		expect(() =>
			renderDocumentStateText(
				'<input type="checkbox" data-maket-bind="state.title">',
				{ title: "Audit" },
				{ schema },
			),
		).toThrow(/requires a boolean/);
		expect(() =>
			renderDocumentStateText(
				'<button type="button" data-maket-bind="state.items">Edit</button>',
				{ items: [] },
			),
		).toThrow(/terminal JSON value/);
		expect(() =>
			renderDocumentStateText(
				'<button type="button" data-maket-bind="state.title" data-maket-path="/title">Edit</button>',
				{ title: "Audit" },
				{ schema },
			),
		).toThrow(/reserved/);
		expect(() =>
			renderDocumentStateText(
				'<span data-maket-error="stale">x</span>',
				{ title: "Audit" },
				{ schema },
			),
		).toThrow(/reserved/);
		expect(() =>
			renderDocumentStateText(
				'<input type="email" data-maket-bind="state.title">',
				{ title: "Audit" },
				{ schema },
			),
		).toThrow(/supports/);
	});

	it("rejects invalid text and select schema-control contracts", () => {
		expect(() =>
			renderDocumentStateText(
				'<input type="text" data-maket-bind="state.done">',
				{ done: true },
				{ schema },
			),
		).toThrow(/requires a string/);
		expect(() =>
			renderDocumentStateText(
				'<select data-maket-bind="state.title"><option value="Audit">Audit</option></select>',
				{ title: "Audit" },
				{ schema },
			),
		).toThrow(/string enum/);
		expect(() =>
			renderDocumentStateText(
				'<select multiple data-maket-bind="state.status"><option value="todo">À faire</option><option value="done">Fait</option></select>',
				{ status: "todo" },
				{
					schema: {
						type: "object",
						properties: {
							status: { type: "string", enum: ["todo", "done"] },
						},
					},
				},
			),
		).toThrow(/cannot use multiple/);
	});

	it("rejects missing, duplicate, non-enum, and disabled select options", () => {
		const enumSchema = {
			type: "object",
			properties: {
				status: { type: "string", enum: ["todo", "done"] },
			},
		};
		const render = (options: string, status = "todo") =>
			renderDocumentStateText(
				`<select data-maket-bind="state.status">${options}</select>`,
				{ status },
				{ schema: enumSchema },
			);

		expect(() => render('<option value="todo">À faire</option>')).toThrow(
			/exactly one selectable option.*done/,
		);
		expect(() =>
			render(
				'<option value="todo">À faire</option><option value="todo">Encore</option><option value="done">Fait</option>',
			),
		).toThrow(/duplicate option value/);
		expect(() =>
			render(
				'<option value="todo">À faire</option><option value="done">Fait</option><option value="later">Plus tard</option>',
			),
		).toThrow(/non-enum option value/);
		expect(() =>
			render(
				'<option value="todo" disabled>À faire</option><option value="done">Fait</option>',
			),
		).toThrow(/selectable option.*todo/);
		expect(() =>
			render(
				'<optgroup label="Blocked" disabled><option value="todo">À faire</option></optgroup><option value="done">Fait</option>',
			),
		).toThrow(/selectable option.*todo/);
		expect(() =>
			render('<option>À faire</option><option value="done">Fait</option>'),
		).toThrow(/explicit value/);
	});

	it("validates bindings in Mustache branches that render no current rows", () => {
		expect(() =>
			renderDocumentStateText(
				'{{#state.items}}<input type="checkbox" data-maket-bind="title">{{/state.items}}',
				{ items: [] },
				{
					schema: {
						type: "object",
						properties: {
							items: {
								type: "array",
								items: {
									type: "object",
									properties: { title: { type: "string" } },
								},
							},
						},
					},
				},
			),
		).toThrow(/requires a boolean/);
	});

	it("rejects composed schemas on bindable template paths explicitly", () => {
		const cases = [
			{
				template: '<input type="checkbox" data-maket-bind="state.done">',
				data: { done: true },
				schema: {
					type: "object",
					properties: { done: { $ref: "#/$defs/flag" } },
					$defs: { flag: { type: "boolean" } },
				},
				keyword: "$ref",
			},
			{
				template: '<input type="checkbox" data-maket-bind="state.done">',
				data: { done: true },
				schema: {
					allOf: [
						{
							type: "object",
							properties: { done: { type: "boolean" } },
						},
					],
				},
				keyword: "allOf",
			},
			{
				template: '<input type="checkbox" data-maket-bind="state.group.done">',
				data: { group: { done: true } },
				schema: {
					type: "object",
					properties: { group: { $ref: "#/$defs/group" } },
					$defs: {
						group: {
							type: "object",
							properties: { done: { type: "boolean" } },
						},
					},
				},
				keyword: "$ref",
			},
			{
				template:
					'{{#state.items}}<input type="checkbox" data-maket-bind="done">{{/state.items}}',
				data: { items: [] },
				schema: {
					type: "object",
					properties: {
						items: { type: "array", items: { $ref: "#/$defs/item" } },
					},
					$defs: {
						item: {
							type: "object",
							properties: { done: { type: "boolean" } },
						},
					},
				},
				keyword: "$ref",
			},
		];

		for (const testCase of cases) {
			const keywordPattern =
				testCase.keyword === "$ref" ? "\\$ref" : testCase.keyword;
			expect(() =>
				renderDocumentStateText(testCase.template, testCase.data, {
					schema: testCase.schema,
				}),
			).toThrow(new RegExp(`unsupported schema keyword "${keywordPattern}"`));
		}
	});

	it("reports only bindings emitted by the current render", () => {
		const rendered = renderDocumentStateText(
			'<input type="text" data-maket-bind="state.title">{{#state.visible}}<input type="text" data-maket-bind="state.secret">{{/state.visible}}',
			{ title: "Public", visible: false, secret: "Private" },
			{
				schema: {
					type: "object",
					properties: {
						title: { type: "string" },
						visible: { type: "boolean" },
						secret: { type: "string" },
					},
				},
			},
		);

		expect(rendered.bindingPaths).toEqual(["/title"]);
	});

	it("preserves document-authored native state selectors", () => {
		const styles =
			"<style>.row:has(.check:checked){opacity:.7}.check:focus-visible{outline:2px solid}</style>";
		const rendered = renderDocumentStateText(
			`${styles}<label class="row"><input class="check" type="checkbox" data-maket-bind="state.done"></label>`,
			{ done: true },
			{ schema },
		).html;

		expect(rendered).toContain(styles);
		expect(rendered).toMatch(/data-maket-path="\/done"[^>]* checked/);
	});

	it("rejects binding markup embedded in style or script content", () => {
		expect(() =>
			renderDocumentStateText(
				'<style>.x::before{content:"<button type=\\"button\\" data-maket-bind=\\"state.title\\">"}</style>',
				{ title: "Audit" },
				{ schema },
			),
		).toThrow(/inside style/);
	});

	it("never annotates objects or arrays as editable values", () => {
		expect(() =>
			renderDocumentStateText("<p>{{ state.items }}</p>", {
				items: [{ label: "Doors" }],
			}),
		).toThrow(/terminal JSON value/);
	});

	it("uses sections as ifs and loops with nested state context", () => {
		expect(
			resolveDocumentStateText(
				"{{#state}}<h1>{{title}}</h1>{{#groups}}<h2>{{name}}</h2>{{#items}}<li>{{label}}{{^done}} — pending{{/done}}</li>{{/items}}{{/groups}}{{/state}}",
				{
					title: "Audit",
					groups: [
						{
							name: "Safety",
							items: [
								{ label: "Doors", done: true },
								{ label: "Windows", done: false },
							],
						},
					],
				},
			),
		).toBe(
			"<h1>Audit</h1><h2>Safety</h2><li>Doors</li><li>Windows — pending</li>",
		);
	});

	it("renders the current value while iterating scalar arrays", () => {
		expect(
			resolveDocumentStateText("{{#state.tags}}<b>{{.}}</b>{{/state.tags}}", {
				tags: ["safe", "ready"],
			}),
		).toBe("<b>safe</b><b>ready</b>");
	});

	it("renders inverted sections for an empty state value", () => {
		expect(
			resolveDocumentStateText(
				"{{^state.items}}<p>Nothing to do</p>{{/state.items}}",
				{ items: [] },
			),
		).toBe("<p>Nothing to do</p>");
	});

	it("tracks an absent optional path so a later add can rerender the page", () => {
		const rendered = renderDocumentStateText(
			"{{^state.optional}}<p>Missing</p>{{/state.optional}}",
			{},
		);

		expect(rendered.html).toBe("<p>Missing</p>");
		expect(rendered.dependencies).toContain("/optional");
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
		expect(() =>
			resolveDocumentStateText("{{#state.items}}{{{danger}}}{{/state.items}}", {
				items: [{ danger: "<b>x</b>" }],
			}),
		).toThrow(/escaped values/);
		expect(() =>
			resolveDocumentStateText("{{#state.items}}{{> shared}}{{/state.items}}", {
				items: [{}],
			}),
		).toThrow(/sections/);
		expect(() =>
			resolveDocumentStateText(
				"{{^state.items}}{{emptyLabel}}{{/state.items}}",
				{ items: [], emptyLabel: "Empty" },
			),
		).toThrow(/state namespace/);
		expect(() =>
			resolveDocumentStateText('<p title="{{ state.title }}">x</p>', {
				title: "unsafe placement",
			}),
		).toThrow(/cannot be placed in <p title>/);
		expect(() =>
			resolveDocumentStateText(
				'<p class="{{#state.done}}ready{{/state.done}}">x</p>',
				{ done: true },
			),
		).toThrow(/HTML content/);
		expect(() =>
			resolveDocumentStateText(
				"<script>{{#state.done}}alert(1){{/state.done}}</script>",
				{ done: true },
			),
		).toThrow(/style or script/);
	});
});

describe("document state values in presentation attributes", () => {
	const barSchema = {
		type: "object",
		properties: {
			value: { type: ["number", "string"] },
			bars: {
				type: "array",
				items: {
					type: "object",
					properties: { width: { type: "number" }, y: { type: "number" } },
				},
			},
		},
	};
	const bar =
		'<svg viewBox="0 0 100 10"><rect data-id="bar" x="0" y="0" height="10" width="{{ state.value }}" style="transition: width 300ms"/></svg>';

	it("renders SVG geometry from state and tracks it as a dependency", () => {
		const rendered = renderDocumentStateText(
			bar,
			{ value: 42.5 },
			{ schema: barSchema },
		);
		expect(rendered.html).toContain('width="42.5"');
		expect(rendered.html).not.toMatch(/[\uE000\uE001]/);
		expect(rendered.dependencies).toContain("/value");
	});

	it("renders repeated bars, path data, transforms and style geometry", () => {
		const html = renderDocumentStateText(
			[
				'<svg viewBox="0 0 {{ state.value }} 20">',
				'{{#state.bars}}<rect y="{{ y }}" width="{{ width }}" height="4"/>{{/state.bars}}',
				'<path d="M0 0 L{{ state.value }} 10 Z"/>',
				'<g transform="translate({{ state.value }}, 2) rotate(-45)"></g>',
				"</svg>",
				'<div style="width: {{ state.value }}%; color: red; opacity: 0.{{ state.value }}"></div>',
			].join(""),
			{
				value: 50,
				bars: [
					{ width: 10, y: 0 },
					{ width: 20.25, y: 5 },
				],
			},
			{ schema: barSchema },
		).html;
		expect(html).toContain('viewBox="0 0 50 20"');
		expect(html).toContain('<rect y="0" width="10" height="4"/>');
		expect(html).toContain('<rect y="5" width="20.25" height="4"/>');
		expect(html).toContain('d="M0 0 L50 10 Z"');
		expect(html).toContain('transform="translate(50, 2) rotate(-45)"');
		expect(html).toContain('style="width: 50%; color: red; opacity: 0.50"');
	});

	it("fails the render when a value does not match the attribute grammar", () => {
		expect(() =>
			renderDocumentStateText(bar, { value: "wide" }, { schema: barSchema }),
		).toThrow(/<rect width> must render a number or a length.*got "wide"/);
		expect(() =>
			renderDocumentStateText(
				'<svg><path d="{{ state.value }}"/></svg>',
				{ value: "M0 0 L10 10 url(x)" },
				{ schema: barSchema },
			),
		).toThrow(/<path d> must render path data/);
		expect(() =>
			renderDocumentStateText(
				'<svg><g transform="{{ state.value }}"></g></svg>',
				{ value: "translate(1) perspective(2)" },
				{ schema: barSchema },
			),
		).toThrow(/<g transform> must render transform functions/);
		expect(() =>
			renderDocumentStateText(
				'<div style="width: {{ state.value }}"></div>',
				{ value: "1px; background: url(x)" },
				{ schema: barSchema },
			),
		).toThrow(/<div style width> must render/);
		expect(() =>
			renderDocumentStateText(
				'<svg viewBox="{{ state.value }}"></svg>',
				{ value: "0 0 10" },
				{ schema: barSchema },
			),
		).toThrow(/<svg viewBox> must render four numbers/);
	});

	it("refuses attributes and properties outside the whitelist", () => {
		expect(() =>
			validateDocumentStateTemplate(
				'<svg><rect fill="{{ state.value }}"/></svg>',
			),
		).toThrow(/cannot be placed in <rect fill>/);
		expect(() =>
			validateDocumentStateTemplate('<div width="{{ state.value }}"></div>'),
		).toThrow(/cannot be placed in <div width>/);
		expect(() =>
			validateDocumentStateTemplate(
				'<div style="background: {{ state.value }}"></div>',
			),
		).toThrow(/cannot set <div style background>/);
		expect(() =>
			validateDocumentStateTemplate(
				"<svg><rect width={{ state.value }}/></svg>",
			),
		).toThrow(/quoted presentation attribute/);
		expect(() =>
			validateDocumentStateTemplate(
				'<svg><rect {{#state.value}}width="1"{{/state.value}}/></svg>',
			),
		).toThrow(/sections must be placed in HTML content/);
		expect(() =>
			validateDocumentStateTemplate(
				'<a title=">" href="{{ state.value }}">x</a>',
			),
		).toThrow(/cannot be placed in <a href>/);
		expect(() =>
			validateDocumentStateTemplate(
				'<div data-note="a>b" style="{{ state.value }}"></div>',
			),
		).toThrow(/cannot set <div style/);
	});

	it("refuses active constructs in a templated attribute before rendering", () => {
		for (const template of [
			'<div style="width: {{ state.value }}px; background: url(https://x)"></div>',
			'<div style="width: expression({{ state.value }})"></div>',
			'<svg><path d="javascript:{{ state.value }}"/></svg>',
			'<div style="width: {{ state.value }}px; background: \\75rl(x)"></div>',
		]) {
			expect(() => validateDocumentStateTemplate(template)).toThrow(
				/active construct/,
			);
		}
		expect(() =>
			validateDocumentStateTemplate(
				'<input type="text" data-maket-bind="state.value" style="width: {{ state.value }}px">',
			),
		).toThrow(/cannot combine data-maket-bind/);
	});
});

describe("document state list flow", () => {
	const data = {
		rows: [{ label: "a" }, { label: "b" }, { label: "c" }],
		points: [{ cx: 1 }, { cx: 2 }],
	};

	it("marks the items of top-level lists in element content", () => {
		const rendered = renderDocumentStateText(
			'<ul>{{#state.rows}}<li>{{label}}</li>{{/state.rows}}</ul><svg>{{#state.points}}<circle cx="{{cx}}"></circle>{{/state.points}}</svg>',
			data,
			{ flow: { mark: true } },
		);

		expect(rendered.flowLists).toEqual(["/rows"]);
		expect(rendered.html).toBe(
			'<ul><!--maket-flow:0:0--><li>a</li><!--/maket-flow--><!--maket-flow:0:1--><li>b</li><!--/maket-flow--><!--maket-flow:0:2--><li>c</li><!--/maket-flow--></ul><svg><circle cx="1"></circle><circle cx="2"></circle></svg>',
		);
	});

	it("renders the range of a flowing list while inverted sections test the whole list", () => {
		const rendered = renderDocumentStateText(
			"<ul>{{#state.rows}}<li>{{label}}</li>{{/state.rows}}</ul>{{^state.rows}}<p>none</p>{{/state.rows}}",
			data,
			{ flow: { ranges: { "/rows": [3, null] } } },
		);

		expect(rendered.html).toBe("<ul></ul>");
		expect(
			renderDocumentStateText(
				"{{#state.rows}}<i>{{label}}</i>{{/state.rows}}",
				data,
				{ flow: { ranges: { "/rows": [1, 2] } } },
			).html,
		).toBe("<i>b</i>");
	});

	it("leaves lists nested in a list item whole and unmarked", () => {
		const rendered = renderDocumentStateText(
			"{{#state.groups}}<section>{{#entries}}<b>{{.}}</b>{{/entries}}</section>{{/state.groups}}",
			{ groups: [{ entries: ["x", "y"] }] },
			{ flow: { mark: true } },
		);

		expect(rendered.flowLists).toEqual(["/groups"]);
		expect(rendered.html).toBe(
			"<!--maket-flow:0:0--><section><b>x</b><b>y</b></section><!--/maket-flow-->",
		);
	});
});

describe("bound multiline field", () => {
	const noteSchema = {
		type: "object",
		properties: { note: { type: "string" }, done: { type: "boolean" } },
		required: ["note", "done"],
	};

	it("shows the state value as the content of a bound textarea", () => {
		const rendered = renderDocumentStateText(
			'<textarea data-id="note" rows="3" data-maket-bind="state.note">draft</textarea>',
			{ note: "Line 1\nLine <2> & co", done: false },
			{ schema: noteSchema },
		);

		expect(rendered.html).toBe(
			'<textarea data-id="note" rows="3" data-maket-bind="state.note" data-maket-path="/note" data-maket-type="string">Line 1\nLine &lt;2&gt; &amp; co</textarea>',
		);
		expect(rendered.bindingPaths).toEqual(["/note"]);
	});

	it("requires a string value and a closing tag", () => {
		expect(() =>
			renderDocumentStateText(
				'<textarea data-maket-bind="state.done"></textarea>',
				{ note: "", done: false },
				{ schema: noteSchema },
			),
		).toThrow(/Textarea binding "state.done" requires a string state value/);
		expect(() =>
			renderDocumentStateText(
				'<textarea data-maket-bind="state.note">',
				{ note: "", done: false },
				{ schema: noteSchema },
			),
		).toThrow(/closing <\/textarea>/);
	});
});

describe("bound action button", () => {
	const actionSchema = {
		type: "object",
		properties: {
			instruction: { type: "string" },
			priority: { type: "number" },
			status: { type: "string", enum: ["open", "closed"] },
		},
		required: ["instruction", "priority", "status"],
	};
	const data = { instruction: "", priority: 1, status: "open" };

	it("types a declared value as its binding", () => {
		expect(parseDeclaredStateValue("Relancer", "string")).toBe("Relancer");
		expect(parseDeclaredStateValue("2.5", "number")).toBe(2.5);
		expect(parseDeclaredStateValue("", "number")).toBeUndefined();
		expect(parseDeclaredStateValue("true", "boolean")).toBe(true);
		expect(parseDeclaredStateValue("yes", "boolean")).toBeUndefined();
		expect(parseDeclaredStateValue("null", "null")).toBeNull();
	});

	it("accepts a button declaring a value that fits its binding", () => {
		const rendered = renderDocumentStateText(
			'<button type="button" data-maket-action="set" data-maket-bind="state.instruction" data-maket-value="Relancer l\'agent">Relancer</button><button type="button" data-maket-bind="state.status" data-maket-value="closed">Clore</button>',
			data,
			{ schema: actionSchema },
		);

		expect(rendered.bindingPaths).toEqual(["/instruction", "/status"]);
		expect(rendered.html).toContain(
			'data-maket-value="Relancer l\'agent" data-maket-path="/instruction" data-maket-type="string"',
		);
	});

	it("refuses a declared value that does not fit and an action other than set", () => {
		const render = (html: string) =>
			renderDocumentStateText(html, data, { schema: actionSchema });
		expect(() =>
			render(
				'<button type="button" data-maket-bind="state.priority" data-maket-value="high">x</button>',
			),
		).toThrow(/not a valid number value/);
		expect(() =>
			render(
				'<button type="button" data-maket-bind="state.status" data-maket-value="archived">x</button>',
			),
		).toThrow(/not a valid string value/);
		expect(() =>
			render(
				'<button type="button" data-maket-action="open-document" data-maket-bind="state.instruction" data-maket-value="x">x</button>',
			),
		).toThrow(/data-maket-action="set" only/);
	});
});

describe("select options from a state list", () => {
	const listSchema = {
		type: "object",
		properties: {
			agent: { type: "string" },
			agents: {
				type: "array",
				items: {
					type: "object",
					properties: { value: { type: "string" }, label: { type: "string" } },
				},
			},
			names: { type: "array", items: { type: "string" } },
		},
		required: ["agent", "agents", "names"],
	};

	it("generates the options of a bound select from a state list and selects the value", () => {
		const rendered = renderDocumentStateText(
			'<select data-id="agent" data-maket-bind="state.agent" data-maket-options="state.agents"><option value="ignored">Ignored</option></select>',
			{
				agent: "builder",
				agents: [
					{ value: "builder", label: "Maket <builder>" },
					{ value: "reviewer" },
				],
				names: [],
			},
			{ schema: listSchema },
		);

		expect(rendered.html).toBe(
			'<select data-id="agent" data-maket-bind="state.agent" data-maket-options="state.agents" data-maket-path="/agent" data-maket-options-path="/agents" data-maket-type="string"><option value="builder" selected>Maket &lt;builder&gt;</option><option value="reviewer">reviewer</option></select>',
		);
		expect(rendered.dependencies).toEqual(
			expect.arrayContaining(["/agent", "/agents"]),
		);
	});

	it("keeps a current value missing from the list as its own option", () => {
		const rendered = renderDocumentStateText(
			'<select data-maket-bind="state.agent" data-maket-options="state.names"></select>',
			{ agent: "", agents: [], names: ["a", "b"] },
			{ schema: listSchema },
		);

		expect(rendered.html).toContain(
			'<option value="" selected></option><option value="a">a</option><option value="b">b</option>',
		);
	});

	it("refuses an option list that is not a declared list of strings or value objects", () => {
		expect(() =>
			renderDocumentStateText(
				'<select data-maket-bind="state.agent" data-maket-options="state.agent"></select>',
				{ agent: "", agents: [], names: [] },
				{ schema: listSchema },
			),
		).toThrow(/must name a list declared by the state schema/);
		expect(() =>
			renderDocumentStateText(
				'<select data-maket-bind="state.agent" data-maket-options="state.names"></select>',
				{ agent: "", agents: [], names: [3] },
			),
		).toThrow(/entries must be strings or objects/);
	});
});
