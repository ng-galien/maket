/**
 * The identity Maket declares for collections that have none: Workspaces
 * stored before identities were declared (schema migration v22) and
 * Workspaces read from a bundle written before then. One choice per
 * workspace, since its collections often share one schema: `id` when no
 * binding schema declares it, `id` kept when every item already holds its own
 * id there, else the first free name among itemId, itemId2…
 */

import { parseJsonPointer } from "./json-patch.js";

type JsonObject = Record<string, unknown>;

/** The identity declared on one collection. */
export interface DeclaredItemIdentity {
	collectionId: string;
	/** The property holding the identity. */
	property: string;
	/** Whether an existing `id` property already held the item ids; when
	 * false, every item gets its id copied under `property`. */
	kept: boolean;
}

/** An item of the workspace as the declaration reads it. */
export interface IdentityCandidateRow {
	id: string;
	data: Record<string, unknown> | null;
}

export interface DeclaredIdentities<T> {
	dataSchema: JsonObject;
	representationSchema: T;
	declared: DeclaredItemIdentity[];
}

/**
 * Declare an identity on every collection of `representationSchema` that has
 * none, adding the identity property, required, to the binding schemas of
 * those collections. Answers copies; the inputs are not changed. A caller
 * copies the item id under `property` into each item of a collection whose
 * identity was not `kept`.
 */
export function declareMissingIdentities<T extends object>(
	dataSchema: JsonObject,
	representationSchema: T,
	rowsOf: (collectionId: string) => IdentityCandidateRow[],
): DeclaredIdentities<T> {
	const schema = structuredClone(dataSchema);
	const representation = structuredClone(representationSchema) as T & {
		collections?: Record<
			string,
			{
				identity?: string;
				bindings?: Record<string, { schemaPath?: string }>;
			}
		>;
	};
	const pending = Object.entries(representation.collections ?? {}).filter(
		([, collection]) => collection.identity === undefined,
	);
	if (pending.length === 0)
		return {
			dataSchema: schema,
			representationSchema: representation,
			declared: [],
		};
	const targets = [
		...new Set(
			pending.flatMap(([, collection]) =>
				bindingTargets(schema, collection.bindings ?? {}),
			),
		),
	];
	const choice = identityProperty(
		targets,
		pending.flatMap(([collectionId]) => rowsOf(collectionId)),
	);
	for (const target of targets) declareProperty(target, choice.property);
	const declared = pending.map(([collectionId, collection]) => {
		collection.identity = `/${choice.property}`;
		return { collectionId, ...choice };
	});
	return { dataSchema: schema, representationSchema: representation, declared };
}

/** The object schemas a collection's bindings validate items against,
 * inside `dataSchema` itself (local references followed), the root when
 * none resolves. */
function bindingTargets(
	dataSchema: JsonObject,
	bindings: Record<string, { schemaPath?: string }>,
): JsonObject[] {
	const targets = new Set<JsonObject>();
	for (const binding of Object.values(bindings)) {
		const target = resolvedObject(dataSchema, binding.schemaPath ?? "");
		if (target) targets.add(target);
	}
	if (targets.size === 0) targets.add(dataSchema);
	return [...targets];
}

function resolvedObject(root: JsonObject, pointer: string): JsonObject | null {
	let node: unknown = root;
	try {
		for (const segment of parseJsonPointer(pointer)) {
			node = isObject(node) ? node[segment] : undefined;
		}
	} catch {
		return null;
	}
	if (isObject(node) && typeof node.$ref === "string") {
		const reference = node.$ref;
		return reference.startsWith("#")
			? resolvedObject(root, reference.slice(1))
			: null;
	}
	return isObject(node) ? node : null;
}

function identityProperty(
	targets: JsonObject[],
	rows: IdentityCandidateRow[],
): { property: string; kept: boolean } {
	const declares = (name: string) =>
		targets.some(
			(target) => isObject(target.properties) && name in target.properties,
		);
	if (!declares("id")) return { property: "id", kept: false };
	const suitable =
		targets.every((target) => {
			const property = isObject(target.properties)
				? target.properties.id
				: null;
			const type = isObject(property) ? property.type : undefined;
			return type === "string" || type === "number" || type === "integer";
		}) &&
		rows.every(
			(row) =>
				row.data !== null &&
				(typeof row.data.id === "string" || typeof row.data.id === "number") &&
				String(row.data.id) === row.id,
		);
	if (suitable) return { property: "id", kept: true };
	let suffix = 1;
	while (declares(suffix === 1 ? "itemId" : `itemId${suffix}`)) suffix += 1;
	return { property: suffix === 1 ? "itemId" : `itemId${suffix}`, kept: false };
}

function declareProperty(target: JsonObject, name: string): void {
	const properties = isObject(target.properties) ? target.properties : {};
	if (!(name in properties)) properties[name] = { type: "string" };
	target.properties = properties;
	const required = Array.isArray(target.required) ? target.required : [];
	if (!required.includes(name)) required.push(name);
	target.required = required;
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
