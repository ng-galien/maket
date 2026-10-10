import type { CallToolResult } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { resolveActivity } from "../core/activity-contract.js";
import { createBus } from "../services/bus.js";
import { createDocumentStateMutations } from "../services/document-state-mutations.js";
import { createDocumentStates } from "../services/document-states.js";
import { createDocuments } from "../services/documents.js";
import { createStateRenderer } from "../services/state-renderer.js";
import { createSQLiteStore } from "../services/store.js";
import { createStructuredWorkspaces } from "../services/structured-workspaces.js";
import { createDocument } from "../types.js";
import { createMaketStateTool, statePack } from "./state.js";

function textOf(result: CallToolResult) {
	return result.content
		.filter(
			(item): item is Extract<typeof item, { type: "text" }> =>
				item.type === "text",
		)
		.map((item) => item.text)
		.join("\n");
}

function counterFixture() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const doc = createDocument({
		name: "counter",
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
		pages: [{ name: "Page", elements: [], html: "<p>{{ state.count }}</p>" }],
	});
	documents.all().set(doc.name, doc);
	documents.persist(doc.name);
	const documentStates = createDocumentStates({ store, documents, bus });
	const documentStateMutations = createDocumentStateMutations({
		store,
		documents,
		documentStates,
	});
	const tool = createMaketStateTool({
		documentStates,
		documentStateMutations,
		documents,
	});
	const call = (args: Record<string, unknown>) =>
		tool.handler({ doc: "counter", ...args }, {} as never);
	return { store, bus, doc, documentStates, call };
}

async function initCounter(call: ReturnType<typeof counterFixture>["call"]) {
	const result = await call({
		action: "init",
		schema: {
			type: "object",
			properties: { count: { type: "integer" } },
			required: ["count"],
		},
		data: { count: 0 },
	});
	expect(result.isError).toBeUndefined();
}

async function patchCounter(
	call: ReturnType<typeof counterFixture>["call"],
	times: number,
	from: number,
) {
	for (let step = 0; step < times; step += 1) {
		const result = await call({
			action: "patch",
			expected_revision: from + step,
			patch: [{ op: "replace", path: "/count", value: from + step }],
		});
		expect(result.isError).toBeUndefined();
	}
}

function historyRevisions(text: string): number[] {
	return [...text.matchAll(/revision (\d+)/g)].map((match) => Number(match[1]));
}

