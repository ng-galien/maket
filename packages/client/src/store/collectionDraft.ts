import type { Collection, CollectionField } from "@maket/shared";

export type CollectionFieldType = "string" | "number" | "boolean";
export type AddCollectionFieldResult =
	| { ok: true; collection: Collection }
	| { ok: false; reason: "invalid" | "duplicate" };

const collectionFieldKeyPattern = /^[a-z][a-z0-9_]*$/;

export function addCollectionField(
	collection: Collection,
	rawName: string,
	type: CollectionFieldType,
): AddCollectionFieldResult {
	const key = rawName.trim();
	if (!collectionFieldKeyPattern.test(key)) {
		return { ok: false, reason: "invalid" };
	}
	if (collectionSchemaProperties(collection)[key]) {
		return { ok: false, reason: "duplicate" };
	}
	return {
		ok: true,
		collection: withOptionalCollectionField(collection, key, type),
	};
}

export function collectionHasChanged(
	source: Collection | undefined,
	draft: Collection,
): boolean {
	return source ? JSON.stringify(source) !== JSON.stringify(draft) : true;
}

export function sortedCollectionMembers(
	collection: Collection | undefined | null,
): Collection["members"] {
	return collection
		? [...collection.members].sort((a, b) => a.position - b.position)
		: [];
}

export function addCollectionRow(
	collection: Collection,
	fields: CollectionField[],
): Collection {
	const data: Record<string, unknown> = {};
	for (const field of fields) {
		const value = defaultValueFor(collection, field);
		if (value !== undefined) data[field.key] = value;
	}
	return {
		...collection,
		members: [
			...collection.members,
			{
				id: nextMemberId(collection),
				position: nextMemberPosition(collection),
				data,
			},
		],
	};
}

export function removeCollectionRow(
	collection: Collection,
	memberId: string,
): Collection {
	return {
		...collection,
		members: collection.members
			.filter((member) => member.id !== memberId)
			.map((member, position) => ({ ...member, position })),
	};
}

export function duplicateCollectionRow(
	collection: Collection,
	memberId: string,
): Collection {
	const sourceIndex = collection.members.findIndex(
		(member) => member.id === memberId,
	);
	const source = collection.members[sourceIndex];
	if (sourceIndex < 0 || !source) return collection;
	const members = [...collection.members];
	members.splice(sourceIndex + 1, 0, {
		...source,
		id: nextMemberId(collection),
		data: { ...source.data },
	});
	return {
		...collection,
		members: members.map((member, position) => ({ ...member, position })),
	};
}

/** Adds a schema property without requiring it on existing rows. */
export function withOptionalCollectionField(
	collection: Collection,
	key: string,
	type: CollectionFieldType,
): Collection {
	return {
		...collection,
		schema: {
			...collection.schema,
			type: "object",
			properties: {
				...collectionSchemaProperties(collection),
				[key]: { type, title: fieldTitle(key) },
			},
		},
	};
}

export function removeCollectionField(
	collection: Collection,
	key: string,
): Collection {
	const properties = { ...collectionSchemaProperties(collection) };
	delete properties[key];
	return {
		...collection,
		schema: {
			...collection.schema,
			properties,
			required: requiredFields(collection).filter((field) => field !== key),
		},
		members: collection.members.map((member) => ({
			...member,
			data: withoutCollectionKey(member.data, key),
		})),
	};
}

export function withCollectionFieldRequired(
	collection: Collection,
	key: string,
	required: boolean,
): Collection {
	const fields = new Set(requiredFields(collection));
	if (required) fields.add(key);
	else fields.delete(key);
	return {
		...collection,
		schema: { ...collection.schema, required: [...fields] },
	};
}

export function collectionSchemaProperties(
	collection: Collection,
): Record<string, unknown> {
	const properties = collection.schema.properties;
	return properties && typeof properties === "object" ? properties : {};
}

export function withoutCollectionKey(
	data: Record<string, unknown>,
	key: string,
): Record<string, unknown> {
	const next = { ...data };
	delete next[key];
	return next;
}

function requiredFields(collection: Collection): string[] {
	return Array.isArray(collection.schema.required)
		? collection.schema.required.filter(
				(field): field is string => typeof field === "string",
			)
		: [];
}

function enumOptions(collection: Collection, key: string): string[] | null {
	const property = collectionSchemaProperties(collection)[key];
	if (!property || typeof property !== "object") return null;
	const values = (property as { enum?: unknown }).enum;
	if (!Array.isArray(values)) return null;
	const options = values.filter(
		(item): item is string => typeof item === "string",
	);
	return options.length > 0 ? options : null;
}

function defaultValueFor(
	collection: Collection,
	field: CollectionField,
): unknown {
	if (!field.required) return undefined;
	const options = enumOptions(collection, field.key);
	if (options) return options[0] ?? "";
	if (field.type === "number" || field.type === "integer") return 0;
	if (field.type === "boolean") return false;
	return "";
}

function nextMemberPosition(collection: Collection): number {
	if (collection.members.length === 0) return 0;
	return Math.max(...collection.members.map((member) => member.position)) + 1;
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

function fieldTitle(key: string): string {
	return key
		.split("_")
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(" ");
}
