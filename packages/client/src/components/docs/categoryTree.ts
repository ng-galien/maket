import { categoryPathSegments, normalizeCategoryPath } from "@maket/shared";
import type { DocSummary } from "../../store/types";

export interface CategoryNode<T = DocSummary> {
	name: string;
	path: string;
	docs: T[];
	children: CategoryNode<T>[];
	total: number;
}

interface MutableCategoryNode<T> {
	name: string;
	path: string;
	docs: T[];
	children: Map<string, MutableCategoryNode<T>>;
}

export function buildCategoryTree<T extends { category?: string | null }>(
	docs: T[],
	itemName: (item: T) => string = (item) =>
		"name" in item ? String(item.name) : "",
): CategoryNode<T>[] {
	const roots = new Map<string, MutableCategoryNode<T>>();
	for (const doc of docs) {
		const normalized = normalizeCategoryPath(doc.category);
		const segments = categoryPathSegments(normalized);
		let siblings = roots;
		let path = "";
		let leaf: MutableCategoryNode<T> | null = null;
		for (const segment of segments) {
			path = path ? `${path}/${segment}` : segment;
			let node = siblings.get(segment);
			if (!node) {
				node = { name: segment, path, docs: [], children: new Map() };
				siblings.set(segment, node);
			}
			leaf = node;
			siblings = node.children;
		}
		leaf?.docs.push(doc);
	}
	return finalizeNodes(roots, itemName);
}

function finalizeNodes<T>(
	nodes: Map<string, MutableCategoryNode<T>>,
	itemName: (item: T) => string,
): CategoryNode<T>[] {
	return [...nodes.values()]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((node) => {
			const children = finalizeNodes(node.children, itemName);
			const docs = [...node.docs].sort((a, b) =>
				itemName(a).localeCompare(itemName(b)),
			);
			return {
				name: node.name,
				path: node.path,
				docs,
				children,
				total:
					docs.length + children.reduce((sum, child) => sum + child.total, 0),
			};
		});
}

export function categoryPathsForDocs(docs: DocSummary[]): string[] {
	return flattenCategoryPaths(buildCategoryTree(docs));
}

export function flattenCategoryPaths<T>(nodes: CategoryNode<T>[]): string[] {
	return nodes.flatMap((node) => [
		node.path,
		...flattenCategoryPaths(node.children),
	]);
}

export function visibleDocOrder(
	nodes: CategoryNode[],
	collapsed: Set<string>,
): string[] {
	const names: string[] = [];
	for (const node of nodes) {
		if (collapsed.has(node.path)) continue;
		names.push(...node.docs.map((doc) => doc.name));
		names.push(...visibleDocOrder(node.children, collapsed));
	}
	return names;
}
