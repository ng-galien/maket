/**
 * Index order of items: groups, then `sortBy` inside each group. The index
 * composition and the local connector order items with these functions so
 * both agree to the byte.
 */

import {
	readJsonPointer,
	type StructuredWorkspaceCollectionRepresentation,
	type StructuredWorkspaceGroupValue,
} from "@maket/shared";

type ItemData = Record<string, unknown>;

export interface ItemGroup<T> {
	value: unknown;
	label: string;
	entries: T[];
}

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

/** Groups by `groupBy`: the values of `groupOrder` first, in that order,
 * then the others in order of first appearance; empty groups are dropped. */
export function groupItems<T>(
	entries: T[],
	dataOf: (entry: T) => ItemData,
	order: { groupBy: string; groupOrder: StructuredWorkspaceGroupValue[] },
): ItemGroup<T>[] {
	const groups = new Map<string, ItemGroup<T>>();
	for (const value of order.groupOrder) {
		groups.set(itemGroupKey(value), {
			value,
			label: itemGroupLabel(value),
			entries: [],
		});
	}
	for (const entry of entries) {
		const value = itemValue(dataOf(entry), order.groupBy);
		const key = itemGroupKey(value);
		const group = groups.get(key) ?? {
			value,
			label: itemGroupLabel(value),
			entries: [],
		};
		group.entries.push(entry);
		groups.set(key, group);
	}
	return [...groups.values()].filter((group) => group.entries.length > 0);
}

/** Entries ordered by `sortBy`; without it, the given order. Items without a
 * value come last in both directions; equal values keep the given order. */
export function sortItems<T>(
	entries: T[],
	dataOf: (entry: T) => ItemData,
	order: Pick<
		StructuredWorkspaceCollectionRepresentation,
		"sortBy" | "sortDirection"
	>,
): T[] {
	const { sortBy } = order;
	if (sortBy === undefined) return entries;
	const sign = order.sortDirection === "descending" ? -1 : 1;
	return entries
		.map((entry) => ({ entry, value: itemValue(dataOf(entry), sortBy) }))
		.sort((left, right) => {
			const leftMissing = left.value === null;
			const rightMissing = right.value === null;
			if (leftMissing || rightMissing) {
				return Number(leftMissing) - Number(rightMissing);
			}
			return sign * compareSortValues(left.value, right.value);
		})
		.map(({ entry }) => entry);
}

function compareSortValues(left: unknown, right: unknown): number {
	const rank = (value: unknown) =>
		typeof value === "number"
			? 0
			: typeof value === "string"
				? 1
				: typeof value === "boolean"
					? 2
					: 3;
	const byRank = rank(left) - rank(right);
	if (byRank !== 0) return byRank;
	if (typeof left === "number" && typeof right === "number") {
		return left - right;
	}
	if (typeof left === "string" && typeof right === "string") {
		return left.localeCompare(right, undefined, { numeric: true });
	}
	if (typeof left === "boolean" && typeof right === "boolean") {
		return Number(left) - Number(right);
	}
	return JSON.stringify(left).localeCompare(JSON.stringify(right));
}
