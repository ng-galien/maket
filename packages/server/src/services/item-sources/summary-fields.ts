/**
 * Which keys of an item's data an index summary carries: the template
 * fields of its binding, the roots of the sort and group pointers, and every
 * key the compact templates or the index pages mention. A template that may
 * read the whole item (root reference, form card, pointer outside the data)
 * keeps the whole data, so a card renders exactly as from the full item.
 */

import {
	type StructuredWorkspaceDataSchema,
	structuredWorkspaceTemplateFields,
} from "@maket/shared";
import type { Page } from "../../types.js";

export interface SummaryFieldRule {
	whole: boolean;
	names: ReadonlySet<string>;
	texts: readonly string[];
}

export interface SummaryFieldSources {
	bindingSchema: StructuredWorkspaceDataSchema;
	compactPages: ReadonlyArray<Pick<Page, "html" | "jsonForms">>;
	indexPages: ReadonlyArray<Pick<Page, "html">>;
	pointers: ReadonlyArray<string | undefined>;
}

const wholeStateReference =
	/\{\{\s*[#^&{]?\s*(?:state|\.)\s*\}?\s*\}\}|data-maket-(?:bind|path)\s*=\s*["']\s*(?:state|\/)?\s*["']/;

export function summaryFieldRule(
	sources: SummaryFieldSources,
): SummaryFieldRule {
	const texts = [
		...sources.compactPages.map((page) => page.html ?? ""),
		...sources.indexPages.map((page) => page.html ?? ""),
	].filter((text) => text.length > 0);
	const roots = sources.pointers.flatMap((pointer) =>
		pointer === undefined ? [] : [pointerRoot(pointer)],
	);
	const whole =
		roots.includes(null) ||
		sources.compactPages.some((page) => page.jsonForms !== undefined) ||
		texts.some((text) => wholeStateReference.test(text));
	return {
		whole,
		names: new Set([
			...structuredWorkspaceTemplateFields(sources.bindingSchema).map(
				(field) => field.name,
			),
			...roots.flatMap((root) => (root === null ? [] : [root])),
		]),
		texts,
	};
}

/** The keys of `data` the rule keeps, in the order of `data`. */
export function summaryFields(
	data: Record<string, unknown>,
	rule: SummaryFieldRule,
): Record<string, unknown> {
	if (rule.whole) return data;
	return Object.fromEntries(
		Object.entries(data).filter(
			([key]) =>
				rule.names.has(key) || rule.texts.some((text) => text.includes(key)),
		),
	);
}

/** The first key a JSON Pointer reads, or null when it reads the whole data. */
function pointerRoot(pointer: string): string | null {
	if (!pointer.startsWith("/")) return null;
	const [first = ""] = pointer.slice(1).split("/");
	return first.replaceAll("~1", "/").replaceAll("~0", "~");
}