describe("maket_state revision retention", () => {
	it("keeps the configured previous revisions besides the current state", async () => {
		const { store, call } = counterFixture();
		await initCounter(call);
		const set = await call({ action: "set_retention", retention: 3 });
		expect(set.isError).toBeUndefined();
		expect(textOf(set)).toContain("keeps 3 previous revision(s)");

		await patchCounter(call, 3 + 2, 1);

		const history = await call({ action: "history" });
		expect(historyRevisions(textOf(history))).toEqual([6, 5, 4, 3]);
		const state = JSON.parse(textOf(await call({ action: "get" })));
		expect(state.retention).toBe(3);
		expect(state.current).toMatchObject({ revision: 6, data: { count: 5 } });
		const pruned = await call({ action: "revision", revision: 2 });
		expect(pruned.isError).toBe(true);
		const kept = JSON.parse(
			textOf(await call({ action: "revision", revision: 3 })),
		);
		expect(kept.data).toEqual({ count: 2 });
		store.close();
	});

	it("keeps the full history by default", async () => {
		const { store, call } = counterFixture();
		await initCounter(call);

		await patchCounter(call, 5, 1);

		const history = await call({ action: "history" });
		expect(historyRevisions(textOf(history))).toEqual([6, 5, 4, 3, 2, 1]);
		expect(JSON.parse(textOf(await call({ action: "get" }))).retention).toBe(
			null,
		);
		store.close();
	});

	it("keeps only the current state with retention 0 and prunes when it is set", async () => {
		const { store, bus, call } = counterFixture();
		const retentionChanged = vi.fn();
		bus.on("document-state:retention-changed", retentionChanged);
		await initCounter(call);
		await patchCounter(call, 2, 1);

		const set = await call({ action: "set_retention", retention: 0 });
		expect(textOf(set)).toContain("2 older revision(s) deleted.");
		expect(retentionChanged).toHaveBeenCalledWith({
			docName: "counter",
			retention: 0,
			pruned: 2,
		});
		expect(
			resolveActivity("maket_state", {
				action: "set_retention",
				doc: "counter",
			}),
		).toEqual({ icon: "history", key: "bubble_maket_state_set_retention" });
		expect(historyRevisions(textOf(await call({ action: "history" })))).toEqual(
			[3],
		);
		await patchCounter(call, 2, 3);

		expect(historyRevisions(textOf(await call({ action: "history" })))).toEqual(
			[5],
		);
		const state = JSON.parse(textOf(await call({ action: "get" })));
		expect(state.current).toMatchObject({ revision: 5, data: { count: 4 } });
		store.close();
	});

	it("restores unbounded history with null and rejects a missing retention", async () => {
		const { store, doc, call } = counterFixture();
		await initCounter(call);
		await call({ action: "set_retention", retention: 0 });
		const missing = await call({ action: "set_retention" });
		expect(missing.isError).toBe(true);
		expect(textOf(missing)).toContain("retention is required");
		const negative = await call({ action: "set_retention", retention: -1 });
		expect(negative.isError).toBe(true);

		const reset = await call({ action: "set_retention", retention: null });
		expect(textOf(reset)).toContain("keeps its full revision history");
		await patchCounter(call, 2, 1);
		expect(historyRevisions(textOf(await call({ action: "history" })))).toEqual(
			[3, 2, 1],
		);

		doc.meta.locked = true;
		const locked = await call({ action: "set_retention", retention: 1 });
		expect(locked.isError).toBe(true);
		expect(textOf(locked)).toContain("is locked");
		store.close();
	});
});

describe("maket_state revision retention on Workspace documents", () => {
	it("bounds the history of an item document and of its collection projection", async () => {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const documents = createDocuments({ store });
		const canvas = {
			format: "A4",
			orientation: "portrait" as const,
			w: 210,
			h: 297,
			bg: "#fff",
		};
		for (const document of [
			createDocument({
				name: "Topic detail",
				canvas,
				pages: [
					{ name: "Detail", elements: [], html: "<h1>{{ state.title }}</h1>" },
				],
			}),
			createDocument({
				name: "Topic board",
				canvas,
				pages: [{ name: "Board", elements: [], html: "<main></main>" }],
			}),
		]) {
			documents.all().set(document.name, document);
			documents.persist(document.name);
		}
		const documentStates = createDocumentStates({ store, documents, bus });
		const workspaces = createStructuredWorkspaces({
			store,
			documents,
			documentStates,
			bus,
		});
		workspaces.create({
			name: "Graph",
			dataSchema: {
				$defs: {
					topic: {
						type: "object",
						properties: { title: { type: "string" } },
						required: ["title"],
					},
				},
			},
			representationSchema: {
				version: 1,
				collections: {
					topics: {
						name: "Topics",
						collectionTemplateDocumentId: "Topic board",
						bindings: {
							topic: {
								schemaPath: "/$defs/topic",
								detailTemplateDocumentId: "Topic detail",
							},
						},
					},
				},
			},
		});
		const item = workspaces.addItem({
			workspace: "Graph",
			itemId: "topic-1",
			collectionId: "topics",
			bindingId: "topic",
			documentName: "Topic one",
			data: { title: "v0" },
		});
		const projection =
			workspaces.get("Graph")?.collectionDocuments[0]?.documentName;
		if (!projection) throw new Error("Collection projection missing.");
		const tool = createMaketStateTool({
			documentStates,
			documentStateMutations: createDocumentStateMutations({
				store,
				documents,
				documentStates,
			}),
			documents,
		});
		for (const doc of [item.documentName, projection]) {
			const set = await tool.handler(
				{ action: "set_retention", doc, retention: 1 },
				{} as never,
			);
			expect(set.isError).toBeUndefined();
		}

		for (let step = 1; step <= 4; step += 1) {
			workspaces.updateItem("Graph", "topic-1", step, { title: `v${step}` });
		}

		const itemHistory = documentStates.history(item.documentName);
		expect(itemHistory.map(({ revision }) => revision)).toEqual([5, 4]);
		expect(itemHistory[0]?.data).toEqual({ title: "v4" });
		const projectionHistory = documentStates.history(projection);
		expect(projectionHistory).toHaveLength(2);
		expect(projectionHistory[0]?.data).toEqual({ items: [{ title: "v4" }] });
		store.close();
	});
});

