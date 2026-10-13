/**
 * One query over `structured_workspace_items`: text, filters, sort and group
 * pushed down to SQLite, keyset pagination after the last row's key.
 *
 * Index order: group rank (the `group.order` values first, then the other
 * values by first position), then the sort value (items without one last in
 * both directions; numbers, then text, then booleans), then position, then id.
 * Group keys and filter values compare as JSON text, so "1" and 1 differ.
 */

import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { StructuredWorkspaceGroupValue } from "@maket/shared";

export interface StoredItemQuery {
	workspaceId: string;
	collectionId: string;
	/** Rows whose value at one of `paths` contains `value`, ignoring ASCII case. */
	text?: { value: string; paths: string[] };
	/** Rows whose value at `path` is one of `values`. */
	filters?: Array<{ path: string; values: StructuredWorkspaceGroupValue[] }>;
	sort?: { path: string; direction: "ascending" | "descending" };
	group?: { path: string; order: StructuredWorkspaceGroupValue[] };
	/** The key of the last row of the previous batch. */
	after?: StoredItemKey;
	limit: number;
}

/** Where a row sits in index order. */
export interface StoredItemKey {
	group?: { key: string; rank: number };
	sort?: { missing: number; type: number; value: string | number };
	position: number;
	id: string;
}

export interface StoredItemQueryRow {
	id: string;
	position: number;
	collectionId: string;
	bindingId: string;
	documentId: string;
	documentName: string;
	data: Record<string, unknown> | null;
	revision: number;
	key: StoredItemKey;
}

export interface StoredItemQueryResult {
	rows: StoredItemQueryRow[];
	total: number;
	/** Rows per group key over the whole query, in index order. */
	groups?: Array<{ key: string; count: number }>;
}

export const sortTextFunction = "maket_sort_text";

/** Text as the index orders it: case folded, digit runs compared by value. */
export function sortText(value: unknown): string {
	return String(value)
		.toLocaleLowerCase()
		.replace(/\d+/g, (digits) =>
			digits.replace(/^0+(?=\d)/, "").padStart(20, "0"),
		);
}

/** The SQLite JSON path of a JSON Pointer. */
export function jsonPath(pointer: string): string {
	return `$${pointer
		.slice(1)
		.split("/")
		.map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
		.map((segment) =>
			/^\d+$/.test(segment)
				? `[${segment}]`
				: `."${segment.replaceAll('"', '\\"')}"`,
		)
		.join("")}`;
}

interface Clause {
	sql: string;
	params: Record<string, SQLInputValue>;
}

export function queryStoredItems(
	db: DatabaseSync,
	query: StoredItemQuery,
): StoredItemQueryResult {
	const base = baseClause(query);
	const groups = groupClause(query);
	const ctes = `WITH base AS (${base.sql})${groups ? `, ${groups.sql}` : ""}`;
	const params = { ...base.params, ...(groups?.params ?? {}) };
	const after = afterClause(query);
	const order = orderColumns(query)
		.map((column) => `${column.expr} ${column.direction}`)
		.join(", ");
	const page = db
		.prepare(
			`${ctes} SELECT base.*${groups ? ", groups.grank AS grank" : ""} FROM base${groups ? " JOIN groups ON groups.gkey = base.gkey" : ""}${after ? ` WHERE ${after.sql}` : ""} ORDER BY ${order} LIMIT $limit`,
		)
		.all({ ...params, ...(after?.params ?? {}), $limit: query.limit });
	const groupCounts = groups
		? (db
				.prepare(`${ctes} SELECT gkey, gcount FROM groups ORDER BY grank`)
				.all(params) as Array<{ gkey: string; gcount: number }>)
		: undefined;
	const total = groupCounts
		? groupCounts.reduce((sum, group) => sum + Number(group.gcount), 0)
		: Number(
				(
					db
						.prepare(`${ctes} SELECT count(*) AS total FROM base`)
						.get(params) as { total: number } | undefined
				)?.total ?? 0,
			);
	return {
		rows: page.map((row) => queryRow(row as unknown as RawRow, query)),
		total,
		...(groupCounts
			? {
					groups: groupCounts.map((group) => ({
						key: group.gkey,
						count: Number(group.gcount),
					})),
				}
			: {}),
	};
}

