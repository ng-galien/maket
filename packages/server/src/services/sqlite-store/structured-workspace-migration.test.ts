import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppContainer } from "../../bootstrap.js";
import type { Annotations } from "../annotations.js";
import { createConfig } from "../config.js";
import type { Documents } from "../documents.js";
import { createSQLiteStore, type Store } from "../store.js";
import type { StructuredWorkspaces } from "../structured-workspaces.js";
import { initializeSQLiteSchema } from "./schema.js";

const browserPool = {
	async get(): Promise<never> {
		throw new Error("Browser rendering is not used by this test");
	},
	async dispose() {},
};

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "maket-migration-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(tmp, { recursive: true, force: true });
});

function engine(store: Store) {
	const container = createAppContainer({
		browserPool,
		ensure: false,
		store,
		config: createConfig({
			env: { MAKET_DATA_DIR: tmp },
			homedir: () => "/nowhere",
		}),
	});
	const documents = container.resolve<Documents>("documents");
	documents.loadAll();
	return {
		documents,
		annotations: container.resolve<Annotations>("pending"),
		workspaces: container.resolve<StructuredWorkspaces>("structuredWorkspaces"),
	};
}

type Row = Record<string, unknown>;
const rows = (db: DatabaseSync, sql: string, ...params: string[]) =>
	db.prepare(sql).all(...params) as Row[];

/** A workspace created today, identified by a `legacy key` property that
 * no generated template shows. */
async function codedWorkspace(
	current: ReturnType<typeof engine>,
	spec: {
		name: string;
		properties: Record<string, unknown>;
		items: Array<Record<string, unknown>>;
	},
): Promise<string> {
	const workspace = current.workspaces.create({
		name: spec.name,
		dataSchema: {
			type: "object",
			properties: { ...spec.properties, "legacy key": { type: "string" } },
			required: ["title", "legacy key"],
			additionalProperties: false,
		},
		representationSchema: {
			version: 1,
			collections: { items: { name: "Items", identity: "/legacy key" } },
		},
	});
	for (const data of spec.items)
		await current.workspaces.addItem({
			workspace: workspace.id,
			collectionId: "items",
			bindingId: "item",
			documentName: `${spec.name} ${String(data["legacy key"])}`,
			data,
		});
	return workspace.id;
}

/** The workspaces given the shape they had at schema v21: no identity, no
 * `legacy key` property, the row ids being its former values. */
function withoutIdentity(raw: DatabaseSync): void {
	raw
		.prepare(
			`UPDATE structured_workspaces SET
				data_schema = json_remove(json_set(data_schema, '$.required', json('["title"]')), '$.properties."legacy key"'),
				representation_schema = json_remove(representation_schema, '$.collections.items.identity')
`,
		)
		.run();
	raw
		.prepare(
			`UPDATE structured_workspace_items SET data = json_remove(data, '$."legacy key"')`,
		)
		.run();
}

/** The items table and version of schema v21: a position, no counter. */
function toVersion21(raw: DatabaseSync): void {
	raw.exec(`
		DROP TABLE structured_workspace_sequences;
		CREATE TABLE structured_workspace_items_v21 (
			workspace_id  TEXT NOT NULL REFERENCES structured_workspaces(id) ON DELETE CASCADE,
			id            TEXT NOT NULL,
			position      INTEGER NOT NULL,
			collection_id TEXT NOT NULL,
			binding_id    TEXT NOT NULL,
			document_id   TEXT NOT NULL UNIQUE,
			document_name TEXT NOT NULL,
			data          TEXT CHECK (data IS NULL OR json_valid(data)),
			revision      INTEGER NOT NULL CHECK (revision > 0),
			created_at    TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (workspace_id, id),
			UNIQUE (workspace_id, collection_id, position),
			UNIQUE (workspace_id, document_name)
		);
		INSERT INTO structured_workspace_items_v21
			SELECT workspace_id, id, sequence - 1, collection_id, binding_id,
				document_id, document_name, data, revision, created_at
			FROM structured_workspace_items;
		DROP TABLE structured_workspace_items;
		ALTER TABLE structured_workspace_items_v21 RENAME TO structured_workspace_items;
		CREATE INDEX structured_workspace_items_document_name_idx
			ON structured_workspace_items(document_name);
		PRAGMA user_version = 21;
	`);
}

function sharedMemory(label: string): string {
	return `file:${label}-${Date.now()}-${Math.random()}?mode=memory&cache=shared`;
}

