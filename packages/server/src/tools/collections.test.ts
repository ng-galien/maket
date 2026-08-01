import { describe, expect, it } from "vitest";
import { createBus } from "../services/bus.js";
import { createCollectionCursors } from "../services/collection-cursor.js";
import { createCollections } from "../services/collections.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { collectionsPack, createMaketCollectionTool } from "./collections.js";

const NO_EXTRA = {} as any;

const clientSchema = {
	type: "object",
	properties: { client_name: { type: "string" } },
	required: ["client_name"],
	additionalProperties: false,
};

function fixture() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const collections = createCollections({ store, bus, documents });
	const collectionCursors = createCollectionCursors({ bus, documents, store });
	return {
		store,
		documents,
		collections,
		collectionCursors,
		tool: createMaketCollectionTool({ collections, collectionCursors }),
		cleanup: () => store.close(),
	};
}

function body(
	res: Awaited<
		ReturnType<ReturnType<typeof createMaketCollectionTool>["handler"]>
	>,
) {
	return (res.content[0] as any).text as string;
}

describe("collectionsPack", () => {
	it("declares its tool and collection service dependency", () => {
		expect(collectionsPack.declaresTools).toEqual(["maket_collection"]);
		expect(collectionsPack.requires).toEqual([
			"collections",
			"collectionCursors",
		]);
	});
});

describe("maket_collection", () => {
	it("creates a collection and edits rows through business actions", async () => {
		const { store, tool, cleanup } = fixture();

		const createRes = await tool.handler(
			{ action: "create", name: "clients", schema: clientSchema },
			NO_EXTRA,
		);
		expect(body(createRes)).toMatch(/created/);

		const addRes = await tool.handler(
			{
				action: "add_row",
				name: "clients",
				data: { client_name: "Acme" },
			},
			NO_EXTRA,
		);
		expect(body(addRes)).toMatch(/member_1/);

		await tool.handler(
			{
				action: "update_row",
				name: "clients",
				row: "member_1",
				data: { client_name: "Globex" },
			},
			NO_EXTRA,
		);
		expect(store.loadCollection("clients")?.members[0]?.data).toEqual({
			client_name: "Globex",
		});

		await tool.handler(
			{ action: "delete_row", name: "clients", row: "member_1" },
			NO_EXTRA,
		);
		expect(store.loadCollection("clients")?.members).toEqual([]);
		cleanup();
	});

	it("returns schema validation errors without applying the schema", async () => {
		const { store, tool, cleanup } = fixture();
		await tool.handler(
			{ action: "create", name: "clients", schema: clientSchema },
			NO_EXTRA,
		);
		await tool.handler(
			{
				action: "add_row",
				name: "clients",
				data: { client_name: "Acme" },
			},
			NO_EXTRA,
		);

		const res = await tool.handler(
			{
				action: "change_schema",
				name: "clients",
				schema: {
					type: "object",
					properties: { budget: { type: "number" } },
					required: ["budget"],
					additionalProperties: false,
				},
			},
			NO_EXTRA,
		);

		expect(res.isError).toBe(true);
		expect(body(res)).toMatch(/Schema rejected/);
		expect(store.loadCollection("clients")?.schema).toEqual(clientSchema);
		cleanup();
	});

	it("checks schemas without saving them", async () => {
		const { store, tool, cleanup } = fixture();
		await tool.handler(
			{ action: "create", name: "clients", schema: clientSchema },
			NO_EXTRA,
		);

		const validSchema = {
			type: "object",
			properties: {
				client_name: { type: "string" },
				budget: { type: "number" },
			},
			required: ["client_name"],
			additionalProperties: true,
		};

		const res = await tool.handler(
			{
				action: "validate_schema",
				name: "clients",
				schema: validSchema,
			},
			NO_EXTRA,
		);

		expect(body(res)).toMatch(/validates existing rows/);
		expect(store.loadCollection("clients")?.schema).toEqual(clientSchema);
		cleanup();
	});
});

describe("maket_collection — action=cursor", () => {
	function boundFixture() {
		const f = fixture();
		f.collections.save({
			name: "clients",
			schema: clientSchema,
			members: [
				{ id: "member_1", position: 0, data: { client_name: "Acme" } },
				{ id: "member_2", position: 1, data: { client_name: "Globex" } },
			],
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
		f.store.saveDoc(doc);
		f.documents.loadAll();
		return f;
	}

	it("reads the default cursor of a bound page", async () => {
		const { tool, cleanup } = boundFixture();
		const res = await tool.handler(
			{ action: "cursor", doc: "poster", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(body(res)).toMatch(/mode template/);
		expect(body(res)).toMatch(/row 1\/2/);
		cleanup();
	});

	it("moves mode and row, accepting a 1-based row number", async () => {
		const { tool, collectionCursors, cleanup } = boundFixture();
		const res = await tool.handler(
			{ action: "cursor", doc: "poster", page: 1, mode: "rendered", row: "2" },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(body(res)).toMatch(/mode rendered/);
		expect(body(res)).toMatch(/row 2\/2/);
		expect(body(res)).toMatch(/Globex/);
		expect(collectionCursors.resolve("poster", 0)).toEqual(
			expect.objectContaining({ mode: "rendered", memberId: "member_2" }),
		);
		cleanup();
	});

	it("accepts a member id as row and rejects unknown rows", async () => {
		const { tool, cleanup } = boundFixture();
		const byId = await tool.handler(
			{ action: "cursor", doc: "poster", page: 1, row: "member_2" },
			NO_EXTRA,
		);
		expect(byId.isError).toBeUndefined();

		const unknown = await tool.handler(
			{ action: "cursor", doc: "poster", page: 1, row: "ghost" },
			NO_EXTRA,
		);
		expect(unknown.isError).toBe(true);
		expect(body(unknown)).toMatch(/"ghost" not found/);
		cleanup();
	});

	it("reports unbound pages with a bind hint", async () => {
		const { tool, store, documents, cleanup } = boundFixture();
		const doc = createDocument({
			name: "plain",
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
		const res = await tool.handler(
			{ action: "cursor", doc: "plain", page: 1 },
			NO_EXTRA,
		);
		expect(body(res)).toMatch(/has no data source/);
		cleanup();
	});
});
