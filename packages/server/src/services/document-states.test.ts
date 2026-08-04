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
	it("stores immutable snapshots, computes diffs, and restores as a new revision", () => {
		const { store, bus, doc, states } = fixture();
		const changed = vi.fn();
		bus.on("document-state:changed", changed);

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
		expect(states.diff("audit", 1, 2)).toEqual([
			{ path: "/done", before: false, after: true },
		]);

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
		expect(store.loadOne("audit")?.dataModel).toBe("state");
		expect(() =>
			states.update("audit", 2, { title: "stale", done: true }),
		).toThrow(/expected 2, current 3/);
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
