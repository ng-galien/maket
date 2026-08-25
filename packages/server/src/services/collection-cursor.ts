/**
 * collection-cursor — server-owned preview state of page↔collection bindings.
 *
 * The binding itself (`page.collection`) is persistent document state. The
 * cursor over it (render mode + current member) is persistent view state keyed
 * by stable document and page ids. Public commands still address pages by
 * current index: two pages bound to the same collection hold independent
 * cursors even when pages are reordered, renamed, or reopened.
 *
 * Humans move the cursor through the `collection_cursor_set` WS command,
 * agents through `maket_collection action=cursor`; exports read the same
 * value. Every mutation emits `collection-cursor:changed` on the bus — the
 * WS broadcast lives in `index.ts` listeners, never here.
 *
 * A page without a saved cursor defaults to single-row render / first row.
 * Empty collections stay in template mode until a row exists.
 */

import type {
	Collection,
	CollectionCursorMode,
	PageCollectionCursor,
} from "@maket/shared";
import { MessageError } from "../lib/message-error.js";
import type { Bus } from "./bus.js";
import type { Documents } from "./documents.js";
import type { CollectionCursorRecord } from "./sqlite-store/collection-cursor-repository.js";
import type { Store } from "./store.js";

type StoredCollectionCursor = CollectionCursorRecord;

export interface CollectionCursorPatch {
	mode?: CollectionCursorMode;
	/** `null` clears the row selection; `undefined` preserves it. */
	memberId?: string | null;
}

/** A cursor with its row context resolved — what UIs and tools display. */
export interface CollectionCursorView {
	cursor: PageCollectionCursor;
	/** 1-based position of the current row, 0 when no row is selected. */
	rowNumber: number;
	rowCount: number;
	/** First non-empty string value of the current row, for naming it. */
	rowLabel: string | null;
}

export interface CollectionCursors {
	/**
	 * Effective cursor of a page, lazily defaulted to single-row render / first
	 * row. Returns null when the page has no collection binding.
	 */
	resolve(docName: string, pageIndex: number): PageCollectionCursor | null;
	/** Cursor plus row position and label, resolved against the collection. */
	describe(docName: string, pageIndex: number): CollectionCursorView | null;
	/**
	 * Translate a row reference — member id ("member_3") or 1-based row
	 * number ("3") — into the member id of the page's bound collection.
	 * Throws when the page is unbound or the reference matches nothing.
	 */
	memberIdForRow(docName: string, pageIndex: number, row: string): string;
	/**
	 * Move a cursor. Throws when the page is missing, unbound, or the member
	 * does not exist. Emits `collection-cursor:changed` when the cursor
	 * actually moved.
	 */
	set(
		docName: string,
		pageIndex: number,
		patch: CollectionCursorPatch,
	): PageCollectionCursor;
	/** Cursor of every bound page across loaded documents. */
	snapshot(): PageCollectionCursor[];
	/**
	 * Re-align stored cursors with the current documents and collections:
	 * drop cursors of unbound pages, reset cursors whose binding changed
	 * collection, clamp member ids onto existing rows. Emits
	 * `collection-cursor:changed` when anything moved. Wired to bus events
	 * inside the factory.
	 */
	reconcile(): void;
}

export interface CollectionCursorsDeps {
	bus: Bus;
	documents: Documents;
	store: Store;
}

interface CursorContext extends CollectionCursorsDeps {
	cursors: Map<string, StoredCollectionCursor>;
}

/** Builds the context with an explicit field list — spreading the Awilix
 * PROXY would enumerate every container registration, this service included. */
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// This factory is the intended composition boundary: it hydrates the cursor
// repository once and wires domain events to the focused cursor service.
export function createCollectionCursors({
	bus,
	documents,
	store,
}: CollectionCursorsDeps): CollectionCursors {
	const cursors = new Map(
		store
			.loadAllCollectionCursors()
			.map((cursor) => [
				storedCursorKey(cursor.documentId, cursor.pageId),
				cursor,
			]),
	);
	const ctx: CursorContext = { bus, documents, store, cursors };
	const reconcile = () => reconcileCursors(ctx);
	bus.on("collection:saved", reconcile);
	bus.on("collection:deleted", reconcile);
	bus.on("document:created", reconcile);
	bus.on("document:loaded", reconcile);
	bus.on("document:renamed", reconcile);
	bus.on("document:saved", reconcile);
	bus.on("document:deleted", reconcile);

	return {
		resolve: (docName, pageIndex) => resolveCursor(ctx, docName, pageIndex),
		describe: (docName, pageIndex) => describeCursor(ctx, docName, pageIndex),
		memberIdForRow: (docName, pageIndex, row) =>
			memberIdForRow(ctx, docName, pageIndex, row),
		set: (docName, pageIndex, patch) =>
			setCursor(ctx, docName, pageIndex, patch),
		snapshot: () => snapshotCursors(ctx),
		reconcile,
	};
}

