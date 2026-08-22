import { categoryPathContains, normalizeCategoryPath } from "@maket/shared";
import type { DocSummary } from "../../store/types";
import type { Query, QueryChip } from "./types";

export interface SearchSuggestion {
	id: string;
	token: string;
	label: string;
	kind: "category" | "status" | "rating";
}

interface ParseQueryOptions {
	deferLastFilterToken?: boolean;
}

/**
 * Multi-criteria search parser.
 *   @cat       — restrict to category `cat`
 *   #locked    — only locked docs
 *   #unlocked  — only unlocked docs
 *   :N         — rating ≥ N (1–5)
 *   <rest>     — fuzzy substring on name
 * Tokens accumulate. Categories combine as OR; the other criteria combine as
 * AND. `@flyer @poster #locked :4 summer` means
 * "(flyer OR poster) AND locked AND rating≥4 AND name contains summer".
 */
export function parseQuery(
	raw: string,
	options: ParseQueryOptions = {},
): Query {
	const tokens = tokenizeSearch(raw);
	const categories: string[] = [];
	let locked: boolean | null = null;
	let minRating = 0;
	const text: string[] = [];
	for (const [index, token] of tokens.entries()) {
		const tok = token.value;
		const deferred =
			options.deferLastFilterToken === true &&
			index === tokens.length - 1 &&
			!/\s$/.test(raw) &&
			/^[#@:]/.test(tok) &&
			!token.quoted;
		if (deferred) continue;
		if (tok.startsWith("@") && tok.length > 1) {
			const category = normalizeCategoryPath(tok.slice(1)).toLowerCase();
			if (category && !categories.includes(category)) categories.push(category);
		} else if (tok === "#locked") {
			locked = true;
		} else if (tok === "#unlocked") {
			locked = false;
		} else if (/^:[1-5]$/.test(tok)) {
			minRating = Math.max(minRating, Number(tok.slice(1)));
		} else if (/^[#@:]/.test(tok)) {
		} else {
			text.push(tok);
		}
	}
	return {
		categories,
		locked,
		minRating,
		text: foldSearchText(text.join(" ")),
	};
}

export function matchesQuery(d: DocSummary, q: Query): boolean {
	if (
		q.categories.length > 0 &&
		!q.categories.some((category) => categoryPathContains(d.category, category))
	)
		return false;
	if (q.locked !== null && (d.locked === true) !== q.locked) return false;
	if (q.minRating > 0 && (d.rating ?? 0) < q.minRating) return false;
	if (q.text && !foldSearchText(d.name).includes(q.text)) return false;
	return true;
}

function foldSearchText(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}

export function buildSearchSuggestions(
	raw: string,
	categories: string[],
): SearchSuggestion[] {
	const active = activeFilterToken(raw);
	if (!active) return [];
	if (active.startsWith("@")) {
		const query = active.slice(1).toLowerCase();
		return categories
			.map(normalizeCategoryPath)
			.filter((path, index, all) => all.indexOf(path) === index)
			.filter((path) => categorySuggestionMatches(path, query))
			.sort(
				(a, b) =>
					categorySuggestionRank(a, query) - categorySuggestionRank(b, query) ||
					a.localeCompare(b),
			)
			.slice(0, 8)
			.map((path) => ({
				id: `category:${path}`,
				token: quoteSearchToken(`@${path}`),
				label: path,
				kind: "category" as const,
			}));
	}
	if (active.startsWith("#")) {
		return ["#locked", "#unlocked"]
			.filter((token) => token.startsWith(active.toLowerCase()))
			.map((token) => ({
				id: `status:${token}`,
				token,
				label: token,
				kind: "status" as const,
			}));
	}
	return [1, 2, 3, 4, 5]
		.map((rating) => `:${rating}`)
		.filter((token) => token.startsWith(active))
		.map((token) => ({
			id: `rating:${token}`,
			token,
			label: `${token}  ${"★".repeat(Number(token.slice(1)))}`,
			kind: "rating" as const,
		}));
}

function activeFilterToken(raw: string): string | null {
	if (/\s$/.test(raw)) return null;
	const active = raw.match(/(?:^|\s)(\S+)$/)?.[1] ?? null;
	return active && /^[#@:]/.test(active) ? active : null;
}

function categorySuggestionMatches(path: string, query: string): boolean {
	if (!query) return true;
	const normalized = foldSearchText(path);
	const foldedQuery = foldSearchText(query);
	return (
		normalized.startsWith(foldedQuery) ||
		normalized.split("/").some((segment) => segment.startsWith(foldedQuery))
	);
}

function categorySuggestionRank(path: string, query: string): number {
	const normalized = foldSearchText(path);
	const foldedQuery = foldSearchText(query);
	if (!foldedQuery || normalized.startsWith(foldedQuery)) return 0;
	if (normalized.split("/").some((segment) => segment.startsWith(foldedQuery)))
		return 1;
	return Number.POSITIVE_INFINITY;
}

export function applySearchSuggestion(
	raw: string,
	suggestion: SearchSuggestion,
): string {
	const match = raw.match(/(?:^|\s)(\S+)$/);
	if (!match || match.index === undefined) return `${raw}${suggestion.token} `;
	const tokenStart = match.index + match[0].length - (match[1]?.length ?? 0);
	return `${raw.slice(0, tokenStart)}${suggestion.token} `;
}

export function stripToken(
	raw: string,
	predicate: (tok: string) => boolean,
): string {
	return tokenizeSearch(raw)
		.filter((token) => !predicate(token.value))
		.map((token) => token.raw)
		.join(" ");
}

interface SearchToken {
	raw: string;
	value: string;
	quoted: boolean;
}

function tokenizeSearch(raw: string): SearchToken[] {
	return (raw.match(/"(?:\\.|[^"\\])*"|[^\s]+/g) ?? []).map((token) => {
		const quoted = token.startsWith('"') && token.endsWith('"');
		return {
			raw: token,
			quoted,
			value: quoted ? token.slice(1, -1).replace(/\\(["\\])/g, "$1") : token,
		};
	});
}

function quoteSearchToken(token: string): string {
	if (!/\s/.test(token)) return token;
	return `"${token.replace(/["\\]/g, "\\$&")}"`;
}

function committedSearch(raw: string): string {
	const search = raw.trim();
	return search ? `${search} ` : "";
}

export function addCategoryFilter(search: string, path: string): string {
	if (!path.trim()) {
		return stripToken(search, (token) => token.startsWith("@"));
	}
	const category = normalizeCategoryPath(path);
	const token = `@${category}`;
	const alreadyPresent = tokenizeSearch(search).some(
		(item) => item.value.toLowerCase() === token.toLowerCase(),
	);
	if (alreadyPresent) return search;
	return `${[search.trim(), quoteSearchToken(token)].filter(Boolean).join(" ")} `;
}

export function buildQueryChips(
	query: Query,
	search: string,
	setSearch: (value: string) => void,
): QueryChip[] {
	const chips: QueryChip[] = [];
	for (const category of query.categories) {
		chips.push({
			key: `cat:${category}`,
			label: `@${category}`,
			onRemove: () =>
				setSearch(
					committedSearch(
						stripToken(
							search,
							(token) => token.toLowerCase() === `@${category}`,
						),
					),
				),
		});
	}
	if (query.locked !== null) {
		const token = query.locked ? "#locked" : "#unlocked";
		chips.push({
			key: "lock",
			label: token,
			onRemove: () =>
				setSearch(
					committedSearch(stripToken(search, (item) => item === token)),
				),
		});
	}
	if (query.minRating > 0) {
		chips.push({
			key: "rating",
			label: `≥ ${"★".repeat(query.minRating)}`,
			onRemove: () =>
				setSearch(
					committedSearch(
						stripToken(search, (token) => /^:[1-5]$/.test(token)),
					),
				),
		});
	}
	return chips;
}

/**
 * SQLite emits timestamps as "YYYY-MM-DD HH:mm:ss" in UTC. Convert to a
 * Date; fall back to a best-effort ISO replacement.
 */
export function parseTimestamp(ts: string | undefined): Date | null {
	if (!ts) return null;
	const iso = ts.includes("T") ? ts : `${ts.replace(" ", "T")}Z`;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d;
}

export function relativeTime(ts: string | undefined, lang: string): string {
	const d = parseTimestamp(ts);
	if (!d) return "";
	const diffMs = Date.now() - d.getTime();
	const m = Math.round(diffMs / 60000);
	const fr = lang.startsWith("fr");
	if (m < 1) return fr ? "à l'instant" : "just now";
	if (m < 60) return fr ? `il y a ${m} min` : `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return fr ? `il y a ${h} h` : `${h}h ago`;
	const days = Math.round(h / 24);
	if (days < 30) return fr ? `il y a ${days} j` : `${days}d ago`;
	const months = Math.round(days / 30);
	if (months < 12) return fr ? `il y a ${months} mois` : `${months}mo ago`;
	const years = Math.round(months / 12);
	return fr ? `il y a ${years} an${years > 1 ? "s" : ""}` : `${years}y ago`;
}