describe("maket_state", () => {
	it("registers a dedicated state tool pack", () => {
		expect(statePack.declaresTools).toEqual(["maket_state"]);
		expect(statePack.requires).toEqual([
			"documentStates",
			"documentStateMutations",
			"documents",
		]);
	});

	it("runs the snapshot lifecycle through the MCP boundary", async () => {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const documents = createDocuments({ store });
		const doc = createDocument({
			name: "checklist",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
		});
		documents.all().set(doc.name, doc);
		documents.persist(doc.name);
		const documentStates = createDocumentStates({ store, documents, bus });
		const documentStateMutations = createDocumentStateMutations({
			store,
			documents,
			documentStates,
		});
		const tool = createMaketStateTool({
			documentStates,
			documentStateMutations,
			documents,
		});

		const initial = await tool.handler(
			{
				action: "init",
				doc: "checklist",
				schema: {
					type: "object",
					properties: { done: { type: "boolean" } },
					required: ["done"],
				},
				data: { done: false },
			},
			{} as never,
		);
		expect(textOf(initial)).toContain("revision 1");

		const updated = await tool.handler(
			{
				action: "update",
				doc: "checklist",
				expected_revision: 1,
				data: { done: true },
			},
			{} as never,
		);
		expect(textOf(updated)).toContain("revision 2");

		const patched = await tool.handler(
			{
				action: "patch",
				doc: "checklist",
				expected_revision: 2,
				patch: [{ op: "replace", path: "/done", value: false }],
			},
			{} as never,
		);
		expect(textOf(patched)).toContain("revision 3");

		const nextSchema = {
			type: "object",
			properties: {
				done: { type: "boolean" },
				label: { type: "string" },
			},
			required: ["done", "label"],
		};
		const validated = await tool.handler(
			{
				action: "validate_schema",
				doc: "checklist",
				schema: nextSchema,
				data: { done: false, label: "Open" },
			},
			{} as never,
		);
		expect(textOf(validated)).toContain("Schema is valid");
		const schemaChanged = await tool.handler(
			{
				action: "change_schema",
				doc: "checklist",
				expected_revision: 3,
				schema: nextSchema,
				data: { done: false, label: "Open" },
			},
			{} as never,
		);
		expect(textOf(schemaChanged)).toContain("revision 4");
		expect(documentStates.revision("checklist", 4)).toMatchObject({
			schema: nextSchema,
			data: { done: false, label: "Open" },
		});
		const restored = await tool.handler(
			{
				action: "restore",
				doc: "checklist",
				revision: 3,
				expected_revision: 4,
			},
			{} as never,
		);
		expect(textOf(restored)).toContain("revision 5");
		expect(documentStates.get("checklist")?.current).toMatchObject({
			revision: 5,
			schema: {
				type: "object",
				properties: { done: { type: "boolean" } },
				required: ["done"],
			},
			data: { done: false },
		});

		doc.meta.locked = true;
		const locked = await tool.handler(
			{
				action: "update",
				doc: "checklist",
				expected_revision: 5,
				data: { done: false },
			},
			{} as never,
		);
		expect(locked.isError).toBe(true);
		expect(textOf(locked)).toContain("is locked");
		store.close();
	});

	it("rejects derived collection writes and item data outside the workspace aggregate", async () => {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const documents = createDocuments({ store });
		const detailTemplate = createDocument({
			name: "Task detail",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					name: "Task",
					elements: [],
					html: '<input type="text" data-maket-bind="state.kind">',
				},
			],
		});
		const collectionTemplate = createDocument({
			name: "Task collection",
			canvas: detailTemplate.canvas,
			pages: [{ name: "Tasks", elements: [], html: "<main></main>" }],
		});
		for (const document of [detailTemplate, collectionTemplate]) {
			documents.all().set(document.name, document);
			documents.persist(document.name);
		}
		const documentStates = createDocumentStates({ store, documents, bus });
		const workspaces = createStructuredWorkspaces({
			store,
			documents,
			documentStates,
			bus,
		});
		workspaces.create({
			name: "Delivery",
			dataSchema: {
				type: "object",
				properties: {
					kind: { const: "task" },
					title: { type: "string" },
				},
				required: ["kind", "title"],
				additionalProperties: false,
				$defs: {
					item: {
						type: "object",
						properties: {
							kind: { type: "string" },
							title: { type: "string" },
						},
						required: ["kind", "title"],
						additionalProperties: false,
					},
				},
			},
			representationSchema: {
				version: 1,
				collections: {
					backlog: {
						name: "Backlog",
						collectionTemplateDocumentId: collectionTemplate.name,
						bindings: {
							task: {
								schemaPath: "/$defs/item",
								detailTemplateDocumentId: detailTemplate.name,
							},
						},
					},
				},
			},
		});
		const item = workspaces.addItem({
			workspace: "Delivery",
			itemId: "task-1",
			collectionId: "backlog",
			bindingId: "task",
			documentName: "Ship",
			data: { kind: "task", title: "Ship" },
		});
		const collectionName =
			workspaces.get("Delivery")?.collectionDocuments[0]?.documentName;
		if (!collectionName) throw new Error("Collection document missing.");
		const documentStateMutations = createDocumentStateMutations({
			store,
			documents,
			documentStates,
		});
		const tool = createMaketStateTool({
			documentStates,
			documentStateMutations,
			documents,
		});

		const collectionWrite = await tool.handler(
			{
				action: "update",
				doc: collectionName,
				expected_revision: 2,
				data: { items: [] },
			},
			{} as never,
		);
		expect(collectionWrite.isError).toBe(true);
		expect(textOf(collectionWrite)).toContain("derived");
		expect(documentStates.get(collectionName)?.current.revision).toBe(2);

		const invalidItemWrite = await tool.handler(
			{
				action: "patch",
				doc: item.documentName,
				expected_revision: 1,
				patch: [{ op: "replace", path: "/kind", value: "decision" }],
			},
			{} as never,
		);
		expect(invalidItemWrite.isError).toBe(true);
		expect(textOf(invalidItemWrite)).toContain("Invalid item data");
		expect(documentStates.get(item.documentName)?.current).toMatchObject({
			revision: 1,
			data: { kind: "task", title: "Ship" },
		});
		store.close();
	});
});