function resolveCursor(
	ctx: CursorContext,
	docName: string,
	pageIndex: number,
): PageCollectionCursor | null {
	const cursor = effectiveCursor(ctx, docName, pageIndex);
	return cursor ? clampMember(ctx, cursor) : null;
}

function describeCursor(
	ctx: CursorContext,
	docName: string,
	pageIndex: number,
): CollectionCursorView | null {
	const cursor = resolveCursor(ctx, docName, pageIndex);
	if (!cursor) return null;
	const members = sortedMembers(ctx.store.loadCollection(cursor.collection));
	const index = members.findIndex((member) => member.id === cursor.memberId);
	return {
		cursor,
		rowNumber: cursor.memberId && index >= 0 ? index + 1 : 0,
		rowCount: members.length,
		rowLabel: index >= 0 ? rowLabel(members[index]?.data) : null,
	};
}

function memberIdForRow(
	ctx: CursorContext,
	docName: string,
	pageIndex: number,
	row: string,
): string {
	const cursor = effectiveCursor(ctx, docName, pageIndex);
	if (!cursor) {
		throw new MessageError(
			`Page ${pageIndex + 1} of "${docName}" has no data source.`,
			"msg_page_no_data_source",
			{ page: pageIndex + 1, doc: docName },
		);
	}
	const members = sortedMembers(ctx.store.loadCollection(cursor.collection));
	if (members.some((member) => member.id === row)) return row;
	if (/^\d+$/.test(row)) {
		const member = members[Number(row) - 1];
		if (member) return member.id;
	}
	throw new MessageError(
		`Row "${row}" not found in collection "${cursor.collection}" (${members.length} rows).`,
		"msg_row_not_found",
		{ row, collection: cursor.collection, rows: members.length },
	);
}

function setCursor(
	ctx: CursorContext,
	docName: string,
	pageIndex: number,
	patch: CollectionCursorPatch,
): PageCollectionCursor {
	const doc = ctx.documents.resolveOrLoad(docName);
	if (!doc)
		throw new MessageError(
			`Document "${docName}" not found.`,
			"msg_document_not_found",
			{ name: docName },
		);
	if (!doc.pages[pageIndex])
		throw new MessageError(
			`Page ${pageIndex + 1} not found.`,
			"msg_page_not_found",
			{ page: pageIndex + 1 },
		);
	const current = effectiveCursor(ctx, docName, pageIndex);
	if (!current) {
		throw new MessageError(
			`Page ${pageIndex + 1} of "${docName}" has no data source.`,
			"msg_page_no_data_source",
			{ page: pageIndex + 1, doc: docName },
		);
	}
	const next = patchedCursor(ctx, current, patch);
	const moved =
		next.mode !== current.mode || next.memberId !== current.memberId;
	const page = doc.pages[pageIndex];
	if (!page)
		throw new MessageError(
			`Page ${pageIndex + 1} not found.`,
			"msg_page_not_found",
			{ page: pageIndex + 1 },
		);
	const stored = toStoredCursor(next, doc.id, page.id);
	ctx.cursors.set(storedCursorKey(doc.id, page.id), stored);
	ctx.store.saveCollectionCursor(stored);
	if (moved) ctx.bus.emit("collection-cursor:changed", {});
	return next;
}

function patchedCursor(
	ctx: CursorContext,
	current: PageCollectionCursor,
	patch: CollectionCursorPatch,
): PageCollectionCursor {
	const next: PageCollectionCursor = { ...current };
	const members = sortedMembers(ctx.store.loadCollection(next.collection));
	if (patch.mode !== undefined) next.mode = patch.mode;
	if (patch.memberId !== undefined) {
		if (patch.memberId !== null) {
			if (!members.some((member) => member.id === patch.memberId)) {
				throw new MessageError(
					`Row "${patch.memberId}" not found in collection "${next.collection}".`,
					"msg_row_not_found",
					{
						row: patch.memberId,
						collection: next.collection,
						rows: members.length,
					},
				);
			}
		}
		next.memberId = patch.memberId;
	}
	if (members.length === 0 && next.mode !== "template") {
		throw new MessageError(
			`Collection "${next.collection}" has no rows; use template mode.`,
			"msg_collection_no_rows",
			{ name: next.collection },
		);
	}
	if (next.mode === "rendered" && next.memberId === null) {
		throw new MessageError(
			"Rendered mode requires a current row.",
			"msg_rendered_needs_row",
		);
	}
	return next;
}

function snapshotCursors(ctx: CursorContext): PageCollectionCursor[] {
	const out: PageCollectionCursor[] = [];
	for (const [, doc] of ctx.documents.all()) {
		doc.pages.forEach((page, pageIndex) => {
			if (!page.collection?.name) return;
			const cursor = effectiveCursor(ctx, doc.name, pageIndex);
			if (cursor) out.push(clampMember(ctx, cursor));
		});
	}
	return out;
}

