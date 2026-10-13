import crypto from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMaketStructuredWorkspaceTool } from "../tools/structured-workspaces.js";
import type { Document } from "../types.js";
import { createBus } from "./bus.js";
import { createDocumentStates } from "./document-states.js";
import { createDocuments } from "./documents.js";
import { isItemSourceError } from "./item-sources/item-source-error.js";
import { createItemSources } from "./item-sources/item-sources.js";
import type { PageFlow, PageFlowRequest } from "./page-flow.js";
import { createSQLiteStore } from "./store.js";
import {
	createStructuredWorkspaces,
	type StructuredWorkspaces,
	type StructuredWorkspacesDeps,
} from "./structured-workspaces.js";

const snapshots = "./__snapshots__/structured-workspaces.review-cases";

const flowedPageCards = 4;

function flowCount(request: PageFlowRequest, list: string): number {
	return request.full.html.split(`<!--maket-flow:${list}:`).length - 1;
}

const pageFlow: Pick<PageFlow, "pages"> = {
	pages(request) {
		const counts = request.full.lists.map((list) => flowCount(request, list));
		const chunks = Math.max(
			1,
			...counts.map((count) => Math.ceil(count / flowedPageCards)),
		);
		if (chunks <= 1) return null;
		return Array.from({ length: chunks }, (_, page) =>
			Object.fromEntries(
				request.full.lists.map((list, index) => {
					const count = counts[index] ?? 0;
					const start = Math.min(page * flowedPageCards, count);
					const end =
						page === chunks - 1
							? null
							: Math.min(start + flowedPageCards, count);
					return [list, [start, end]];
				}),
			),
		);
	},
};

function engine(
	deps: Omit<StructuredWorkspacesDeps, "itemSources">,
): StructuredWorkspaces {
	return createStructuredWorkspaces({
		...deps,
		itemSources: createItemSources(deps),
	});
}

function scenario() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const documentStates = createDocumentStates({ store, bus, documents });
	const workspaces = engine({
		store,
		bus,
		documents,
		documentStates,
		pageFlow,
	});
	const tool = createMaketStructuredWorkspaceTool({
		structuredWorkspaces: workspaces,
	});
	return { store, bus, documents, documentStates, workspaces, tool };
}

type Scenario = ReturnType<typeof scenario>;

const masked = (text: string) =>
	text.replace(/"(createdAt|updatedAt)": ?"[^"]*"/g, '"$1":"<now>"');

const textOf = (result: CallToolResult) =>
	result.content
		.flatMap((item) => (item.type === "text" ? [item.text] : []))
		.join("\n");

const pagesOf = (document: Document) =>
	JSON.stringify(
		document.pages.map((page) => ({
			id: page.id,
			name: page.name,
			html: page.html,
		})),
	);

async function call(current: Scenario, args: Record<string, unknown>) {
	try {
		const result = await current.tool.handler(args as never, {} as never);
		return `${result.isError ? "ERR " : ""}${masked(textOf(result))}`;
	} catch (error) {
		return `THROW ${(error as Error).message}`;
	}
}

function safe(run: () => string): string {
	try {
		return run();
	} catch (error) {
		return `THROW ${(error as Error).message}`;
	}
}

async function capture(
	current: Scenario,
	workspaceId: string,
	collections: string[],
	extra: string[] = [],
) {
	const out: Record<string, string> = {};
	for (const collectionId of collections) {
		out[`index:${collectionId}`] = safe(() =>
			pagesOf(current.workspaces.renderCollection(workspaceId, collectionId)),
		);
		out[`index-cached:${collectionId}`] = safe(() =>
			pagesOf(current.workspaces.renderCollection(workspaceId, collectionId)),
		);
	}
	out.listViews = safe(() =>
		masked(JSON.stringify(current.workspaces.listViews())),
	);
	out.get = safe(() =>
		masked(JSON.stringify(current.workspaces.get(workspaceId))),
	);
	out.mcpView = await call(current, { action: "view", workspace: workspaceId });
	out.mcpCheck = await call(current, {
		action: "check",
		workspace: workspaceId,
	});
	for (const itemId of extra)
		out[`getItem:${itemId}`] = safe(() =>
			masked(JSON.stringify(current.workspaces.getItem(workspaceId, itemId))),
		);
	return out;
}

const schema = {
	type: "object",
	properties: {
		title: { type: "string" },
		status: { type: "string", enum: ["todo", "doing", "done"] },
		priority: { type: "number" },
		address: {
			type: "object",
			properties: { city: { type: "string" } },
			additionalProperties: false,
		},
	},
	required: ["title", "status"],
	additionalProperties: false,
};

