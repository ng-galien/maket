import {
	type Collection,
	formatCollectionTemplateIssues,
	type PageCollectionCursor,
	resolveCollectionText,
	validateCollectionTemplate,
} from "@maket/shared";
import type { Document, Page } from "../types.js";

export type CollectionRenderMode = "template" | "rendered" | "all";

export interface CollectionRenderSelection {
	mode: CollectionRenderMode;
	memberId?: string | null;
}

export interface CollectionRenderOptions {
	/** Per-page selection keyed by page id — the cursor-accurate form; two
	 * pages bound to the same collection can render differently. Takes
	 * precedence over `collections`. */
	pages?: Record<string, CollectionRenderSelection>;
	/** Per-collection selection keyed by collection name (legacy client
	 * `collection_preview` payloads). */
	collections?: Record<string, CollectionRenderSelection>;
}

/**
 * Build per-page render options from the server-owned cursors so exports
 * show exactly what the preview shows. `force` overrides the cursor mode
 * (explicit "all rows" / "current row" / "template" export choices).
 */
export function cursorRenderOptions(
	doc: Document,
	resolveCursor: (
		docName: string,
		pageIndex: number,
	) => PageCollectionCursor | null,
	force?: CollectionRenderMode,
): CollectionRenderOptions {
	const pages: Record<string, CollectionRenderSelection> = {};
	doc.pages.forEach((page, index) => {
		if (!page.collection?.name) return;
		const cursor = resolveCursor(doc.name, index);
		if (!cursor) return;
		pages[page.id] = { mode: force ?? cursor.mode, memberId: cursor.memberId };
	});
	return { pages };
}

export function renderCollectionDocument(
	doc: Document,
	collections: ReadonlyMap<string, Collection>,
	options: CollectionRenderOptions = {},
): Document {
	const entries = expandRenderEntries(doc, collections, options);
	const pageTotal = entries.length;
	return {
		...doc,
		pages: entries.map((entry, index) =>
			renderEntryPage(entry, index + 1, pageTotal),
		),
		activePage: Math.min(doc.activePage, Math.max(entries.length - 1, 0)),
	};
}

function expandRenderEntries(
	doc: Document,
	collections: ReadonlyMap<string, Collection>,
	options: CollectionRenderOptions,
): RenderEntry[] {
	const entries: RenderEntry[] = [];
	for (const page of doc.pages) {
		if (!page.collection) {
			entries.push({ kind: "static", page });
			continue;
		}
		const collection = collections.get(page.collection.name);
		if (!collection) {
			throw new Error(`Collection "${page.collection.name}" not found.`);
		}
		const issues = validateCollectionTemplate(page.html ?? "", collection);
		if (issues.length > 0) {
			throw new Error(formatCollectionTemplateIssues(issues));
		}
		const members = [...collection.members].sort(
			(a, b) => a.position - b.position,
		);
		entries.push(...collectionEntries(page, collection, members, options));
	}
	return entries;
}

function collectionEntries(
	page: Page,
	collection: Collection,
	members: readonly Collection["members"][number][],
	options: CollectionRenderOptions,
): RenderEntry[] {
	const selection =
		options.pages?.[page.id] ?? options.collections?.[collection.name];
	if (selection?.mode === "template") return [{ kind: "static", page }];
	if (selection?.mode === "rendered") {
		return selectedMemberEntries(page, collection, members, selection.memberId);
	}
	return members.map((member, index) =>
		collectionEntry(page, collection, member, index, members.length),
	);
}

function selectedMemberEntries(
	page: Page,
	collection: Collection,
	members: readonly Collection["members"][number][],
	memberId: string | null | undefined,
): RenderEntry[] {
	const index = members.findIndex((member) => member.id === memberId);
	if (index < 0) {
		throw new Error(
			`Collection member "${memberId ?? ""}" not found in "${collection.name}".`,
		);
	}
	const member = members[index];
	return member
		? [collectionEntry(page, collection, member, index, members.length)]
		: [];
}

function collectionEntry(
	page: Page,
	collection: Collection,
	member: Collection["members"][number],
	memberIndex: number,
	memberTotal: number,
): CollectionRenderEntry {
	return {
		kind: "collection",
		page,
		collection,
		member,
		memberNumber: memberIndex + 1,
		memberTotal,
	};
}

function renderEntryPage(
	entry: RenderEntry,
	pageNumber: number,
	pageTotal: number,
): Page {
	if (entry.kind === "static") return { ...entry.page };
	return {
		...entry.page,
		id: `${entry.page.id}:${entry.collection.name}:${entry.member.id}`,
		name: `${entry.page.name ?? "Page"} - ${entry.memberNumber}`,
		html: entry.page.html
			? resolveCollectionText(entry.page.html, entry.collection, {
					member: entry.member,
					memberNumber: entry.memberNumber,
					memberTotal: entry.memberTotal,
					pageNumber,
					pageTotal,
				})
			: undefined,
	};
}

type RenderEntry = StaticRenderEntry | CollectionRenderEntry;

interface StaticRenderEntry {
	kind: "static";
	page: Page;
}

interface CollectionRenderEntry {
	kind: "collection";
	page: Page;
	collection: Collection;
	member: Collection["members"][number];
	memberNumber: number;
	memberTotal: number;
}