function reconcileCursors(ctx: CursorContext): void {
	let changed = false;
	for (const [key, cursor] of ctx.cursors) {
		const location = cursorLocation(ctx, cursor.documentId, cursor.pageId);
		if (!location?.collectionName) {
			ctx.cursors.delete(key);
			ctx.store.deleteCollectionCursor(cursor.documentId, cursor.pageId);
			changed = true;
			continue;
		}
		const collectionName = location.collectionName;
		const next = clampMember(
			ctx,
			collectionName === cursor.collection
				? toPageCursor(cursor, location.docName, location.pageIndex)
				: defaultCursor(
						ctx,
						location.docName,
						location.pageIndex,
						collectionName,
					),
		);
		if (
			next.collection !== cursor.collection ||
			next.mode !== cursor.mode ||
			next.memberId !== cursor.memberId
		) {
			const stored = toStoredCursor(next, cursor.documentId, cursor.pageId);
			ctx.cursors.set(key, stored);
			ctx.store.saveCollectionCursor(stored);
			changed = true;
		}
	}
	if (changed) ctx.bus.emit("collection-cursor:changed", {});
}

function effectiveCursor(
	ctx: CursorContext,
	docName: string,
	pageIndex: number,
): PageCollectionCursor | null {
	const collectionName = boundCollectionName(ctx, docName, pageIndex);
	if (!collectionName) return null;
	const doc = ctx.documents.resolveOrLoad(docName);
	const page = doc?.pages[pageIndex];
	if (!page) return null;
	const key = storedCursorKey(doc.id, page.id);
	const existing = ctx.cursors.get(key);
	if (!existing || existing.collection !== collectionName) {
		const next = defaultCursor(ctx, docName, pageIndex, collectionName);
		const stored = toStoredCursor(next, doc.id, page.id);
		ctx.cursors.set(key, stored);
		ctx.store.saveCollectionCursor(stored);
		return next;
	}
	return toPageCursor(existing, docName, pageIndex);
}

function defaultCursor(
	ctx: CursorContext,
	docName: string,
	pageIndex: number,
	collectionName: string,
): PageCollectionCursor {
	const members = sortedMembers(ctx.store.loadCollection(collectionName));
	return {
		docName,
		pageIndex,
		collection: collectionName,
		mode: members.length > 0 ? "rendered" : "template",
		memberId: members[0]?.id ?? null,
	};
}

function clampMember(
	ctx: CursorContext,
	cursor: PageCollectionCursor,
): PageCollectionCursor {
	const members = sortedMembers(ctx.store.loadCollection(cursor.collection));
	if (members.length === 0) {
		return { ...cursor, mode: "template", memberId: null };
	}
	if (
		cursor.memberId &&
		members.some((member) => member.id === cursor.memberId)
	) {
		return cursor;
	}
	return { ...cursor, memberId: members[0]?.id ?? null };
}

function boundCollectionName(
	ctx: CursorContext,
	docName: string,
	pageIndex: number,
): string | null {
	const doc = ctx.documents.resolveOrLoad(docName);
	return doc?.pages[pageIndex]?.collection?.name ?? null;
}

function cursorLocation(
	ctx: CursorContext,
	documentId: string,
	pageId: string,
): {
	docName: string;
	pageIndex: number;
	collectionName: string | null;
} | null {
	const doc =
		[...ctx.documents.all().values()].find(
			(document) => document.id === documentId,
		) ?? ctx.store.loadById(documentId);
	if (!doc) return null;
	const pageIndex = doc.pages.findIndex((page) => page.id === pageId);
	if (pageIndex < 0) return null;
	return {
		docName: doc.name,
		pageIndex,
		collectionName: doc.pages[pageIndex]?.collection?.name ?? null,
	};
}

function storedCursorKey(documentId: string, pageId: string): string {
	return `${documentId}\0${pageId}`;
}

function toStoredCursor(
	cursor: PageCollectionCursor,
	documentId: string,
	pageId: string,
): StoredCollectionCursor {
	return {
		documentId,
		pageId,
		collection: cursor.collection,
		mode: cursor.mode,
		memberId: cursor.memberId,
	};
}

function toPageCursor(
	cursor: StoredCollectionCursor,
	docName: string,
	pageIndex: number,
): PageCollectionCursor {
	return {
		docName,
		pageIndex,
		collection: cursor.collection,
		mode: cursor.mode,
		memberId: cursor.memberId,
	};
}

function sortedMembers(collection: Collection | null) {
	return collection
		? [...collection.members].sort((a, b) => a.position - b.position)
		: [];
}

function rowLabel(data: Record<string, unknown> | undefined): string | null {
	const value = Object.values(data ?? {}).find(
		(item) => typeof item === "string" && item.trim(),
	);
	return typeof value === "string" ? value : null;
}
