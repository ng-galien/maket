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
	const clientSchema = {
		type: "object",
		properties: { client_name: { type: "string" } },
		required: ["client_name"],
		additionalProperties: false,
	};

	it("saves, lists and resolves collections", () => {
		const { store, collections } = makeStoreDeps();
		collections.save({
			name: "clients",
			schema: clientSchema,
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

	it("creates a collection from a schema", () => {
		const { store, collections } = makeStoreDeps();

		const collection = collections.create("clients", clientSchema, "Clients");

		expect(collection).toEqual({
			name: "clients",
			description: "Clients",
			schema: clientSchema,
			members: [],
		});
		expect(store.loadCollection("clients")).toEqual(collection);
		store.close();
	});

	it("validates schema changes against existing rows before applying them", () => {
		const { store, collections } = makeStoreDeps();
		collections.save({
			name: "clients",
			schema: clientSchema,
			members: [{ id: "member_1", position: 0, data: { client_name: "Acme" } }],
		});

		const invalidResult = collections.changeSchema("clients", {
			type: "object",
			properties: { budget: { type: "number" } },
			required: ["budget"],
			additionalProperties: false,
		});

		expect(invalidResult.valid).toBe(false);
		expect(invalidResult.issues).toEqual([
			expect.objectContaining({ code: "invalidMember", memberId: "member_1" }),
		]);
		expect(store.loadCollection("clients")?.schema).toEqual(clientSchema);

		const validSchema = {
			type: "object",
			properties: {
				client_name: { type: "string" },
				budget: { type: "number" },
			},
			required: ["client_name"],
			additionalProperties: true,
		};

		expect(collections.validateSchema("clients", validSchema).valid).toBe(true);
		expect(collections.changeSchema("clients", validSchema).valid).toBe(true);
		expect(store.loadCollection("clients")?.schema).toEqual(validSchema);
		store.close();
	});

	it("adds, updates and deletes rows through collection operations", () => {
		const { store, collections } = makeStoreDeps();
		collections.create("clients", clientSchema);

		const withRow = collections.addRow("clients", { client_name: "Acme" });

		expect(withRow.members).toEqual([
			{ id: "member_1", position: 0, data: { client_name: "Acme" } },
		]);

		const updated = collections.updateRow("clients", "member_1", {
			client_name: "Globex",
		});

		expect(updated.members[0]?.data).toEqual({ client_name: "Globex" });

		const withoutRow = collections.deleteRow("clients", "member_1");

		expect(withoutRow.members).toEqual([]);
		expect(store.loadCollection("clients")?.members).toEqual([]);
		store.close();
	});

	it("refuses row changes that do not validate the schema", () => {
		const { store, collections } = makeStoreDeps();
		collections.create("clients", clientSchema);

		expect(() => collections.addRow("clients", { client_name: 42 })).toThrow(
			'Collection member "member_1" does not match schema',
		);
		expect(store.loadCollection("clients")?.members).toEqual([]);
		store.close();
	});

	it("binds a collection to a document page", () => {
		const { store, bus, documents, collections } = makeStoreDeps();
		const saved = vi.fn();
		bus.on("document:saved", saved);
		collections.save({
			name: "clients",
			schema: clientSchema,
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
			schema: clientSchema,
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
