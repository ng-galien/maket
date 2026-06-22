import {
	type Collection,
	formatCollectionTemplateIssues,
	resolveCollectionText,
	validateCollectionTemplate,
} from "@maket/shared";
import type { Document, Page } from "../types.js";

export function renderCollectionDocument(
	doc: Document,
	collections: ReadonlyMap<string, Collection>,
): Document {
	const entries = expandRenderEntries(doc, collections);
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
		for (let memberIndex = 0; memberIndex < members.length; memberIndex++) {
			const member = members[memberIndex];
			if (!member) continue;
			entries.push({
				kind: "collection",
				page,
				collection,
				member,
				memberNumber: memberIndex + 1,
				memberTotal: members.length,
			});
		}
	}
	return entries;
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
