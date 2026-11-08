import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { StructuredWorkspaceHttpSource } from "@maket/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";
import { createAnnotations } from "../services/annotations.js";
import { createBus } from "../services/bus.js";
import { createConfig } from "../services/config.js";
import { createDocumentRenderer } from "../services/document-renderer.js";
import { createDocumentStateMutations } from "../services/document-state-mutations.js";
import { createDocumentStates } from "../services/document-states.js";
import { createDocuments } from "../services/documents.js";
import { createItemSources } from "../services/item-sources/item-sources.js";
import { createItemWindows } from "../services/item-windows.js";
import { createStateRenderer } from "../services/state-renderer.js";
import { createSQLiteStore } from "../services/store.js";
import { createStructuredWorkspaces } from "../services/structured-workspaces.js";
import { createWsHandler } from "../services/ws-handler/index.js";
import { createWsRegistry } from "../services/ws-registry.js";
import { createMaketReaderTool } from "./reader.js";
import { createMaketStructuredWorkspaceTool } from "./structured-workspaces.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
	vi.unstubAllEnvs();
});

async function fixture(options: { total?: boolean; auth?: boolean } = {}) {
	const requests: URL[] = [];
	let unreachable = false;
	let payload: Record<string, unknown>[] | undefined;
	let title = "Detail read from source";
	let detailId = "A";
	let detailMissing = false;
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://fixture");
		requests.push(url);
		if (
			options.auth &&
			req.headers.authorization !== "Bearer isolated-test-token"
		) {
			res.writeHead(401).end();
			return;
		}
		if (unreachable) {
			res.writeHead(503).end("private provider body");
			return;
		}
		res.setHeader("Content-Type", "application/json");
		if (url.pathname === "/items") {
			const items =
				payload ??
				(url.searchParams.get("after")
					? [{ id: "B", title: "Second", rev: "r-B" }]
					: [
							{
								id: "A",
								title: url.searchParams.get("q") ? "Matching" : "First",
								rev: "r-A",
							},
						]);
			res.end(
				JSON.stringify({
					data: items,
					next: url.searchParams.get("after") ? null : "opaque/+==:provider",
					...(options.total ? { total: 2 } : {}),
				}),
			);
		} else {
			if (detailMissing) {
				res.writeHead(404).end();
				return;
			}
			res.setHeader("ETag", '"detail-v2"');
			res.end(JSON.stringify({ id: detailId, title }));
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	cleanup.push(
		() =>
			new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			),
	);
	const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const store = createSQLiteStore(":memory:");
	cleanup.push(async () => store.close());
	const bus = createBus();
	const documents = createDocuments({ store });
	const documentStates = createDocumentStates({ store, bus, documents });
	const itemSources = createItemSources({ store, bus, documents });
	const itemWindows = createItemWindows({ store, bus, itemSources });
	const structuredWorkspaces = createStructuredWorkspaces({
		store,
		bus,
		documents,
		documentStates,
		itemSources,
		itemWindows,
	});
	const documentStateMutations = createDocumentStateMutations({
		store,
		documents,
		documentStates,
		structuredWorkspaces,
	});
	const stateRenderer = createStateRenderer({ documentStates });
	const documentRenderer = createDocumentRenderer({
		stateRenderer,
		structuredWorkspaces,
		collectionRenderer: { render: (doc) => doc },
	});
	const wsRegistry = createWsRegistry();
	const handler = createWsHandler({
		store,
		bus,
		documents,
		documentStates,
		documentStateMutations,
		structuredWorkspaces,
		itemWindows,
		documentRenderer,
		wsRegistry,
		pending: createAnnotations({ store, bus }),
		assets: {} as never,
		settings: {} as never,
	});
	const sent: string[] = [];
	const ws = {
		readyState: 1,
		send: (message: string) => sent.push(message),
	} as unknown as WebSocket;
	wsRegistry.add(ws);
	const reader = createMaketReaderTool({
		documents,
		documentRenderer,
		documentStateMutations,
		collectionCursors: { resolve: () => null } as never,
		config: createConfig(),
	});
	const tool = createMaketStructuredWorkspaceTool({
		structuredWorkspaces,
		itemWindows,
	});
	const call = (args: Record<string, unknown>) =>
		tool.handler(args, {} as never);
	const source: StructuredWorkspaceHttpSource = {
		kind: "http",
		baseUrl,
		collectionId: "items",
		bindingId: "item",
		...(options.auth ? { auth: "env:MAKET_HTTP_FIXTURE_TOKEN" } : {}),
		list: {
			path: "/items",
			params: {
				cursor: "after",
				limit: "count",
				sort: "order",
				text: "q",
				filters: "where",
			},
			itemsPointer: "/data",
			nextPointer: "/next",
			revisionPointer: "/rev",
			...(options.total ? { totalPointer: "/total" } : {}),
		},
		get: { path: "/items/{id}" },
	};
	if (options.auth)
		vi.stubEnv("MAKET_HTTP_FIXTURE_TOKEN", "isolated-test-token");
	const create = (extra: Record<string, unknown> = {}) =>
		call({
			action: "create",
			workspace: "HTTP simulation",
			data_schema: {
				type: "object",
				required: ["id", "title"],
				properties: { id: { type: "string" }, title: { type: "string" } },
			},
			representation_schema: {
				collections: {
					items: {
						identity: "/id",
						sortBy: "/id",
						detailTemplateHtml: "<h1>{{ state.title }}</h1>",
						detailForm: {
							uischema: {
								type: "VerticalLayout",
								elements: [{ type: "Control", scope: "#/properties/title" }],
							},
						},
					},
				},
			},
			data_source: source,
			...extra,
		});
	await create();
	const workspace = structuredWorkspaces.get("HTTP simulation");
	expect(workspace?.integrity).toEqual({ status: "ready", issues: [] });
	const id = workspace!.id;
	cleanup.push(() => itemSources.close(id));
	return {
		call,
		reader,
		create,
		source,
		id,
		store,
		documents,
		documentStates,
		documentStateMutations,
		structuredWorkspaces,
		itemWindows,
		requests,
		sent,
		handler,
		ws,
		bus,
		setUnreachable: () => {
			unreachable = true;
		},
		setPayload: (next: Record<string, unknown>[]) => {
			payload = next;
		},
		setTitle: (next: string) => {
			title = next;
		},
		setDetailId: (next: string) => {
			detailId = next;
		},
		removeDetail: () => {
			detailMissing = true;
		},
	};
}

