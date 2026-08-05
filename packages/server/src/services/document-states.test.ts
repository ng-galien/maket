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

		expect(renderer.renderPages(doc, ["/done"])).toEqual([
			expect.objectContaining({
				index: 1,
				html: expect.stringContaining('data-maket-path="/done"'),
			}),
		]);
		expect(renderer.renderPages(doc, ["/title"])).toEqual([
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