describe("schema v22: declared identity and insertion sequence", () => {
	it("migrates two v21 workspaces once: an id property holding the row ids, or the id property they already had; documents, annotations and pins keep resolving", async () => {
		const path = sharedMemory("identity");
		const raw = new DatabaseSync(path);
		const before = createSQLiteStore(path);
		const old = engine(before);
		const plain = await codedWorkspace(old, {
			name: "Plain",
			properties: { title: { type: "string" } },
			items: [
				{ title: "One", "legacy key": "p-1" },
				{ title: "Two", "legacy key": "p-2" },
			],
		});
		const keyed = await codedWorkspace(old, {
			name: "Keyed",
			properties: { title: { type: "string" }, id: { type: "string" } },
			items: [
				{ title: "Alpha", id: "k-1", "legacy key": "k-1" },
				{ title: "Beta", id: "k-2", "legacy key": "k-2" },
			],
		});
		const opened = old.workspaces.openItem(plain, "Plain p-1");
		if (!opened) throw new Error("Item document not created.");
		old.documents.pin(opened.name);
		old.annotations.create({
			id: "note-1",
			docName: opened.name,
			type: "note",
			text: "Keep me",
			ts: 1,
		});
		const revisions = Object.fromEntries(
			rows(raw, "SELECT id, revision FROM structured_workspaces").map((row) => [
				row.id,
				row.revision,
			]),
		);
		before.close();
		withoutIdentity(raw);
		toVersion21(raw);

		const log = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		const after = createSQLiteStore(path);
		const migrated = engine(after);
		const said = log.mock.calls.map(([line]) => String(line));
		log.mockRestore();

		expect(rows(raw, "PRAGMA user_version")).toEqual([{ user_version: 22 }]);
		expect(said).toEqual(
			expect.arrayContaining([
				'SQLite: Structured Workspace "Plain" collection "items" identifies its items by "/id" (row ids copied there)\n',
				'SQLite: Structured Workspace "Keyed" collection "items" identifies its items by "/id" (its existing id property)\n',
			]),
		);
		const definition = (id: string) => after.loadStructuredWorkspace(id);
		expect(definition(plain)).toMatchObject({
			revision: Number(revisions[plain]) + 1,
			dataSchema: {
				properties: { title: { type: "string" }, id: { type: "string" } },
				required: ["title", "id"],
			},
			representationSchema: { collections: { items: { identity: "/id" } } },
			itemCounts: { items: 2 },
		});
		expect(definition(keyed)).toMatchObject({
			revision: Number(revisions[keyed]) + 1,
			dataSchema: { required: ["title", "id"] },
			representationSchema: { collections: { items: { identity: "/id" } } },
		});
		expect(
			rows(
				raw,
				"SELECT workspace_id, id, sequence, json(data) AS data FROM structured_workspace_items ORDER BY workspace_id = ?, sequence",
				keyed,
			),
		).toEqual([
			{
				workspace_id: plain,
				id: "p-1",
				sequence: 1,
				data: '{"title":"One","id":"p-1"}',
			},
			{
				workspace_id: plain,
				id: "p-2",
				sequence: 2,
				data: '{"title":"Two","id":"p-2"}',
			},
			{
				workspace_id: keyed,
				id: "k-1",
				sequence: 1,
				data: '{"title":"Alpha","id":"k-1"}',
			},
			{
				workspace_id: keyed,
				id: "k-2",
				sequence: 2,
				data: '{"title":"Beta","id":"k-2"}',
			},
		]);
		expect(
			rows(
				raw,
				"SELECT workspace_id, last FROM structured_workspace_sequences ORDER BY workspace_id = ?",
				keyed,
			),
		).toEqual([
			{ workspace_id: plain, last: 2 },
			{ workspace_id: keyed, last: 2 },
		]);

		for (const id of [plain, keyed])
			expect(
				migrated.workspaces
					.check(id)
					.findings.filter((finding) => finding.severity === "error"),
				id,
			).toEqual([]);
		expect(migrated.workspaces.get(plain)?.pinnedItems).toEqual([
			expect.objectContaining({ id: "p-1", documentName: "Plain p-1" }),
		]);
		expect(migrated.workspaces.getItem(plain, "p-1")).toMatchObject({
			documentId: opened.id,
			data: { title: "One", id: "p-1" },
		});
		expect(migrated.workspaces.openItem(plain, "Plain p-1")?.id).toBe(
			opened.id,
		);
		expect(migrated.annotations.forDoc("Plain p-1")).toEqual([
			expect.objectContaining({ id: "note-1", text: "Keep me" }),
		]);
		const added = await migrated.workspaces.addItem({
			workspace: plain,
			collectionId: "items",
			bindingId: "item",
			documentName: "Plain p-3",
			data: { title: "Three", id: "p-3" },
		});
		expect(added.sequence).toBe(3);

		const snapshot = () =>
			JSON.stringify([
				rows(raw, "SELECT * FROM structured_workspaces ORDER BY id"),
				rows(raw, "SELECT * FROM structured_workspace_items ORDER BY id"),
			]);
		const settled = snapshot();
		initializeSQLiteSchema(raw);
		expect(snapshot()).toBe(settled);
		after.close();
		raw.close();
	});

	it("chooses another property when an existing id property holds other values, and says which", async () => {
		const path = sharedMemory("other-id");
		const raw = new DatabaseSync(path);
		const before = createSQLiteStore(path);
		const coded = await codedWorkspace(engine(before), {
			name: "Coded",
			properties: { title: { type: "string" }, id: { type: "string" } },
			items: [
				{ title: "Alpha", id: "external-1", "legacy key": "c-1" },
				{ title: "Beta", id: "external-2", "legacy key": "c-2" },
			],
		});
		before.close();
		withoutIdentity(raw);
		toVersion21(raw);

		const log = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		const after = createSQLiteStore(path);
		const said = log.mock.calls.map(([line]) => String(line));
		log.mockRestore();

		expect(said).toContain(
			'SQLite: Structured Workspace "Coded" collection "items" identifies its items by "/itemId" (row ids copied there)\n',
		);
		expect(after.loadStructuredWorkspace(coded)).toMatchObject({
			dataSchema: {
				properties: { id: { type: "string" }, itemId: { type: "string" } },
				required: ["title", "itemId"],
			},
			representationSchema: {
				collections: { items: { identity: "/itemId" } },
			},
		});
		expect(after.loadStructuredWorkspaceItem(coded, "c-1")?.data).toEqual({
			title: "Alpha",
			id: "external-1",
			itemId: "c-1",
		});
		after.close();
		raw.close();
	});
});
