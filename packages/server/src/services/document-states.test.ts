import { describe, expect, it, vi } from "vitest";
import { createDocument } from "../types.js";
import { createBus } from "./bus.js";
import { createCollections } from "./collections.js";
import { createDocumentStates } from "./document-states.js";
import { createDocuments } from "./documents.js";
import { createStateRenderer } from "./state-renderer.js";
import { createSQLiteStore } from "./store.js";

const schema = {
	type: "object",
	properties: {
		title: { type: "string" },
		done: { type: "boolean" },
	},
	required: ["title", "done"],
	additionalProperties: false,
};

function fixture() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const doc = createDocument({
		name: "audit",
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
		pages: [
			{
				name: "Checklist",
				elements: [],
				html: "<h1>{{ state.title }}</h1>",
			},
		],
	});
	documents.all().set(doc.name, doc);
	documents.persist(doc.name);
	const states = createDocumentStates({ store, documents, bus });
	return { store, bus, documents, doc, states };
}

describe("DocumentStates", () => {
	it("renders JSON Forms pages and exposes their generated controls to state patches", () => {
		const { store, documents, doc, states } = fixture();
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html = undefined;
		page.jsonForms = {
			uischema: {
				type: "VerticalLayout",
				elements: [
					{ type: "Control", scope: "#/properties/title" },
					{ type: "Control", scope: "#/properties/done" },
				],
			},
		};
		states.initialize("audit", schema, { title: "Audit", done: false });
		documents.persist(doc.name);

		const renderer = createStateRenderer({ documentStates: states });
		const rendered = renderer.render(doc).pages[0]?.html ?? "";
		expect(rendered).toContain("data-maket-json-forms");
		expect(rendered).toContain('data-maket-path="/title"');
		expect(rendered).toContain('value="Audit"');

		const updated = states.patchTerminal("audit", 1, {
			op: "replace",
			path: "/title",
			value: "Ready",
		});
		expect(updated.data.title).toBe("Ready");
		expect(renderer.render(doc).pages[0]?.html).toContain('value="Ready"');
		store.close();
	});

	it("rejects an incompatible binding before attaching or changing state", () => {
		const { store, doc, states } = fixture();
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html =
			'<label><input type="checkbox" data-maket-bind="state.title">Title</label>';

		expect(() =>
			states.initialize("audit", schema, { title: "Audit", done: false }),
		).toThrow(/requires a boolean/);
		expect(doc.dataModel).toBe("static");
		expect(store.loadDocumentState(doc.id)).toBeNull();

		page.html =
			'<label><input type="checkbox" data-maket-bind="state.done">Done</label>';
		states.initialize("audit", schema, { title: "Audit", done: false });
		const incompatibleSchema = {
			...schema,
			properties: { ...schema.properties, done: { type: "string" } },
		};
		expect(() =>
			states.changeSchema("audit", 1, incompatibleSchema, {
				title: "Audit",
				done: "no",
			}),
		).toThrow(/requires a boolean/);
		expect(states.get("audit")?.current).toMatchObject({
			revision: 1,
			data: { done: false },
		});
		store.close();
	});

	it("rejects an invalid binding in an empty Mustache loop before attaching state", () => {
		const { store, doc, states } = fixture();
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html =
			'{{#state.items}}<input type="checkbox" data-maket-bind="title">{{/state.items}}';
		const listSchema = {
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
		};

		expect(() => states.initialize("audit", listSchema, { items: [] })).toThrow(
			/requires a boolean/,
		);
		expect(doc.dataModel).toBe("static");
		expect(store.loadDocumentState(doc.id)).toBeNull();
		store.close();
	});

	it("rejects select option drift during schema changes atomically", () => {
		const { store, doc, states } = fixture();
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html =
			'<select data-maket-bind="state.status"><option value="todo">À faire</option><option value="done">Fait</option></select>';
		const selectSchema = {
			type: "object",
			properties: {
				title: { type: "string" },
				done: { type: "boolean" },
				status: { type: "string", enum: ["todo", "done"] },
			},
			required: ["title", "done", "status"],
			additionalProperties: false,
		};
		states.initialize("audit", selectSchema, {
			title: "Audit",
			done: false,
			status: "todo",
		});

		const incompatibleSchema = {
			...selectSchema,
			properties: {
				...selectSchema.properties,
				status: { type: "string", enum: ["todo"] },
			},
		};
		expect(() =>
			states.changeSchema("audit", 1, incompatibleSchema, {
				title: "Audit",
				done: false,
				status: "todo",
			}),
		).toThrow(/non-enum option value "done"/);
		expect(states.get("audit")?.current).toMatchObject({
			revision: 1,
			data: { status: "todo" },
		});
		store.close();
	});

	it("stores immutable snapshots and restores as a new revision", () => {
		const { store, bus, doc, states } = fixture();
		const changed = vi.fn();
		const toast = vi.fn();
		bus.on("document-state:changed", changed);
		bus.on("toast", toast);

		const initial = states.initialize("audit", schema, {
			title: "Opening audit",
			done: false,
		});
		expect(initial.current.revision).toBe(1);
		expect(doc.dataModel).toBe("state");
		expect(
			createStateRenderer({ documentStates: states }).render(doc).pages[0]
				?.html,
		).toBe("<h1>Opening audit</h1>");

		const second = states.update("audit", 1, {
			title: "Opening audit",
			done: true,
		});
		expect(second.revision).toBe(2);
		const restored = states.restore("audit", 1, 2);
		expect(restored).toMatchObject({
			revision: 3,
			data: { title: "Opening audit", done: false },
		});
		expect(
			states.history("audit").map((revision) => revision.revision),
		).toEqual([3, 2, 1]);
		expect(states.revision("audit", 2)?.data).toEqual({
			title: "Opening audit",
			done: true,
		});
		expect(changed).toHaveBeenCalledTimes(3);
		expect(toast).not.toHaveBeenCalled();
		expect(store.loadOne("audit")?.dataModel).toBe("state");
		expect(() =>
			states.update("audit", 2, { title: "stale", done: true }),
		).toThrow(/expected 2, current 3/);
		store.close();
	});

	it("versions schema changes and restores schema plus data together", () => {
		const { store, bus, doc, states } = fixture();
		const changed = vi.fn();
		bus.on("document-state:changed", changed);
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html =
			'<h1>{{ state.title }}</h1><p>{{ state.priority }}</p><button type="button" data-maket-bind="state.done">Edit</button>';
		states.initialize("audit", schema, { title: "Audit", done: false });

		const patched = states.patch("audit", 1, [
			{ op: "replace", path: "/done", value: true },
		]);
		expect(patched).toMatchObject({ revision: 2, data: { done: true } });
		expect(changed).toHaveBeenLastCalledWith(
			expect.objectContaining({ revision: 2, paths: ["/done"] }),
		);

		const nextSchema = {
			...schema,
			properties: {
				...schema.properties,
				priority: { type: "number" },
			},
			required: [...schema.required, "priority"],
		};
		expect(() => states.validateSchema("audit", nextSchema)).toThrow(
			/priority/,
		);
		states.validateSchema("audit", nextSchema, {
			title: "Audit",
			done: true,
			priority: 2,
		});
		expect(() => states.changeSchema("audit", 2, nextSchema)).toThrow(
			/priority/,
		);
		const changedSchema = states.changeSchema("audit", 2, nextSchema, {
			title: "Audit prioritized",
			done: true,
			priority: 2,
		});
		expect(changedSchema).toMatchObject({
			revision: 3,
			schema: nextSchema,
			data: { title: "Audit prioritized", done: true, priority: 2 },
		});
		expect(states.get("audit")?.definition.schema).toEqual(nextSchema);
		expect(
			createStateRenderer({ documentStates: states }).render(doc).pages[0]
				?.html,
		).toContain('data-maket-path="/done" data-maket-type="boolean"');
		expect(states.revision("audit", 1)?.schema).toEqual(schema);
		expect(states.history("audit")).toHaveLength(3);
		expect(() =>
			states.changeSchema("audit", 2, schema, {
				title: "Stale",
				done: false,
			}),
		).toThrow(/expected 2, current 3/);

		const restored = states.restore("audit", 1, 3);
		expect(restored).toMatchObject({
			revision: 4,
			schema,
			data: { title: "Audit", done: false },
		});
		expect(states.get("audit")?.definition.schema).toEqual(schema);
		expect(
			createStateRenderer({ documentStates: states }).render(doc).pages[0]
				?.html,
		).toContain('data-maket-path="/done" data-maket-type="boolean"');
		expect(changed).toHaveBeenLastCalledWith(
			expect.objectContaining({
				revision: 4,
				paths: [""],
				schemaChanged: true,
			}),
		);
		store.close();
	});

	it("projects only pages whose state dependencies intersect a patch", () => {
		const { store, doc, states } = fixture();
		doc.pages.push(
			{
				id: "done-page",
				name: "Done",
				elements: [],
				html: '<input type="checkbox" data-maket-bind="state.done">',
			},
			{ id: "static-page", name: "Static", elements: [], html: "Always" },
		);
		states.initialize("audit", schema, { title: "Audit", done: false });
		const renderer = createStateRenderer({ documentStates: states });

		expect(renderer.renderPages(doc, ["/done"]).pages).toEqual([
			expect.objectContaining({
				index: 1,
				html: expect.stringContaining('data-maket-path="/done"'),
			}),
		]);
		expect(renderer.renderPages(doc, ["/title"]).pages).toEqual([
			{ index: 0, html: "<h1>Audit</h1>" },
		]);
		store.close();
	});

	it("falls back to a full page projection when a patch removes a binding", () => {
		const { store, bus, states } = fixture();
		const changed = vi.fn();
		bus.on("document-state:changed", changed);
		states.initialize(
			"audit",
			{ ...schema, required: ["done"] },
			{ title: "Temporary", done: false },
		);

		states.patch("audit", 1, [{ op: "remove", path: "/title" }]);

		expect(changed).toHaveBeenLastCalledWith(
			expect.objectContaining({ revision: 2, paths: [""] }),
		);
		store.close();
	});

	it("rejects invalid data and keeps collection documents separate", () => {
		const { store, bus, documents, states } = fixture();
		expect(() =>
			states.initialize("audit", schema, { title: "Incomplete" }),
		).toThrow(/done/);

		const collections = createCollections({ store, documents, bus });
		collections.create("clients", {
			type: "object",
			properties: { name: { type: "string" } },
		});
		collections.bindPage("audit", 0, "clients");
		expect(() =>
			states.initialize("audit", schema, { title: "Audit", done: false }),
		).toThrow(/collection data model/);
		store.close();
	});

	it("rejects an unsafe template before attaching state", () => {
		const { store, doc, states } = fixture();
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html = "{{#state.items}}{{{label}}}{{/state.items}}";

		expect(() =>
			states.initialize("audit", schema, {
				title: "Audit",
				done: false,
			}),
		).toThrow(/escaped values/);
		expect(doc.dataModel).toBe("static");
		expect(store.loadDocumentState(doc.id)).toBeNull();
		store.close();
	});

	it("prevents collection bindings after state initialization", () => {
		const { store, bus, documents, states } = fixture();
		states.initialize("audit", schema, { title: "Audit", done: false });
		const collections = createCollections({ store, documents, bus });
		collections.create("clients", {
			type: "object",
			properties: { name: { type: "string" } },
		});
		expect(() => collections.bindPage("audit", 0, "clients")).toThrow(
			/state-backed/,
		);
		store.close();
	});
});