describe("maket_state drawing from state", () => {
	it("re-renders an SVG bar width on patch and refuses a non-numeric value", async () => {
		const { store, doc, documentStates, call } = counterFixture();
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html =
			'<svg viewBox="0 0 100 10"><rect data-id="bar" height="10" width="{{ state.count }}"/></svg>';
		const stateRenderer = createStateRenderer({ documentStates });
		const init = await call({
			action: "init",
			schema: {
				type: "object",
				properties: { count: { type: ["integer", "string"] } },
				required: ["count"],
			},
			data: { count: 10 },
		});
		expect(init.isError).toBeUndefined();
		expect(stateRenderer.render(doc).pages[0]?.html).toContain('width="10"');

		const patched = await call({
			action: "patch",
			expected_revision: 1,
			patch: [{ op: "replace", path: "/count", value: 75 }],
		});
		expect(patched.isError).toBeUndefined();
		expect(stateRenderer.renderPages(doc, ["/count"]).pages).toEqual([
			{
				index: 0,
				html: '<svg viewBox="0 0 100 10"><rect data-id="bar" height="10" width="75"/></svg>',
			},
		]);

		const refused = await call({
			action: "patch",
			expected_revision: 2,
			patch: [{ op: "replace", path: "/count", value: "full" }],
		});
		expect(refused.isError).toBe(true);
		expect(textOf(refused)).toContain(
			"Document state value in <rect width> must render",
		);
		expect(documentStates.get("counter")?.current.data).toEqual({ count: 75 });
		store.close();
	});
});
