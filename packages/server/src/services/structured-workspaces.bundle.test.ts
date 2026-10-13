import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAppContainer } from "../bootstrap.js";
import { decodeBundle } from "../lib/maket-format.js";
import { createDocument } from "../types.js";
import type { Annotations } from "./annotations.js";
import type { BundleExportService } from "./bundle-export.js";
import type { BundleImportService } from "./bundle-import.js";
import { createConfig } from "./config.js";
import type { DocumentStates } from "./document-states.js";
import type { Documents } from "./documents.js";
import { createSQLiteStore, type Store } from "./store.js";
import type { StructuredWorkspaces } from "./structured-workspaces.js";

const browserPool = {
	async get(): Promise<never> {
		throw new Error("Browser rendering is not used by this test");
	},
	async dispose() {},
};

const schema = {
	type: "object",
	properties: {
		title: { type: "string" },
		code: { type: "string" },
		status: { type: "string" },
	},
	required: ["title", "code"],
	additionalProperties: false,
};

let tmp: string;
const stores: Store[] = [];
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "maket-bundle-"));
});
afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	rmSync(tmp, { recursive: true, force: true });
});

function maket() {
	const store = createSQLiteStore(":memory:");
	stores.push(store);
	const container = createAppContainer({
		browserPool,
		ensure: false,
		store,
		config: createConfig({
			env: { MAKET_DATA_DIR: tmp },
			homedir: () => "/nowhere",
		}),
	});
	const resolve = <T>(name: string) => container.resolve<T>(name);
	const documents = resolve<Documents>("documents");
	documents.loadAll();
	return {
		store,
		documents,
		documentStates: resolve<DocumentStates>("documentStates"),
		annotations: resolve<Annotations>("pending"),
		workspaces: resolve<StructuredWorkspaces>("structuredWorkspaces"),
		bundleExport: resolve<BundleExportService>("bundleExportService"),
		bundleImport: resolve<BundleImportService>("bundleImportService"),
	};
}

async function workspaceWith(
	current: ReturnType<typeof maket>,
	name: string,
	codes: string[],
): Promise<string> {
	const workspace = current.workspaces.create({
		name,
		dataSchema: schema,
		representationSchema: {
			version: 1,
			collections: { items: { name: "Items", identity: "/code" } },
		},
	});
	for (const code of codes)
		await current.workspaces.addItem({
			workspace: workspace.id,
			collectionId: "items",
			bindingId: "item",
			documentName: `${name} ${code}`,
			data: { title: `${name} ${code}`, code },
		});
	return workspace.id;
}

