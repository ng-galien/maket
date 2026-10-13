/**
 * Group values of items: the value a group pointer reads, its key and its
 * label, shared by the index composition and the collection window.
 */

import { readJsonPointer } from "@maket/shared";

type ItemData = Record<string, unknown>;

/** The value at `pointer` in item data; null when absent or unreadable. */
export function itemValue(data: ItemData, pointer: string): unknown {
	try {
		return readJsonPointer(data, pointer) ?? null;
	} catch {
		return null;
	}
}

export function itemGroupKey(value: unknown): string {
	return JSON.stringify(value ?? null);
}

export function itemGroupLabel(value: unknown): string {
	if (value === null || value === undefined || value === "") return "—";
	return typeof value === "object" ? JSON.stringify(value) : String(value);
}
