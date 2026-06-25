import type { Collection } from "@maket/shared";

export interface PasteAnchor {
	memberId: string;
	fieldKey: string;
}

const fieldKeyPattern = /^[a-z][a-z0-9_]*$/;

export function parseTabularClipboard(text: string): string[][] {
	const source = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const trimmed = source.endsWith("\n") ? source.slice(0, -1) : source;
	if (!trimmed) return [];
	const rows = trimmed.split("\n");
	if (trimmed.includes("\t")) return rows.map((row) => row.split("\t"));
	return rows.map(parseCsvRow);
}

export function applyPastedTable(
	collection: Collection,
	anchor: PasteAnchor,
	rows: readonly string[][],
): Collection {
	if (rows.length === 0) return collection;
	const fields = collectionFields(collection);
	const header = headerMapping(rows[0] ?? [], fields);
	const dataRows = header ? rows.slice(1) : rows;
	if (dataRows.length === 0) return collection;
	const targetFields =
		header ?? anchoredFields(fields, anchor.fieldKey, rows[0] ?? []);
	return withPastedRows(collection, anchor.memberId, targetFields, dataRows);
}

function parseCsvRow(row: string): string[] {
	const cells: string[] = [];
	let cell = "";
	let quoted = false;
	for (let index = 0; index < row.length; index += 1) {
		const char = row[index];
		const next = row[index + 1];
		if (char === '"' && quoted && next === '"') {
			cell += '"';
			index += 1;
		} else if (char === '"') quoted = !quoted;
		else if (char === "," && !quoted) {
			cells.push(cell);
			cell = "";
		} else cell += char;
	}
	cells.push(cell);
	return cells;
}

function headerMapping(
	row: readonly string[],
	fields: readonly string[],
): string[] | null {
	const normalized = row.map((cell) => normalizeFieldKey(cell));
	if (normalized.length === 0 || normalized.some((key) => !key)) return null;
	const keys = normalized.filter((key): key is string => key !== null);
	const fieldSet = new Set(fields);
	const existing = keys.some((key) => fieldSet.has(key));
	const explicit = row.every((cell) => looksLikeHeader(cell));
	if (!existing && !explicit) return null;
	return keys.every((key) => fieldKeyPattern.test(key)) ? keys : null;
}

function anchoredFields(
	fields: readonly string[],
	anchorField: string,
	firstRow: readonly string[],
): string[] {
	const start = Math.max(0, fields.indexOf(anchorField));
	const targets = fields.slice(start, start + firstRow.length);
	return firstRow.map(
		(_, index) => targets[index] ?? `field_${start + index + 1}`,
	);
}

function withPastedRows(
	collection: Collection,
	anchorMemberId: string,
	fields: readonly string[],
	rows: readonly string[][],
): Collection {
	const start = Math.max(
		0,
		sortedMembers(collection).findIndex(
			(member) => member.id === anchorMemberId,
		),
	);
	const schema = withFields(collection, fields);
	const members = [...sortedMembers(collection)];
	for (let index = 0; index < rows.length; index += 1) {
		const targetIndex = start + index;
		const current = members[targetIndex] ?? {
			id: nextMemberId({ ...collection, members }),
			position: targetIndex,
			data: {},
		};
		members[targetIndex] = {
			...current,
			position: targetIndex,
			data: {
				...current.data,
				...rowData(fields, rows[index] ?? []),
			},
		};
	}
	return {
		...collection,
		schema,
		members: members.map((member, position) => ({ ...member, position })),
	};
}

function rowData(
	fields: readonly string[],
	row: readonly string[],
): Record<string, unknown> {
	return Object.fromEntries(
		fields.map((field, index) => [field, row[index] ?? ""]),
	);
}

function withFields(
	collection: Collection,
	fields: readonly string[],
): Collection["schema"] {
	const properties = { ...schemaProperties(collection) };
	for (const field of fields) {
		if (!properties[field])
			properties[field] = { type: "string", title: fieldTitle(field) };
	}
	return {
		...collection.schema,
		type: "object",
		properties,
	};
}

function collectionFields(collection: Collection): string[] {
	return Object.keys(schemaProperties(collection));
}

function schemaProperties(collection: Collection): Record<string, unknown> {
	const properties = collection.schema.properties;
	return properties && typeof properties === "object" ? properties : {};
}

function sortedMembers(collection: Collection): Collection["members"] {
	return [...collection.members].sort((a, b) => a.position - b.position);
}

function normalizeFieldKey(value: string): string | null {
	const key = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return fieldKeyPattern.test(key) ? key : null;
}

function looksLikeHeader(value: string): boolean {
	const trimmed = value.trim();
	return /^[a-z][a-z0-9_]*$/.test(trimmed) || trimmed.includes("_");
}

function fieldTitle(key: string): string {
	return key
		.split("_")
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(" ");
}

function nextMemberId(collection: Collection): string {
	let index = collection.members.length + 1;
	let id = `member_${index}`;
	while (collection.members.some((member) => member.id === id)) {
		index += 1;
		id = `member_${index}`;
	}
	return id;
}
