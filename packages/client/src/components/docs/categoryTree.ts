import { categoryPathSegments, normalizeCategoryPath } from "@maket/shared";
import type { DocSummary } from "../../store/types";

export interface CategoryNode {
	name: string;
	path: string;
	docs: DocSummary[];
	children: CategoryNode[];
	total: number;
}

interface MutableCategoryNode {
	name: string;
	path: string;
	docs: DocSummary[];
	children: Map<string, MutableCategoryNode>;
}

export function buildCategoryTree(docs: DocSummary[]): CategoryNode[] {
	const roots = new Map<string, MutableCategoryNode>();
	for (const doc of docs) {
		const normalized = normalizeCategoryPath(doc.category);
		const segments = categoryPathSegments(normalized);
		let siblings = roots;
		let path = "";
		let leaf: MutableCategoryNode | null = null;
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
	return finalizeNodes(roots);
}

function finalizeNodes(
	nodes: Map<string, MutableCategoryNode>,
): CategoryNode[] {
	return [...nodes.values()]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((node) => {
			const children = finalizeNodes(node.children);
			const docs = [...node.docs].sort((a, b) => a.name.localeCompare(b.name));
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

function flattenCategoryPaths(nodes: CategoryNode[]): string[] {
	return nodes.flatMap((node) => [
		node.path,
		...flattenCategoryPaths(node.children),
	]);
}

export function visibleDocOrder(
	nodes: CategoryNode[],
	searching: boolean,
	collapsed: Set<string>,
): string[] {
	const names: string[] = [];
	for (const node of nodes) {
		if (!searching && collapsed.has(node.path)) continue;
		names.push(...node.docs.map((doc) => doc.name));
		names.push(...visibleDocOrder(node.children, searching, collapsed));
	}
	return names;
}
