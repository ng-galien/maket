import { describe, expect, it } from "vitest";
import { createBus } from "../services/bus.js";
import { createCollections } from "../services/collections.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore } from "../services/store.js";
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
	return {
		store,
		collections,
		tool: createMaketCollectionTool({ collections }),
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
		expect(collectionsPack.requires).toEqual(["collections"]);
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
