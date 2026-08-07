import { describe, expect, it } from "vitest";
import type { DocSummary } from "../../store/types";
import {
	buildCategoryTree,
	categoryPathsForDocs,
	visibleDocOrder,
} from "./categoryTree";

function doc(name: string, category: string): DocSummary {
	return {
		id: name,
		name,
		category,
		format: "A4",
		pageCount: 1,
		elementCount: 0,
	};
}

describe("category tree", () => {
	const docs = [
		doc("Proposal", "clients/acme/proposals"),
		doc("Brief", "clients/acme"),
		doc("Poster", "campaigns"),
	];

	it("derives a stable hierarchy and descendant totals", () => {
		const tree = buildCategoryTree(docs);
		expect(tree.map((node) => node.path)).toEqual(["campaigns", "clients"]);
		const clients = tree[1];
		expect(clients?.total).toBe(2);
		expect(clients?.children[0]?.path).toBe("clients/acme");
		expect(clients?.children[0]?.children[0]?.path).toBe(
			"clients/acme/proposals",
		);
	});

	it("offers every derived path for pickers and search", () => {
		expect(categoryPathsForDocs(docs)).toEqual([
			"campaigns",
			"clients",
			"clients/acme",
			"clients/acme/proposals",
		]);
	});

	it("omits descendants of a collapsed path from selection order", () => {
		const tree = buildCategoryTree(docs);
		expect(visibleDocOrder(tree, false, new Set(["clients/acme"]))).toEqual([
			"Poster",
		]);
		expect(visibleDocOrder(tree, true, new Set(["clients/acme"]))).toEqual([
			"Poster",
			"Brief",
			"Proposal",
		]);
	});
});
