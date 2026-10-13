import crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppContainer } from "../bootstrap.js";
import { createMaketStructuredWorkspaceTool } from "../tools/structured-workspaces.js";
import { createConfig } from "./config.js";
import type { Documents } from "./documents.js";
import type { ItemWindows } from "./item-windows.js";
import { createSQLiteStore, type Store } from "./store.js";
import {
	isStructuredWorkspaceRefusal,
	type StructuredWorkspaces,
} from "./structured-workspaces.js";

const browserPool = {
	async get(): Promise<never> {
		throw new Error("Browser rendering is not used by this test");
	},
	async dispose() {},
};

const books = {
	type: "object",
	properties: {
		title: { type: "string" },
		isbn: { type: "string" },
		year: { type: "integer" },
		note: { type: "string" },
	},
	required: ["title", "isbn"],
	additionalProperties: false,
};

const shelves = {
	version: 1 as const,
	collections: {
		fiction: { name: "Fiction", identity: "/isbn" },
		essays: { name: "Essays", identity: "/isbn" },
	},
};

let tmp: string;
let store: Store;
let workspaces: StructuredWorkspaces;
let documents: Documents;
let tool: ReturnType<typeof createMaketStructuredWorkspaceTool>;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "maket-identity-"));
	store = createSQLiteStore(":memory:");
	const container = createAppContainer({
		browserPool,
		ensure: false,
		store,
		config: createConfig({
			env: { MAKET_DATA_DIR: tmp },
			homedir: () => "/nowhere",
		}),
	});
	documents = container.resolve<Documents>("documents");
	documents.loadAll();
	workspaces = container.resolve<StructuredWorkspaces>("structuredWorkspaces");
	tool = createMaketStructuredWorkspaceTool({
		structuredWorkspaces: workspaces,
		itemWindows: container.resolve<ItemWindows>("itemWindows"),
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	store.close();
	rmSync(tmp, { recursive: true, force: true });
});

const textOf = (result: CallToolResult) =>
	result.content
		.flatMap((item) => (item.type === "text" ? [item.text] : []))
		.join("\n");

async function refusalOf(run: () => unknown): Promise<Error> {
	try {
		await run();
	} catch (error) {
		return error as Error;
	}
	throw new Error("The call was not refused.");
}

function library() {
	return workspaces.create({
		name: "Library",
		dataSchema: books,
		representationSchema: shelves,
	});
}

const add = (collectionId: string, data: Record<string, unknown>) =>
	workspaces.addItem({
		workspace: "Library",
		collectionId,
		bindingId: "item",
		documentName: `Book ${String(data.title)} in ${collectionId}`,
		data,
	});