describe("Structured Workspaces in a .maket bundle", () => {
	it("carries definitions and item rows of two workspaces, item documents rendered without state; an import rebuilds the rows and reconnects the documents", async () => {
		const source = maket();
		const alpha = await workspaceWith(source, "Alpha", ["a-1", "a-2", "a-3"]);
		const beta = await workspaceWith(source, "Beta", ["b-1", "b-2"]);
		await source.workspaces.updateItem("Alpha", "a-2", 1, {
			title: "Alpha two, edited",
			code: "a-2",
			status: "done",
		});
		await source.workspaces.deleteItem("Alpha", "a-3");
		const opened = source.workspaces.openItem(alpha, "Alpha a-1");
		if (!opened) throw new Error("Item document not created.");
		source.annotations.create({
			id: "note-a-1",
			docName: opened.name,
			type: "note",
			text: "Check the title",
			ts: 1,
		});

		const built = await source.bundleExport.build({ includeAssets: false });
		if (!built.ok) throw new Error(built.message);
		expect(built.itemsLeftOut).toEqual([]);
		const bundle = await decodeBundle(built.buffer);
		const snapshots = new Map(
			bundle.structuredWorkspaces.map((snapshot) => [
				snapshot.workspace.name,
				snapshot,
			]),
		);
		expect(
			snapshots
				.get("Alpha")
				?.items.map(({ id, data, revision }) => ({ id, data, revision })),
		).toEqual([
			{ id: "a-1", data: { title: "Alpha a-1", code: "a-1" }, revision: 1 },
			{
				id: "a-2",
				data: { title: "Alpha two, edited", code: "a-2", status: "done" },
				revision: 2,
			},
		]);
		expect(snapshots.get("Beta")?.items.map(({ id }) => id)).toEqual([
			"b-1",
			"b-2",
		]);
		const itemDocumentIds = new Set(
			[...snapshots.values()].flatMap((snapshot) =>
				snapshot.items.flatMap((item) =>
					item.documentId ? [item.documentId] : [],
				),
			),
		);
		expect(itemDocumentIds.size).toBe(4);
		expect(
			bundle.documentStates.filter((state) =>
				itemDocumentIds.has(state.documentId),
			),
		).toEqual([]);
		const bundledAlphaOne = bundle.documents.find(
			(document) => document.name === "Alpha a-1",
		);
		expect(bundledAlphaOne?.dataModel).toBe("static");
		expect(JSON.stringify(bundledAlphaOne?.pages)).toContain("Alpha a-1");
		expect(source.documents.resolve("Alpha a-2")).toBeNull();
		expect(source.documents.resolve("Alpha a-1")).toBe(opened);

		const target = maket();
		const restored = target.bundleImport.restore(bundle);
		expect(restored.structuredWorkspacesImported.sort()).toEqual([
			"Alpha",
			"Beta",
		]);
		const imported = (name: string) => {
			const view = target.workspaces.get(name);
			if (!view) throw new Error(`${name} not imported.`);
			return view;
		};
		expect(imported("Alpha").itemCounts).toEqual({ items: 2 });
		expect(imported("Beta").itemCounts).toEqual({ items: 2 });
		for (const name of ["Alpha", "Beta"])
			expect(target.workspaces.check(name).verdict).toBe("ready");
		const alphaId = imported("Alpha").id;
		expect(target.workspaces.getItem(alphaId, "a-2")).toMatchObject({
			sequence: 2,
			dataRevision: 2,
			data: { title: "Alpha two, edited", code: "a-2", status: "done" },
		});
		const reopened = target.workspaces.openItem(alphaId, "Alpha a-1");
		expect(reopened?.meta.structuredWorkspace).toMatchObject({
			role: "item",
			workspaceId: alphaId,
			itemId: "a-1",
		});
		expect(reopened?.pages[0]?.html).toContain("{{ state.title }}");
		expect(target.documentStates.get("Alpha a-1")?.current).toMatchObject({
			revision: 1,
			data: { title: "Alpha a-1", code: "a-1" },
		});
		expect(target.annotations.forDoc("Alpha a-1")).toEqual([
			expect.objectContaining({ text: "Check the title" }),
		]);
		expect(beta).not.toBe(imported("Beta").id);
	});

	it("imports a bundle written by the d4e9b23 engine into a workspace with the identity migration v22 declares: add_item and update_item work, check is ready", async () => {
		const bundle = await decodeBundle(
			readFileSync(
				new URL(
					"./fixtures/structured-workspace-d4e9b23.maket",
					import.meta.url,
				),
			),
		);
		const [old] = bundle.structuredWorkspaces;
		expect(
			old?.workspace.representationSchema.collections.items,
		).not.toHaveProperty("identity");
		const target = maket();
		expect(
			target.bundleImport.restore(bundle).structuredWorkspacesImported,
		).toEqual(["Old"]);
		const view = target.workspaces.get("Old");
		if (!view) throw new Error("Old not imported.");
		expect(view.representationSchema.collections.items?.identity).toBe("/id");
		expect(view.dataSchema).toMatchObject({
			properties: { title: { type: "string" }, id: { type: "string" } },
			required: ["title", "id"],
		});
		expect(target.workspaces.getItem(view.id, "old1")?.data).toEqual({
			title: "First",
			id: "old1",
		});
		expect(target.workspaces.check("Old").verdict).toBe("ready");
		await expect(
			target.workspaces.addItem({
				workspace: "Old",
				collectionId: "items",
				bindingId: "item",
				documentName: "Old Third",
				data: { title: "Third", id: "old3" },
			}),
		).resolves.toMatchObject({ id: "old3", sequence: 3 });
		await expect(
			target.workspaces.updateItem("Old", "old2", 1, {
				title: "Second, edited",
				id: "old2",
			}),
		).resolves.toMatchObject({ dataRevision: 2 });
		expect(
			target.workspaces.openItem(view.id, "Old First")?.meta
				.structuredWorkspace,
		).toMatchObject({
			itemId: "old1",
		});
		expect(target.documentStates.get("Old First")?.current.data).toEqual({
			title: "First",
			id: "old1",
		});
	});

	it("reports the items whose document an export without a name list leaves out, and keeps their workspace", async () => {
		const current = maket();
		await workspaceWith(current, "Gamma", ["g-1", "g-2"]);
		const holder = createDocument({
			name: "Gamma g-2",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
		});
		current.store.saveDoc(holder);
		const built = await current.bundleExport.build({ includeAssets: false });
		if (!built.ok) throw new Error(built.message);
		expect(built.itemsLeftOut).toEqual([
			{
				workspace: "Gamma",
				item: "g-2",
				documentName: "Gamma g-2",
				reason: 'another document bears the name "Gamma g-2"',
			},
		]);
		const bundle = await decodeBundle(built.buffer);
		expect(bundle.structuredWorkspaces.map((s) => s.workspace.name)).toEqual([
			"Gamma",
		]);
		expect(
			bundle.structuredWorkspaces[0]?.items.map(({ id, documentId }) => ({
				id,
				bundled: documentId !== undefined,
			})),
		).toEqual([
			{ id: "g-1", bundled: true },
			{ id: "g-2", bundled: false },
		]);
	});

	it("keeps only the item document an annotation lands on during an export; the export releases the others", async () => {
		const current = maket();
		await workspaceWith(current, "Delta", ["d-1", "d-2", "d-3"]);
		const pending = current.bundleExport.build({
			names: ["Delta d-1", "Delta d-2", "Delta d-3"],
			includeAssets: false,
		});
		current.annotations.create({
			id: "note-d-2",
			docName: "Delta d-2",
			type: "note",
			text: "Keep this one",
			ts: 1,
		});
		const built = await pending;
		expect(built.ok).toBe(true);
		expect(current.store.loadOne("Delta d-2")).not.toBeNull();
		expect(current.store.loadOne("Delta d-1")).toBeNull();
		expect(current.store.loadOne("Delta d-3")).toBeNull();
	});
});