function textOf(
	value: Awaited<
		ReturnType<ReturnType<typeof createMaketStructuredWorkspaceTool>["handler"]>
	>,
) {
	return value.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
}
function structuredOf(value: Parameters<typeof textOf>[0]) {
	return value.structuredContent as {
		window: {
			items: Array<{
				id: string;
				documentName: string;
				revision: string;
				fields: Record<string, unknown>;
				issues?: unknown[];
			}>;
			next?: string;
			total?: number;
		};
		dataSource?: StructuredWorkspaceHttpSource;
	};
}

describe("HTTP source through public MCP and document commands", () => {
	it("declares a source, reads/searches by opaque cursor, opens and refreshes a real detail, and refuses every source write", async () => {
		const f = await fixture({ auth: true });
		expect(f.requests).toHaveLength(0);
		const first = await f.call({ action: "view", workspace: f.id, batch: 1 });
		expect(first.isError).not.toBe(true);
		const page = structuredOf(first).window;
		expect(page.items[0]?.revision).toBe("r-A");
		expect(page.next).toBe("opaque/+==:provider");
		expect(page).not.toHaveProperty("total");
		expect(f.store.loadStructuredWorkspaceItem(f.id, "A")).toBeNull();
		expect(
			[...f.documents.all().values()].filter(
				(doc) => doc.meta.structuredWorkspace?.role === "item",
			),
		).toHaveLength(0);
		const next = await f.call({
			action: "view",
			workspace: f.id,
			batch: 1,
			cursor: page.next,
		});
		expect(structuredOf(next).window.items.map((item) => item.id)).toEqual([
			"B",
		]);
		expect(f.requests[1]?.searchParams.get("after")).toBe(page.next);
		expect(structuredOf(next).window.next).toBeUndefined();
		const searched = await f.call({
			action: "view",
			workspace: f.id,
			batch: 1,
			text: "needle",
			filters: [{ field: "/title", op: "eq", value: "Matching" }],
		});
		expect(structuredOf(searched).window.items[0]?.fields.title).toBe(
			"Matching",
		);
		expect(f.requests.at(-1)?.searchParams.get("q")).toBe("needle");
		expect(JSON.parse(f.requests.at(-1)!.searchParams.get("order")!)).toEqual({
			field: "/id",
			direction: "ascending",
		});
		const name = page.items[0]!.documentName;
		f.handler(
			{
				type: "load_document",
				name,
				structuredWorkspace: { workspaceId: f.id },
			},
			f.ws,
		);
		await vi.waitFor(() => expect(f.sent).toHaveLength(1));
		const state = JSON.parse(f.sent[0]!);
		expect(state.doc.pages[0].html).toContain("Detail read from source");
		expect(state.doc.meta.structuredWorkspace).toMatchObject({
			sourceReadOnly: true,
			sourceRevision: '"detail-v2"',
		});
		const docId = state.doc.id;
		const readerPage = await f.reader.handler(
			{ action: "page", doc: name, page: 1 },
			{} as never,
		);
		expect(readerPage.structuredContent).toMatchObject({
			readOnly: true,
			locked: false,
		});
		f.handler({ type: "pin_document", name, pinned: true }, f.ws);
		expect(f.structuredWorkspaces.get(f.id)?.pinnedItems).toMatchObject([
			{ id: "A", documentName: name },
		]);
		expect(() => f.structuredWorkspaces.portableItems(f.id)).toThrow(
			/portability/,
		);

		expect(f.store.loadStructuredWorkspaceItem(f.id, "A")).toBeNull();
		expect(f.itemWindows.current(f.id, "items").items[0]?.fields.title).toBe(
			"Detail read from source",
		);
		f.setTitle("Changed outside Maket");
		f.handler(
			{
				type: "load_document",
				name,
				structuredWorkspace: { workspaceId: f.id },
			},
			f.ws,
		);
		await vi.waitFor(() => expect(f.sent).toHaveLength(2));
		expect(JSON.parse(f.sent[1]!).doc.id).toBe(docId);
		expect(JSON.parse(f.sent[1]!).doc.pages[0].html).toContain(
			"Changed outside Maket",
		);
		const before = f.requests.length;
		for (const args of [
			{
				action: "add_item",
				collection: "items",
				binding: "item",
				document_name: "new",
				data: { id: "C", title: "New" },
			},
			{
				action: "update_item",
				item: "A",
				expected_revision: 1,
				data: { id: "A", title: "Write" },
			},
			{ action: "delete_item", item: "A" },
		]) {
			const result = await f.call({ workspace: f.id, ...args });
			expect(result.isError).toBe(true);
			expect(textOf(result)).toContain("read_only");
		}
		await expect(
			f.documentStateMutations.patch(name, 1, [
				{ op: "replace", path: "/title", value: "Write" },
			]),
		).rejects.toMatchObject({ code: "read_only" });
		expect(f.requests).toHaveLength(before);
		expect(textOf(first)).not.toContain("isolated-test-token");
		expect(f.structuredWorkspaces.get(f.id)?.dataSource).toEqual(f.source);
	});

	it("honors declared totals and public WS queries without fetching later batches", async () => {
		const f = await fixture({ total: true });
		const toasts: unknown[] = [];
		f.bus.on("toast", (event) => toasts.push(event));
		f.handler(
			{
				type: "structured_collection_query",
				workspaceId: f.id,
				collectionId: "items",
				text: "browser search",
			},
			f.ws,
		);
		await vi.waitFor(() =>
			expect(f.itemWindows.current(f.id, "items").items).toHaveLength(1),
		);
		expect(f.itemWindows.current(f.id, "items").total).toBe(2);
		expect(f.requests).toHaveLength(1);
		expect(f.requests[0]?.searchParams.get("q")).toBe("browser search");
		const index = f.structuredWorkspaces.get(f.id)?.collectionDocuments[0];
		f.handler(
			{
				type: "load_document",
				name: index!.documentName,
				structuredWorkspace: { workspaceId: f.id },
			},
			f.ws,
		);
		await vi.waitFor(() => expect(f.sent).toHaveLength(1));
		expect(f.itemWindows.current(f.id, "items").query.text).toBe(
			"browser search",
		);
		expect(f.requests).toHaveLength(1);

		f.setUnreachable();
		f.handler(
			{
				type: "structured_collection_query",
				workspaceId: f.id,
				collectionId: "items",
				text: "retry",
			},
			f.ws,
		);
		await vi.waitFor(() => expect(toasts).toHaveLength(1));
		expect(toasts[0]).toMatchObject({ params: { code: "source_unreachable" } });
		expect(f.itemWindows.current(f.id, "items").items).toHaveLength(1);
		const result = await f.call({ action: "view", workspace: f.id });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("source_unreachable");
		expect(textOf(result)).not.toContain("private provider body");
	});

	it("refuses malformed/duplicate identities and carries invalid data issues", async () => {
		const f = await fixture();
		f.setPayload([{ title: "Missing identity" }]);
		const missing = await f.call({ action: "view", workspace: f.id });
		expect(textOf(missing)).toContain("invalid_record");
		f.setPayload([
			{ id: "A", title: "One" },
			{ id: "A", title: "Duplicate" },
		]);
		expect(textOf(await f.call({ action: "view", workspace: f.id }))).toContain(
			"duplicate item identities",
		);
		f.setPayload([{ id: "A", title: 42 }]);
		expect(
			structuredOf(await f.call({ action: "view", workspace: f.id })).window
				.items[0]?.issues,
		).not.toHaveLength(0);
		expect(
			textOf(await f.call({ action: "check", workspace: f.id })),
		).toContain("not ready");
		expect(f.requests).toHaveLength(3);
	});

	it("does not open a mismatching or missing HTTP detail", async () => {
		const f = await fixture();
		const toasts: unknown[] = [];
		f.bus.on("toast", (event) => toasts.push(event));
		const result = await f.call({ action: "view", workspace: f.id });
		const name = structuredOf(result).window.items[0]!.documentName;
		f.setDetailId("another-id");
		f.handler(
			{
				type: "load_document",
				name,
				structuredWorkspace: { workspaceId: f.id },
			},
			f.ws,
		);
		await vi.waitFor(() => expect(toasts).toHaveLength(1));
		expect(f.sent).toHaveLength(0);
		expect(f.documents.resolve(name)).toBeNull();
		f.removeDetail();
		f.handler(
			{
				type: "load_document",
				name,
				structuredWorkspace: { workspaceId: f.id },
			},
			f.ws,
		);
		await vi.waitFor(() => expect(toasts).toHaveLength(2));
		expect(f.sent).toHaveLength(0);
	});

	it("validates source declaration and preserves the prior definition on unsupported updates", async () => {
		const f = await fixture();
		for (const data_source of [
			{ ...f.source, auth: "plaintext-token" },
			{ ...f.source, put: { path: "/items/{id}" } },
			{
				...f.source,
				list: { ...f.source.list, path: "https://other-origin.invalid/items" },
			},
		]) {
			const result = await f.call({
				action: "create",
				workspace: "Invalid HTTP",
				data_source,
				data_schema: {
					type: "object",
					required: ["id"],
					properties: { id: { type: "string" } },
				},
				representation_schema: {
					collections: { items: { identity: "/id", sortBy: "/id" } },
				},
			});
			expect(result.isError).toBe(true);
			expect(f.structuredWorkspaces.get("Invalid HTTP")).toBeNull();
		}
		const before = f.structuredWorkspaces.get(f.id);
		const changed = await f.call({
			action: "update_definition",
			workspace: f.id,
			expected_workspace_revision: 1,
			data_source: { ...f.source, baseUrl: "https://new-origin.invalid" },
		});
		expect(changed.isError).toBe(true);
		expect(f.structuredWorkspaces.get(f.id)).toEqual(before);
	});
});
