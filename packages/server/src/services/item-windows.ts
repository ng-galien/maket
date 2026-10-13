/**
 * ItemWindows — the current window of each Structured Workspace collection,
 * held by the server: the query, the batches fetched so far through the
 * workspace's item source, the next cursor and the time of the read. Every
 * client and the agent read the same window; a new query replaces it, the
 * window's cursor extends it. A change of the source re-reads the window and
 * announces `structured-workspace:window-changed`; the listeners broadcast.
 */

import {
	type StructuredCollectionQuery,
	type StructuredCollectionWindow,
	type StructuredCollectionWindowItem,
	type StructuredWorkspaceDefinition,
	structuredWorkspaceDefaultIndexPageSize,
	structuredWorkspaceMaxBatch,
} from "@maket/shared";
import type { Bus } from "./bus.js";
import type { ItemQuery, ItemSummary } from "./item-sources/item-source.js";
import { itemSourceError } from "./item-sources/item-source-error.js";
import type { ItemSources } from "./item-sources/item-sources.js";
import type { StructuredWorkspaceRepository } from "./sqlite-store/structured-workspace-repository.js";

export interface ItemWindowRequest extends StructuredCollectionQuery {
	/** The `next` of the current window: extend it instead of replacing it. */
	cursor?: string;
}

export interface ItemWindows {
	/** The window of a collection, opened on first read with the first batch
	 * of the collection's own order. */
	current(
		workspaceId: string,
		collectionId: string,
	): StructuredCollectionWindow;
	/** Replace the window with the first batch of a new query or, with a
	 * cursor, append the next batch of the current query. Answers the window
	 * and the batch just read. */
	query(
		workspaceId: string,
		collectionId: string,
		request: ItemWindowRequest,
	): {
		window: StructuredCollectionWindow;
		batch: StructuredCollectionWindowItem[];
	};
	/** One batch of a query read from the source, the first one or the one
	 * after `cursor`, without reading or changing any window. */
	page(
		workspaceId: string,
		collectionId: string,
		request: ItemWindowRequest,
	): Pick<StructuredCollectionWindow, "items" | "next" | "total" | "groups">;
	/** Every window held. */
	all(): StructuredCollectionWindow[];
}

export interface ItemWindowsDeps {
	bus: Bus;
	itemSources: ItemSources;
	store: StructuredWorkspaceRepository;
}

interface HeldWindow {
	window: StructuredCollectionWindow;
	/** Workspace revision the window was read at: a new definition re-reads it. */
	revision: number;
}

export function createItemWindows(deps: ItemWindowsDeps): ItemWindows {
	const held = new Map<string, HeldWindow>();
	const keyOf = (workspaceId: string, collectionId: string) =>
		`${workspaceId}\u0000${collectionId}`;
	const store = (window: StructuredCollectionWindow, revision: number) => {
		held.set(keyOf(window.workspaceId, window.collectionId), {
			window,
			revision,
		});
		return window;
	};
	const announce = (window: StructuredCollectionWindow) =>
		deps.bus.emit("structured-workspace:window-changed", {
			workspaceId: window.workspaceId,
			collectionId: window.collectionId,
		});
	const reread = (workspaceId: string, onlyNewDefinition: boolean) => {
		const workspace = deps.store.loadStructuredWorkspace(workspaceId);
		for (const [key, entry] of [...held]) {
			if (entry.window.workspaceId !== workspaceId) continue;
			if (
				!workspace ||
				workspace.id !== workspaceId ||
				!workspace.representationSchema.collections[entry.window.collectionId]
			) {
				held.delete(key);
				continue;
			}
			if (onlyNewDefinition && entry.revision === workspace.revision) continue;
			let window: StructuredCollectionWindow;
			try {
				window = readWindow(deps, workspace, entry.window);
			} catch {
				held.delete(key);
				continue;
			}
			announce(store(window, workspace.revision));
		}
	};
	deps.bus.on("structured-workspace:source-changed", ({ workspaceId }) =>
		reread(workspaceId, false),
	);
	deps.bus.on("structured-workspace:changed", ({ workspaceId }) =>
		reread(workspaceId, true),
	);
	deps.bus.on("structured-workspace:deleted", ({ workspaceId }) => {
		for (const [key, entry] of [...held])
			if (entry.window.workspaceId === workspaceId) held.delete(key);
	});
	return {
		current(workspaceId, collectionId) {
			const existing = held.get(keyOf(workspaceId, collectionId));
			if (existing) return existing.window;
			const workspace = requiredWorkspace(deps.store, workspaceId);
			return store(
				readWindow(deps, workspace, emptyWindow(workspaceId, collectionId, {})),
				workspace.revision,
			);
		},
		query(workspaceId, collectionId, request) {
			const workspace = requiredWorkspace(deps.store, workspaceId);
			const read = readRequest(deps, workspace, {
				collectionId,
				current: held.get(keyOf(workspaceId, collectionId))?.window,
				request,
			});
			announce(store(read.window, workspace.revision));
			return read;
		},
		page(workspaceId, collectionId, request) {
			const { cursor, ...query } = request;
			return listBatch(deps, requiredWorkspace(deps.store, workspaceId), {
				collectionId,
				query: normalizedQuery(query),
				...(cursor === undefined ? {} : { cursor }),
			});
		},
		all() {
			return [...held.values()].map((entry) => entry.window);
		},
	};
}

/** A new query read from its first item, or, with a cursor, the current
 * window extended with the batch after it. */
