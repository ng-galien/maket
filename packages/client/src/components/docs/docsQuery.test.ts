import { describe, expect, it } from "vitest";
import type { DocSummary } from "../../store/types";
import {
	applySearchSuggestion,
	buildQueryChips,
	buildSearchSuggestions,
	matchesQuery,
	parseQuery,
	relativeTime,
	stripToken,
} from "./docsQuery";

function doc(partial: Partial<DocSummary> & { name: string }): DocSummary {
	return {
		id: partial.name,
		category: "general",
		format: "A4",
		pageCount: 1,
		elementCount: 0,
		...partial,
	};
}

describe("docsQuery", () => {
	it("parses multi-criteria tokens", () => {
		expect(parseQuery("@flyer #locked :4 summer")).toEqual({
			category: "flyer",
			locked: true,
			minRating: 4,
			text: "summer",
		});
	});

	it("matches docs against query filters", () => {
		const flyer = doc({
			name: "Summer promo",
			category: "flyer",
			locked: true,
			rating: 5,
		});
		const q = parseQuery("@flyer #locked :4 summer");
		expect(matchesQuery(flyer, q)).toBe(true);
		expect(
			matchesQuery(doc({ name: "Summer promo", category: "poster" }), q),
		).toBe(false);
	});

	it("matches a category node and its descendants", () => {
		const q = parseQuery("@clients/acme");
		expect(
			matchesQuery(
				doc({ name: "Proposal", category: "clients/acme/proposals" }),
				q,
			),
		).toBe(true);
		expect(
			matchesQuery(doc({ name: "Other", category: "clients/other" }), q),
		).toBe(false);
	});

	it("defers an incomplete trailing filter token without blocking results", () => {
		expect(parseQuery("summer @cli", { deferLastFilterToken: true })).toEqual({
			category: null,
			locked: null,
			minRating: 0,
			text: "summer",
		});
		expect(
			parseQuery("summer @clients ", { deferLastFilterToken: true }),
		).toEqual({
			category: "clients",
			locked: null,
			minRating: 0,
			text: "summer",
		});
	});

	it("ignores invalid filter-like tokens instead of turning them into text", () => {
		expect(parseQuery("@ #unknown :9 proposal")).toEqual({
			category: null,
			locked: null,
			minRating: 0,
			text: "proposal",
		});
	});

	it("suggests category paths and commits the active token", () => {
		const suggestions = buildSearchSuggestions("summer @ac", [
			"clients",
			"clients/acme",
			"products",
		]);
		expect(suggestions.map((suggestion) => suggestion.token)).toEqual([
			"@clients/acme",
		]);
		const suggestion = suggestions[0];
		expect(suggestion).toBeDefined();
		if (!suggestion) return;
		expect(applySearchSuggestion("summer @ac", suggestion)).toBe(
			"summer @clients/acme ",
		);
	});

	it("suggests status and rating tokens from their first character", () => {
		expect(buildSearchSuggestions("#", []).map((item) => item.token)).toEqual([
			"#locked",
			"#unlocked",
		]);
		expect(buildSearchSuggestions(":4", [])[0]?.token).toBe(":4");
	});

	it("strips tokens and builds removable chips", () => {
		const search = "@flyer #locked :3";
		const query = parseQuery(search);
		const chips = buildQueryChips(query, search, () => {});
		expect(chips.map((c) => c.key)).toEqual(["cat", "lock", "rating"]);
		expect(stripToken(search, (t) => t === "#locked")).toBe("@flyer :3");
	});

	it("formats relative time in fr and en", () => {
		const ts = new Date(Date.now() - thrMinutes(5)).toISOString();
		expect(relativeTime(ts, "en")).toMatch(/m ago|just now/);
		expect(relativeTime(ts, "fr")).toMatch(/min|instant/);
	});
});

function thrMinutes(n: number): number {
	return n * 60_000;
}
