import { describe, expect, it, vi } from "vitest";
import { createDocument } from "../types.js";
import { createBus } from "./bus.js";
import { createCollections } from "./collections.js";
import { createDocuments } from "./documents.js";
import { createSQLiteStore } from "./store.js";

function makeStoreDeps() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	return {
		store,
		bus,
		documents,
		collections: createCollections({ store, bus, documents }),
	};
}

describe("Collections service", () => {
	it("saves, lists and resolves collections", () => {
		const { store, collections } = makeStoreDeps();
		collections.save({
			name: "clients",
			schema: {
				type: "object",
				properties: { client_name: { type: "string" } },
				required: ["client_name"],
				additionalProperties: false,
			},
			members: [{ id: "member_1", position: 0, data: { client_name: "Acme" } }],
		});

		expect(collections.list()).toEqual([
			expect.objectContaining({
				name: "clients",
				fieldCount: 1,
				memberCount: 1,
			}),
		]);
		expect(collections.resolve("clients")?.members).toHaveLength(1);
		store.close();
	});

	it("binds a collection to a document page", () => {
		const { store, bus, documents, collections } = makeStoreDeps();
		const saved = vi.fn();
		bus.on("document:saved", saved);
		collections.save({
			name: "clients",
			schema: {
				type: "object",
				properties: { client_name: { type: "string" } },
				required: ["client_name"],
				additionalProperties: false,
			},
			members: [{ id: "member_1", position: 0, data: { client_name: "Acme" } }],
		});
		const doc = createDocument({
			name: "poster",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
		});
		store.saveDoc(doc);
		documents.loadAll();

		const updated = collections.bindPage("poster", 0, "clients");

		expect(updated.pages[0]?.collection).toEqual({ name: "clients" });
		expect(store.loadOne("poster")?.pages[0]?.collection).toEqual({
			name: "clients",
		});
		expect(saved).toHaveBeenCalledWith({ docName: "poster" });
		store.close();
	});

	it("refuses to delete a collection still referenced by a document page", () => {
		const { store, documents, collections } = makeStoreDeps();
		collections.save({
			name: "clients",
			schema: {
				type: "object",
				properties: { client_name: { type: "string" } },
				required: ["client_name"],
				additionalProperties: false,
			},
			members: [{ id: "member_1", position: 0, data: { client_name: "Acme" } }],
		});
		const doc = createDocument({
			name: "poster",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					id: "page_1",
					name: "Page 1",
					elements: [],
					collection: { name: "clients" },
				},
			],
		});
		store.saveDoc(doc);
		documents.loadAll();

		expect(() => collections.delete("clients")).toThrow(
			'Collection "clients" is used by poster.',
		);
		expect(store.loadCollection("clients")).not.toBeNull();
		store.close();
	});
});