function readRequest(
	deps: ItemWindowsDeps,
	workspace: StructuredWorkspaceDefinition,
	target: {
		collectionId: string;
		current: StructuredCollectionWindow | undefined;
		request: ItemWindowRequest;
	},
): {
	window: StructuredCollectionWindow;
	batch: StructuredCollectionWindowItem[];
} {
	const { cursor, ...query } = target.request;
	const { current } = target;
	if (cursor !== undefined && current)
		return extendedWindow(deps, workspace, current, {
			cursor,
			batch: query.batch ?? current.query.batch,
		});
	const window = readWindow(
		deps,
		workspace,
		emptyWindow(workspace.id, target.collectionId, normalizedQuery(query)),
	);
	return { window, batch: window.items };
}

/** The window with the batch after `cursor` appended, items already held
 * left out. */
function extendedWindow(
	deps: ItemWindowsDeps,
	workspace: StructuredWorkspaceDefinition,
	current: StructuredCollectionWindow,
	next: { cursor: string; batch: number | undefined },
): {
	window: StructuredCollectionWindow;
	batch: StructuredCollectionWindowItem[];
} {
	const page = listBatch(deps, workspace, {
		collectionId: current.collectionId,
		query: current.query,
		cursor: next.cursor,
		...(next.batch === undefined ? {} : { batch: next.batch }),
	});
	const known = new Set(current.items.map((item) => item.id));
	const batch = page.items.filter((item) => !known.has(item.id));
	return {
		window: {
			workspaceId: current.workspaceId,
			collectionId: current.collectionId,
			query: current.query,
			items: [...current.items, ...batch],
			...pageTail(page),
			fetchedAt: new Date().toISOString(),
		},
		batch,
	};
}

function emptyWindow(
	workspaceId: string,
	collectionId: string,
	query: StructuredCollectionQuery,
): StructuredCollectionWindow {
	return {
		workspaceId,
		collectionId,
		query,
		items: [],
		fetchedAt: "",
	};
}

function normalizedQuery(
	query: StructuredCollectionQuery,
): StructuredCollectionQuery {
	const text = query.text?.trim();
	return {
		...(text ? { text } : {}),
		...(query.filters?.length ? { filters: query.filters } : {}),
		...(query.sort ? { sort: query.sort } : {}),
		...(query.batch === undefined ? {} : { batch: query.batch }),
	};
}

/** The window's query read again from its first item, as many items as it
 * held, at least one batch. */
function readWindow(
	deps: ItemWindowsDeps,
	workspace: StructuredWorkspaceDefinition,
	previous: StructuredCollectionWindow,
): StructuredCollectionWindow {
	const target = { collectionId: previous.collectionId, query: previous.query };
	const items: StructuredCollectionWindowItem[] = [];
	let page = listBatch(deps, workspace, target);
	items.push(...page.items);
	while (page.next !== undefined && items.length < previous.items.length) {
		page = listBatch(deps, workspace, { ...target, cursor: page.next });
		items.push(...page.items);
	}
	return {
		workspaceId: workspace.id,
		collectionId: previous.collectionId,
		query: previous.query,
		items,
		...pageTail(page),
		fetchedAt: new Date().toISOString(),
	};
}

function pageTail(
	page: Pick<StructuredCollectionWindow, "next" | "total" | "groups">,
): Pick<StructuredCollectionWindow, "next" | "total" | "groups"> {
	return {
		...(page.next === undefined ? {} : { next: page.next }),
		...(page.total === undefined ? {} : { total: page.total }),
		...(page.groups === undefined ? {} : { groups: page.groups }),
	};
}

/** One batch of a window's query through the workspace's item source, in
 * the collection's group and sort order unless the query sorts itself. */
function listBatch(
	deps: ItemWindowsDeps,
	workspace: StructuredWorkspaceDefinition,
	target: {
		collectionId: string;
		query: StructuredCollectionQuery;
		cursor?: string;
		batch?: number;
	},
): Pick<StructuredCollectionWindow, "items" | "next" | "total" | "groups"> {
	const collection =
		workspace.representationSchema.collections[target.collectionId];
	const { query } = target;
	const sort =
		query.sort ??
		(collection?.sortBy
			? {
					field: collection.sortBy,
					direction: collection.sortDirection ?? "ascending",
				}
			: undefined);
	const request: ItemQuery = {
		collectionId: target.collectionId,
		...(query.text ? { text: query.text } : {}),
		...(query.filters ? { filters: query.filters } : {}),
		...(sort ? { sort } : {}),
		...(collection?.groupBy === undefined
			? {}
			: { groupBy: collection.groupBy }),
		...(target.cursor === undefined ? {} : { cursor: target.cursor }),
		limit: Math.min(
			target.batch ??
				query.batch ??
				collection?.indexPageSize ??
				structuredWorkspaceDefaultIndexPageSize,
			structuredWorkspaceMaxBatch,
		),
	};
	const page = deps.itemSources.sourceFor(workspace.id).list(request);
	const names = new Map(
		workspace.items.map((item) => [item.id, item.documentName]),
	);
	return {
		items: page.items.map((summary) => windowItem(summary, names)),
		...pageTail(page),
	};
}

function windowItem(
	summary: ItemSummary,
	names: ReadonlyMap<string, string>,
): StructuredCollectionWindowItem {
	const documentName = names.get(summary.id);
	if (documentName === undefined)
		throw new Error(`Item "${summary.id}" is not in its workspace.`);
	return {
		id: summary.id,
		bindingId: summary.bindingId,
		documentName,
		revision: summary.revision,
		fields: summary.fields,
		...(summary.issues ? { issues: summary.issues } : {}),
	};
}

function requiredWorkspace(
	store: StructuredWorkspaceRepository,
	workspaceId: string,
): StructuredWorkspaceDefinition {
	const workspace = store.loadStructuredWorkspace(workspaceId);
	if (!workspace || workspace.id !== workspaceId)
		throw itemSourceError(
			"unknown_workspace",
			`Structured Workspace "${workspaceId}" not found.`,
		);
	return workspace;
}