function baseClause(query: StoredItemQuery): Clause {
	const params: Record<string, SQLInputValue> = {
		$workspace: query.workspaceId,
		$collection: query.collectionId,
	};
	const where = ["workspace_id = $workspace", "collection_id = $collection"];
	if (query.text && query.text.paths.length > 0) {
		params.$pattern = `%${query.text.value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
		where.push(
			`(${query.text.paths
				.map((path, index) => {
					params[`$text${index}`] = jsonPath(path);
					return `json_extract(data, $text${index}) LIKE $pattern ESCAPE '\\'`;
				})
				.join(" OR ")})`,
		);
	} else if (query.text) where.push("0");
	where.push(...filterClauses(query.filters ?? [], params));
	const columns = [
		"id",
		"position",
		"collection_id",
		"binding_id",
		"document_id",
		"document_name",
		"data",
		"revision",
	];
	if (query.group) {
		params.$group = jsonPath(query.group.path);
		columns.push("coalesce(data -> $group, 'null') AS gkey");
	}
	if (query.sort) {
		params.$sort = jsonPath(query.sort.path);
		columns.push(
			"CASE WHEN json_type(data, $sort) IS NULL OR json_type(data, $sort) = 'null' THEN 1 ELSE 0 END AS missing",
			"CASE json_type(data, $sort) WHEN 'integer' THEN 0 WHEN 'real' THEN 0 WHEN 'text' THEN 1 WHEN 'true' THEN 2 WHEN 'false' THEN 2 WHEN 'object' THEN 3 WHEN 'array' THEN 3 ELSE 0 END AS trank",
			`CASE WHEN json_type(data, $sort) IS NULL OR json_type(data, $sort) = 'null' THEN 0 WHEN json_type(data, $sort) = 'text' THEN ${sortTextFunction}(json_extract(data, $sort)) ELSE json_extract(data, $sort) END AS sval`,
		);
	}
	return {
		sql: `SELECT ${columns.join(", ")} FROM structured_workspace_items WHERE ${where.join(" AND ")}`,
		params,
	};
}

/** One condition per filter, its path and values bound in `params`; an
 * empty list of values matches no row. */
function filterClauses(
	filters: NonNullable<StoredItemQuery["filters"]>,
	params: Record<string, SQLInputValue>,
): string[] {
	return filters.map((filter, index) => {
		if (filter.values.length === 0) return "0";
		params[`$filter${index}`] = jsonPath(filter.path);
		const values = filter.values.map((value, valueIndex) => {
			const name = `$filter${index}v${valueIndex}`;
			params[name] = JSON.stringify(value);
			return name;
		});
		return `coalesce(data -> $filter${index}, 'null') IN (${values.join(", ")})`;
	});
}

/** Rows and first position per group key, ranked: the ordered values first,
 * the others by first position. */
function groupClause(query: StoredItemQuery): Clause | null {
	if (!query.group) return null;
	const params: Record<string, SQLInputValue> = {};
	const ordered = query.group.order.map((value, index) => {
		params[`$order${index}`] = JSON.stringify(value);
		return `WHEN $order${index} THEN ${index}`;
	});
	const rank = ordered.length
		? `CASE gkey ${ordered.join(" ")} ELSE NULL END`
		: "NULL";
	return {
		sql: `counted AS (SELECT gkey, count(*) AS gcount, min(position) AS first, ${rank} AS ordered FROM base GROUP BY gkey), groups AS (SELECT gkey, gcount, coalesce(ordered, ${ordered.length} + row_number() OVER (PARTITION BY ordered IS NULL ORDER BY first)) AS grank FROM counted)`,
		params,
	};
}

interface OrderColumn {
	expr: string;
	direction: "ASC" | "DESC";
	value: (key: StoredItemKey) => SQLInputValue;
}

function orderColumns(query: StoredItemQuery): OrderColumn[] {
	const direction: OrderColumn["direction"] =
		query.sort?.direction === "descending" ? "DESC" : "ASC";
	return [
		...(query.group
			? [
					{
						expr: "grank",
						direction: "ASC" as const,
						value: (key: StoredItemKey) => key.group?.rank ?? 0,
					},
				]
			: []),
		...(query.sort
			? [
					{
						expr: "missing",
						direction: "ASC" as const,
						value: (key: StoredItemKey) => key.sort?.missing ?? 0,
					},
					{
						expr: "trank",
						direction,
						value: (key: StoredItemKey) => key.sort?.type ?? 0,
					},
					{
						expr: "sval",
						direction,
						value: (key: StoredItemKey) => key.sort?.value ?? 0,
					},
				]
			: []),
		{
			expr: "position",
			direction: "ASC",
			value: (key) => key.position,
		},
		{ expr: "id", direction: "ASC", value: (key) => key.id },
	];
}

/** Rows after `query.after` in index order; the cursor's group takes its
 * current rank, or the rank it had when its group is gone. */
function afterClause(query: StoredItemQuery): Clause | null {
	const after = query.after;
	if (!after) return null;
	const params: Record<string, SQLInputValue> = {};
	const columns = orderColumns(query).map((column, index) => {
		const name = `$after${index}`;
		params[name] = column.value(after);
		return {
			expr: column.expr === "grank" ? "groups.grank" : `base.${column.expr}`,
			bound:
				column.expr === "grank"
					? `coalesce((SELECT grank FROM groups WHERE gkey = $afterGroup), ${name})`
					: name,
			direction: column.direction,
		};
	});
	if (query.group) params.$afterGroup = after.group?.key ?? "null";
	const alternatives = columns.map((column, index) =>
		[
			...columns
				.slice(0, index)
				.map((previous) => `${previous.expr} IS ${previous.bound}`),
			`${column.expr} ${column.direction === "ASC" ? ">" : "<"} ${column.bound}`,
		].join(" AND "),
	);
	return {
		sql: `(${alternatives.map((alternative) => `(${alternative})`).join(" OR ")})`,
		params,
	};
}

interface RawRow {
	id: string;
	position: number;
	collection_id: string;
	binding_id: string;
	document_id: string;
	document_name: string;
	data: string | null;
	revision: number;
	gkey?: string;
	grank?: number;
	missing?: number;
	trank?: number;
	sval?: string | number;
}

function queryRow(row: RawRow, query: StoredItemQuery): StoredItemQueryRow {
	return {
		id: row.id,
		position: Number(row.position),
		collectionId: row.collection_id,
		bindingId: row.binding_id,
		documentId: row.document_id,
		documentName: row.document_name,
		data: row.data === null ? null : JSON.parse(row.data),
		revision: Number(row.revision),
		key: {
			...(query.group
				? {
						group: {
							key: row.gkey ?? "null",
							rank: Number(row.grank ?? 0),
						},
					}
				: {}),
			...(query.sort
				? {
						sort: {
							missing: Number(row.missing ?? 0),
							type: Number(row.trank ?? 0),
							value:
								typeof row.sval === "string" ? row.sval : Number(row.sval ?? 0),
						},
					}
				: {}),
			position: Number(row.position),
			id: row.id,
		},
	};
}