describe("declared identity of a collection", () => {
	it("refuses create and update_definition for a collection without identity or with an unusable one, one fix each", async () => {
		const created = await refusalOf(() =>
			workspaces.create({ name: "Library", dataSchema: books }),
		);
		if (!isStructuredWorkspaceRefusal(created)) throw created;
		expect(created.findings).toEqual([
			expect.objectContaining({
				path: "representation_schema.collections.items.identity",
				message: expect.stringContaining(
					'Collection "items" declares no identity',
				),
				fix: 'Add a required property "id" of type string to data_schema and give each item its own value, unique across the whole Workspace and never changed: Maket then identifies the items by "/id". Or set representation_schema.collections.items.identity to a property that already holds such a value.',
			}),
		]);
		for (const [identity, problem] of [
			["/note", "names an optional property"],
			["/year", "names an optional property"],
			["/missing", "names no property of the data schema"],
		] as const) {
			const refused = await refusalOf(() =>
				workspaces.create({
					name: "Library",
					dataSchema: books,
					representationSchema: {
						collections: { items: { name: "Items", identity } },
					},
				}),
			);
			if (!isStructuredWorkspaceRefusal(refused)) throw refused;
			expect(refused.findings.map((finding) => finding.message)).toEqual([
				`Collection "items" identity "${identity}" ${problem}.`,
			]);
		}
		expect(workspaces.list()).toEqual([]);

		const workspace = library();
		const updated = await refusalOf(() =>
			workspaces.updateDefinition({
				workspace: workspace.id,
				expectedRevision: workspace.revision,
				representationSchema: {
					collections: { poetry: { name: "Poetry" } },
				},
			}),
		);
		if (!isStructuredWorkspaceRefusal(updated)) throw updated;
		expect(updated.findings).toEqual([
			expect.objectContaining({
				collection: "poetry",
				path: "representation_schema.collections.poetry.identity",
			}),
		]);
		expect(workspaces.get(workspace.id)?.revision).toBe(workspace.revision);
	});

	it("creates from a data schema alone with /id as identity when the schema requires an id, says so, and otherwise asks for an id and never for a descriptive field", async () => {
		const withId = {
			...books,
			properties: { ...books.properties, id: { type: "string" } },
			required: ["title", "id"],
		};
		const created = await tool.handler(
			{ action: "create", workspace: "Shelf", data_schema: withId },
			{} as never,
		);
		expect(created.isError).toBeUndefined();
		expect(textOf(created)).toContain(
			'Identity: no identity was given for collection "items"; its items are identified by "/id", the required id property of the data schema (unique across the whole Workspace, never changed).',
		);
		expect(
			workspaces.get("Shelf")?.representationSchema.collections.items?.identity,
		).toBe("/id");
		await expect(
			workspaces.addItem({
				workspace: "Shelf",
				collectionId: "items",
				bindingId: "item",
				documentName: "Shelf Dune",
				data: { title: "Dune", isbn: "978-1", id: "dune" },
			}),
		).resolves.toMatchObject({ id: "dune" });
		const declared = await tool.handler(
			{
				action: "create",
				workspace: "Declared",
				data_schema: withId,
				representation_schema: {
					collections: { items: { name: "Items", identity: "/isbn" } },
				},
			},
			{} as never,
		);
		expect(textOf(declared)).not.toContain("Identity: no identity");

		const refused = await tool.handler(
			{ action: "create", workspace: "Library", data_schema: books },
			{} as never,
		);
		expect(refused.isError).toBe(true);
		expect(textOf(refused)).toContain(
			'Add a required property "id" of type string to data_schema',
		);
		expect(textOf(refused)).not.toMatch(/\/title/);
		expect(textOf(refused)).toContain(
			'data_schema=<schema with a required "id" property of type string>',
		);
	});

	it("adds an item under the id its identity holds, refusing a missing value (naming the field) and a value another item bears (naming that item), never generating an id", async () => {
		const workspace = library();
		const uuid = vi.spyOn(crypto, "randomUUID");
		const dune = await add("fiction", { title: "Dune", isbn: "978-1" });
		expect(dune).toMatchObject({ id: "978-1", collectionId: "fiction" });
		expect(uuid).not.toHaveBeenCalled();

		const missing = await refusalOf(() => add("fiction", { title: "No isbn" }));
		expect(missing).toMatchObject({ code: "invalid_record" });
		expect(missing.message).toBe(
			'Item data has no identity: add "/isbn" to data, a non-empty string or a number that identifies the item in collection "fiction".',
		);
		const sameCollection = await refusalOf(() =>
			add("fiction", { title: "Dune again", isbn: "978-1" }),
		);
		expect(sameCollection).toMatchObject({ code: "invalid_record" });
		expect(sameCollection.message).toBe(
			'Item "978-1" already exists in collection "fiction" of "Library" (document "Book Dune in fiction"): an identity value is unique across the whole Workspace.',
		);
		const otherCollection = await refusalOf(() =>
			add("essays", { title: "Dune essay", isbn: "978-1" }),
		);
		expect(otherCollection.message).toContain(
			'Item "978-1" already exists in collection "fiction"',
		);
		const wrongId = await refusalOf(() =>
			workspaces.addItem({
				workspace: "Library",
				itemId: "other",
				collectionId: "fiction",
				bindingId: "item",
				documentName: "Wrong",
				data: { title: "Wrong", isbn: "978-9" },
			}),
		);
		expect(wrongId.message).toContain(
			'Item id "other" differs from the identity "/isbn" of the data, "978-9"',
		);
		expect(workspaces.get(workspace.id)?.itemCounts).toEqual({
			fiction: 1,
			essays: 0,
		});

		const answer = await tool.handler(
			{
				action: "add_item",
				workspace: "Library",
				collection: "fiction",
				binding: "item",
				document_name: "Dune copy",
				data: { title: "Dune copy", isbn: "978-1" },
			},
			{} as never,
		);
		expect(answer.isError).toBe(true);
		expect(textOf(answer)).toMatch(
			/^invalid_record: Item "978-1" already exists/,
		);
	});

	it("refuses an update that changes or drops the identity value, and a new identity for a collection holding items", async () => {
		const workspace = library();
		await add("fiction", { title: "Dune", isbn: "978-1" });
		for (const data of [{ title: "Dune", isbn: "978-2" }, { title: "Dune" }]) {
			const refused = await refusalOf(() =>
				workspaces.updateItem("Library", "978-1", 1, data),
			);
			expect(refused).toMatchObject({ code: "invalid_record" });
			expect(refused.message).toContain(
				'Item "978-1" keeps its identity: "/isbn" must stay "978-1"',
			);
		}
		await expect(
			workspaces.updateItem("Library", "978-1", 1, {
				title: "Dune (1965)",
				isbn: "978-1",
			}),
		).resolves.toMatchObject({ id: "978-1", dataRevision: 2 });

		const repointed = await refusalOf(() =>
			workspaces.updateDefinition({
				workspace: workspace.id,
				expectedRevision: workspace.revision,
				representationSchema: {
					collections: {
						fiction: { identity: "/title" },
						essays: { identity: "/title" },
					},
				},
				allowIncomplete: true,
			}),
		);
		if (!isStructuredWorkspaceRefusal(repointed)) throw repointed;
		expect(repointed.findings).toEqual([
			expect.objectContaining({
				collection: "fiction",
				message:
					'Collection "fiction" holds 1 item(s) known by "/isbn"; its identity cannot change.',
			}),
		]);
		const essaysOnly = workspaces.updateDefinition({
			workspace: workspace.id,
			expectedRevision: workspace.revision,
			representationSchema: {
				collections: {
					fiction: {},
					essays: { identity: "/title" },
				},
			},
		});
		expect(essaysOnly.representationSchema.collections).toMatchObject({
			fiction: { identity: "/isbn" },
			essays: { identity: "/title" },
		});
	});

	it("check reports a collection, a record and a document in breach of the identity", async () => {
		const workspace = library();
		const dune = await add("fiction", { title: "Dune", isbn: "978-1" });
		await add("fiction", { title: "Emma", isbn: "978-2" });
		store.putStructuredWorkspaceItem(workspace.id, "978-2", 1, {
			title: "Emma",
			isbn: "978-3",
		});
		const opened = workspaces.openItem(workspace.id, dune.documentName);
		if (!opened?.meta.structuredWorkspace) throw new Error("Not opened.");
		opened.meta.structuredWorkspace = {
			...opened.meta.structuredWorkspace,
			role: "item",
			itemId: "someone-else",
		} as typeof opened.meta.structuredWorkspace;
		documents.persist(opened.name);
		const current = store.loadStructuredWorkspace(workspace.id);
		if (!current) throw new Error("Workspace missing.");
		const representation = structuredClone(current.representationSchema);
		delete representation.collections.essays?.identity;
		store.updateStructuredWorkspace(
			workspace.id,
			current.revision,
			books,
			representation,
		);

		const findings = workspaces.check(workspace.id).findings;
		expect(findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					collection: "essays",
					path: "representation_schema.collections.essays.identity",
					severity: "error",
				}),
				expect.objectContaining({
					collection: "fiction",
					path: 'item "978-2" /isbn',
					message: 'Item "978-2" does not hold its id at the identity "/isbn".',
				}),
				expect.objectContaining({
					collection: "fiction",
					path: `document "${dune.documentName}"`,
					message: `Document "${dune.documentName}" renders item "978-1" but names item "someone-else".`,
				}),
			]),
		);
	});

	it("generates a detail form that shows the identity read-only", () => {
		library();
		const detail = documents.resolve("Library — Fiction — detail template");
		expect(detail?.pages[1]?.jsonForms?.uischema).toMatchObject({
			elements: expect.arrayContaining([
				{
					type: "Control",
					scope: "#/properties/isbn",
					options: { readonly: true },
				},
				{ type: "Control", scope: "#/properties/title" },
			]),
		});
	});
});