async function add(
	current: Scenario,
	workspace: string,
	collectionId: string,
	count: number,
	data: (index: number) => Record<string, unknown> = (index) => ({
		title: `T${index}`,
		status: ["todo", "doing", "done"][index % 3],
		...(index % 4 ? { priority: index % 5 } : {}),
		address: { city: ["Lyon", "Brest"][index % 2] },
	}),
) {
	const added = [];
	for (let i = 0; i < count; i += 1)
		added.push(
			await current.workspaces.addItem({
				workspace,
				itemId: `${collectionId}-${i + 1}`,
				collectionId,
				bindingId: "item",
				documentName: `${workspace} ${collectionId} ${i + 1}`,
				data: data(i + 1),
			}),
		);
	return added;
}

interface Case {
	name: string;
	run: (current: Scenario) => Promise<Record<string, string>>;
}

const cases: Case[] = [
	{
		name: "empty-collection",
		async run(current) {
			const ws = current.workspaces.create({
				name: "Empty",
				dataSchema: schema,
			});
			return capture(current, ws.id, ["items"]);
		},
	},
	{
		name: "two-collections-grouped-sorted",
		async run(current) {
			const ws = current.workspaces.create({
				name: "Two",
				dataSchema: schema,
				representationSchema: {
					version: 1,
					collections: {
						open: { name: "Open" },
						board: {
							name: "Board",
							groupBy: "/address/city",
							sortBy: "/priority",
							sortDirection: "descending",
						},
					},
				},
			});
			await add(current, ws.name, "open", 5);
			await add(current, ws.name, "board", 7);
			return capture(current, ws.id, ["open", "board"], ["open-2", "board-3"]);
		},
	},
	{
		name: "stored-data-missing-required-field",
		async run(current) {
			const ws = current.workspaces.create({
				name: "Broken",
				dataSchema: schema,
			});
			const [first] = await add(current, ws.name, "items", 3);
			current.store.putStructuredWorkspaceItem(ws.id, first?.id ?? "", 1, {
				status: "todo",
			});
			return {
				current: JSON.stringify(
					current.store.loadStructuredWorkspaceItem(ws.id, first?.id ?? "")
						?.data,
				),
				...(await capture(current, ws.id, ["items"], ["items-1", "items-2"])),
			};
		},
	},
	{
		name: "deleted-item",
		async run(current) {
			const ws = current.workspaces.create({
				name: "Deleted",
				dataSchema: schema,
			});
			await add(current, ws.name, "items", 4);
			await current.workspaces.deleteItem(ws.name, "items-2");
			return capture(current, ws.id, ["items"], ["items-2", "items-3"]);
		},
	},
	{
		name: "item-document-gone-from-registry",
		async run(current) {
			const ws = current.workspaces.create({
				name: "Orphan",
				dataSchema: schema,
			});
			const [first] = await add(current, ws.name, "items", 3);
			current.workspaces.openItem(ws.id, first?.documentName ?? "");
			current.documents.all().delete(first?.documentName ?? "");
			return capture(current, ws.id, ["items"], ["items-1", "items-2"]);
		},
	},
	{
		name: "update-item-wrong-revision",
		async run(current) {
			const ws = current.workspaces.create({
				name: "Stale",
				dataSchema: schema,
			});
			await add(current, ws.name, "items", 3);
			const refused = await call(current, {
				action: "update_item",
				workspace: ws.name,
				item: "items-2",
				expected_revision: 7,
				data: { title: "New", status: "done" },
			});
			const accepted = await call(current, {
				action: "update_item",
				workspace: ws.name,
				item: "items-3",
				expected_revision: 1,
				data: { title: "New", status: "done" },
			});
			return {
				refused,
				accepted,
				...(await capture(current, ws.id, ["items"], ["items-3"])),
			};
		},
	},
	{
		name: "locked-item-document",
		async run(current) {
			const ws = current.workspaces.create({
				name: "Locked",
				dataSchema: schema,
			});
			const [first] = await add(current, ws.name, "items", 3);
			const document = current.workspaces.openItem(
				ws.id,
				first?.documentName ?? "",
			);
			if (document) document.meta.locked = true;
			const refused = await call(current, {
				action: "update_item",
				workspace: ws.name,
				item: "items-1",
				expected_revision: 1,
				data: { title: "New", status: "done" },
			});
			const deleteRefused = await call(current, {
				action: "delete_item",
				workspace: ws.name,
				item: "items-1",
			});
			return {
				refused,
				deleteRefused,
				...(await capture(current, ws.id, ["items"], ["items-1"])),
			};
		},
	},
	{
		name: "card-nested-section-additional-property",
		async run(current) {
			const created = await call(current, {
				action: "create",
				workspace: "Nested",
				data_schema: {
					...schema,
					properties: { ...schema.properties, notes: { type: "string" } },
					additionalProperties: true,
				},
				representation_schema: {
					version: 1,
					collections: {
						items: {
							name: "Items",
							compactTemplateHtml:
								'<article data-maket-compact-root data-id="c"><h3 data-id="t">{{ state.title }}</h3>{{#state.address}}<p data-id="a">{{ state.address.city }}</p>{{/state.address}}<i data-id="n">{{ state.notes }}</i></article>',
							detailTemplateHtml: '<h1 data-id="t">{{ state.title }}</h1>',
						},
					},
				},
			});
			const ws = current.workspaces.get("Nested");
			if (!ws) return { created };
			await add(current, ws.name, "items", 3, (index) => ({
				title: `T${index}`,
				status: "todo",
				notes: `n${index}`,
				hidden: `h${index}`,
				...(index === 2 ? {} : { address: { city: "Lyon" } }),
			}));
			return { created, ...(await capture(current, ws.id, ["items"])) };
		},
	},
];

