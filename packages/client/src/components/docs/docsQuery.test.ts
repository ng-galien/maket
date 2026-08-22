import { describe, expect, it } from "vitest";
import type { DocSummary } from "../../store/types";
import {
	addCategoryFilter,
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
		collectionBindings: [],
		...partial,
	};
}

describe("docsQuery", () => {
	it("parses multi-criteria tokens", () => {
		expect(parseQuery("@flyer #locked :4 summer")).toEqual({
			categories: ["flyer"],
			locked: true,
			minRating: 4,
			text: "summer",
		});
	});

	it("accumulates category filters without duplicating them", () => {
		expect(
			parseQuery('@flyer "@Clients grands comptes/Acme" @FLYER'),
		).toMatchObject({
			categories: ["flyer", "clients grands comptes/acme"],
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

	it("matches document names without requiring typed accents", () => {
		expect(
			matchesQuery(doc({ name: "Étiquette Instant Doré" }), parseQuery("ETI")),
		).toBe(true);
		expect(matchesQuery(doc({ name: "Etiquette" }), parseQuery("éti"))).toBe(
			true,
		);
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

	it("combines categories with OR and the remaining criteria with AND", () => {
		const query = parseQuery("@flyer @poster #locked :4 summer");
		expect(
			matchesQuery(
				doc({
					name: "Summer flyer",
					category: "flyer/events",
					locked: true,
					rating: 4,
				}),
				query,
			),
		).toBe(true);
		expect(
			matchesQuery(
				doc({
					name: "Summer poster",
					category: "poster",
					locked: false,
					rating: 5,
				}),
				query,
			),
		).toBe(false);
	});

	it("defers an incomplete trailing filter token without blocking results", () => {
		expect(parseQuery("summer @cli", { deferLastFilterToken: true })).toEqual({
			categories: [],
			locked: null,
			minRating: 0,
			text: "summer",
		});
		expect(
			parseQuery("summer @clients ", { deferLastFilterToken: true }),
		).toEqual({
			categories: ["clients"],
			locked: null,
			minRating: 0,
			text: "summer",
		});
	});

	it("ignores invalid filter-like tokens instead of turning them into text", () => {
		expect(parseQuery("@ #unknown :9 proposal")).toEqual({
			categories: [],
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

	it("suggests accented categories from an unaccented token", () => {
		expect(buildSearchSuggestions("@eti", ["Étiquettes"])[0]?.token).toBe(
			"@Étiquettes",
		);
	});

	it("quotes category suggestions containing spaces and filters them as one token", () => {
		const suggestion = buildSearchSuggestions("@cli", [
			"Clients grands comptes/Acme",
		])[0];
		expect(suggestion?.token).toBe('"@Clients grands comptes/Acme"');
		if (!suggestion) return;
		const search = applySearchSuggestion("@cli", suggestion);
		expect(search).toBe('"@Clients grands comptes/Acme" ');
		const query = parseQuery(search, { deferLastFilterToken: true });
		expect(query.categories).toEqual(["clients grands comptes/acme"]);
		expect(
			matchesQuery(
				doc({
					name: "Proposition",
					category: "Clients grands comptes/Acme/Propositions",
				}),
				query,
			),
		).toBe(true);
	});

	it("suggests status and rating tokens from their first character", () => {
		expect(buildSearchSuggestions("#", []).map((item) => item.token)).toEqual([
			"#locked",
			"#unlocked",
		]);
		expect(buildSearchSuggestions(":4", [])[0]?.token).toBe(":4");
	});

	it("adds, clears, and renders independent category filter chips", () => {
		const initial = '#locked :3 brief "@Clients grands comptes/Acme"';
		const search = addCategoryFilter(initial, "flyer");
		expect(search).toBe(
			'#locked :3 brief "@Clients grands comptes/Acme" @flyer ',
		);
		expect(addCategoryFilter(search, "FLYER")).toBe(search);
		expect(addCategoryFilter(search, "")).toBe("#locked :3 brief");

		const query = parseQuery(search);
		let updatedSearch = "";
		const chips = buildQueryChips(query, search, (value) => {
			updatedSearch = value;
		});
		expect(chips.map((c) => c.key)).toEqual([
			"cat:clients grands comptes/acme",
			"cat:flyer",
			"lock",
			"rating",
		]);
		chips[0]?.onRemove();
		expect(updatedSearch).toBe("#locked :3 brief @flyer ");
		expect(
			parseQuery(updatedSearch, { deferLastFilterToken: true }).categories,
		).toEqual(["flyer"]);
		expect(stripToken(search, (t) => t === "#locked")).toBe(
			':3 brief "@Clients grands comptes/Acme" @flyer',
		);
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