describe("DocumentStates projection entries", () => {
	const projectionSchema = {
		type: "object",
		properties: {
			items: {
				type: "array",
				items: { $ref: "#/$defs/topic" },
			},
		},
		required: ["items"],
		$defs: {
			topic: {
				type: "object",
				properties: { title: { type: "string" } },
				required: ["title"],
			},
		},
	};

	it("replaces one entry in place: the revision advances without appending a snapshot", () => {
		const { store, bus, states } = fixture();
		states.initialize("audit", projectionSchema, {
			items: [{ title: "A" }, { title: "B" }, { title: "C" }],
		});
		const events: unknown[] = [];
		bus.on("document-state:changed", (change) => events.push(change));
		const before = states.current("audit");

		const revision = states.replaceProjectionEntry("audit", 1, "/items/1", {
			title: "B2",
		});

		expect(revision).toBe(2);
		expect(states.history("audit")).toHaveLength(1);
		expect(states.current("audit")).toMatchObject({
			revision: 2,
			data: { items: [{ title: "A" }, { title: "B2" }, { title: "C" }] },
		});
		expect(before).toMatchObject({
			revision: 1,
			data: { items: [{}, { title: "B" }, {}] },
		});
		expect(Object.isFrozen(states.current("audit")?.data)).toBe(true);
		expect(events).toEqual([
			{ docName: "audit", revision: 2, paths: ["/items/1"], projection: true },
		]);
		store.close();
	});

	it("refuses an invalid entry, a stale revision and a pointer outside the list", () => {
		const { store, states } = fixture();
		states.initialize("audit", projectionSchema, { items: [{ title: "A" }] });

		expect(() =>
			states.replaceProjectionEntry("audit", 1, "/items/0", { title: 3 }),
		).toThrow(/must be string/);
		expect(() =>
			states.replaceProjectionEntry("audit", 4, "/items/0", { title: "Z" }),
		).toThrow(/revision conflict/);
		expect(() =>
			states.replaceProjectionEntry("audit", 1, "/items/3", { title: "Z" }),
		).toThrow(/not an entry of a projected list/);
		expect(states.current("audit")).toMatchObject({
			revision: 1,
			data: { items: [{ title: "A" }] },
		});
		store.close();
	});

	it("accepts a live edit of a value bound to a textarea", () => {
		const { store, doc, states } = fixture();
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html =
			'<textarea data-id="note" data-maket-bind="state.title"></textarea>';
		states.initialize("audit", schema, { title: "First line", done: false });
		const renderer = createStateRenderer({ documentStates: states });
		expect(renderer.render(doc).pages[0]?.html).toContain(
			'data-maket-path="/title" data-maket-type="string">First line</textarea>',
		);

		const updated = states.patchTerminal("audit", 1, {
			op: "replace",
			path: "/title",
			value: "First line\nSecond line",
		});

		expect(updated.data.title).toBe("First line\nSecond line");
		expect(renderer.render(doc).pages[0]?.html).toContain(
			">First line\nSecond line</textarea>",
		);
		store.close();
	});

	it("accepts the value a bound action button declares and refuses a button whose value does not fit", () => {
		const { store, doc, states } = fixture();
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html =
			'<button type="button" data-maket-action="set" data-maket-bind="state.done" data-maket-value="maybe">Done</button>';
		expect(() =>
			states.initialize("audit", schema, { title: "Audit", done: false }),
		).toThrow(/not a valid boolean value/);

		page.html =
			'<button type="button" data-maket-action="set" data-maket-bind="state.done" data-maket-value="true">Done</button>';
		states.initialize("audit", schema, { title: "Audit", done: false });
		const updated = states.patchTerminal("audit", 1, {
			op: "replace",
			path: "/done",
			value: true,
		});

		expect(updated.data.done).toBe(true);
		store.close();
	});

	it("re-renders a select whose options come from a state list when the list changes", () => {
		const { store, doc, states } = fixture();
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html =
			'<select data-maket-bind="state.agent" data-maket-options="state.agents"></select>';
		const listSchema = {
			type: "object",
			properties: {
				agent: { type: "string" },
				agents: { type: "array", items: { type: "string" } },
			},
			required: ["agent", "agents"],
		};
		states.initialize("audit", listSchema, {
			agent: "builder",
			agents: ["builder"],
		});
		const renderer = createStateRenderer({ documentStates: states });

		states.patch("audit", 1, [
			{ op: "add", path: "/agents/-", value: "reviewer" },
		]);
		expect(renderer.renderPages(doc, ["/agents/1"]).pages[0]?.html).toContain(
			'<option value="reviewer">reviewer</option>',
		);
		const updated = states.patchTerminal("audit", 2, {
			op: "replace",
			path: "/agent",
			value: "reviewer",
		});

		expect(updated.data.agent).toBe("reviewer");
		expect(renderer.render(doc).pages[0]?.html).toContain(
			'<option value="reviewer" selected>reviewer</option>',
		);
		store.close();
	});
});