let sequence = 0;

beforeEach(() => {
	sequence = 0;
	vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
		sequence += 1;
		return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function outputOf(run: Case["run"]): Promise<Record<string, string>> {
	const current = scenario();
	try {
		return await run(current);
	} catch (error) {
		return { setup: `THROW ${(error as Error).message}` };
	} finally {
		current.store.close();
	}
}

describe("Structured Workspaces stay byte-identical to HEAD on the review cases", () => {
	it.each(cases)("$name", async ({ name, run }) => {
		const output = await outputOf(run);
		await expect(JSON.stringify(output, null, 2)).toMatchFileSnapshot(
			`${snapshots}/${name}.snap`,
		);
	});
});

describe("the local item source writes rows at a revision", () => {
	it("answers stale, unknown and duplicate refusals with their code, the engine answers lock and invalid data, and closes on deletion", async () => {
		const current = scenario();
		const sources = createItemSources(current);
		const ws = current.workspaces.create({ name: "Src", dataSchema: schema });
		await add(current, ws.name, "items", 2);
		const source = sources.sourceFor(ws.id);
		const codeOf = async (run: () => Promise<unknown>) => {
			try {
				await run();
				return "ok";
			} catch (error) {
				return isItemSourceError(error) ? error.code : (error as Error).message;
			}
		};
		const document = current.workspaces.openItem(ws.id, `${ws.name} items 1`);
		if (document) document.meta.locked = true;
		const lockedUpdate = await codeOf(async () =>
			current.workspaces.updateItem(ws.name, "items-1", 1, {
				title: "x",
				status: "todo",
			}),
		);
		const lockedDelete = await codeOf(async () =>
			current.workspaces.deleteItem(ws.name, "items-1"),
		);
		if (document) document.meta.locked = false;
		const results = {
			lockedUpdate,
			lockedDelete,
			invalidData: (
				await codeOf(async () =>
					current.workspaces.updateItem(ws.name, "items-2", 1, {
						status: "todo",
					}),
				)
			).split("\n")[0],
			engineStale: await codeOf(async () =>
				current.workspaces.updateItem(ws.name, "items-2", 9, {
					title: "x",
					status: "todo",
				}),
			),
			stale: await codeOf(async () =>
				source.put?.("items-2", { title: "x", status: "todo" }, "9"),
			),
			unknownPut: await codeOf(async () =>
				source.put?.("nope", { title: "x", status: "todo" }, "1"),
			),
			unknownDelete: await codeOf(async () => source.delete?.("nope")),
			duplicateCreate: await codeOf(async () =>
				source.create?.({
					collectionId: "items",
					bindingId: "item",
					id: "items-2",
					data: { title: "x", status: "todo" },
					document: { id: "d", name: "d" },
				}),
			),
			withoutDocument: await codeOf(async () =>
				source.create?.({
					collectionId: "items",
					bindingId: "item",
					id: "items-3",
					data: { title: "x", status: "todo" },
				}),
			),
			staleDelete: await codeOf(async () => source.delete?.("items-2", "5")),
			written: await codeOf(async () =>
				source.put?.("items-2", { title: "y", status: "done" }, "1"),
			),
		};
		const row = current.store.loadStructuredWorkspaceItem(ws.id, "items-2");
		current.workspaces.delete(ws.name);
		const afterDelete = await codeOf(async () =>
			source.list({ collectionId: "items", limit: 10 }),
		);
		const reopened = sources.sourceFor(ws.id) !== source;
		current.store.close();
		expect(results).toEqual({
			lockedUpdate:
				'Document "Src items 1" is locked. Unlock it before changing its Workspace.',
			lockedDelete:
				'Document "Src items 1" is locked. Unlock it before changing its Workspace.',
			invalidData: "Item data breaks the schema (1 issue(s)):",
			engineStale: "stale_revision",
			stale: "stale_revision",
			unknownPut: "unknown_item",
			unknownDelete: "unknown_item",
			duplicateCreate: "invalid_record",
			withoutDocument: "invalid_record",
			staleDelete: "stale_revision",
			written: "ok",
		});
		expect(row).toMatchObject({
			revision: 2,
			data: { title: "y", status: "done" },
		});
		expect(afterDelete).toBe("source_unreachable");
		expect(reopened).toBe(true);
	});
});
