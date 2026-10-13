import Ajv from "ajv";
import { parseJsonPointer, readJsonPointer } from "./json-patch.js";
import { compiledJsonSchema } from "./json-schema-validators.js";

export type StructuredWorkspaceDataSchema = Record<string, unknown>;

export interface StructuredWorkspaceTemplateBinding {
	schemaPath: string;
	compactTemplateDocumentId?: string;
	detailTemplateDocumentId: string;
}

export type StructuredWorkspaceGroupValue = string | number | boolean | null;

export interface StructuredWorkspaceCollectionRepresentation {
	name: string;
	collectionTemplateDocumentId: string;
	bindings: Record<string, StructuredWorkspaceTemplateBinding>;
	/** JSON Pointer into item data; cards are laid out group by group and
	 * flow onto as many collection pages as needed. */
	groupBy?: string;
	/** Group values placed first, in this order; other groups follow in order
	 * of first appearance. */
	groupOrder?: StructuredWorkspaceGroupValue[];
	/** Cards per collection page when grouping (default 24). */
	pageSize?: number;
	/** JSON Pointer into item data; cards are ordered by this value inside each
	 * group (or the whole slot without grouping). Items without a value come
	 * last; equal values keep insertion order. */
	sortBy?: string;
	/** Direction of `sortBy` (default ascending). */
	sortDirection?: StructuredWorkspaceSortDirection;
}

export type StructuredWorkspaceSortDirection = "ascending" | "descending";

export const structuredWorkspaceDefaultPageSize = 24;
export const structuredWorkspaceMaxPageSize = 500;

export interface StructuredWorkspaceRepresentationSchema {
	version: 1;
	collections: Record<string, StructuredWorkspaceCollectionRepresentation>;
}

export interface StructuredWorkspaceItemReference {
	id: string;
	position: number;
	collectionId: string;
	bindingId: string;
	documentId: string;
}

export interface StructuredWorkspaceDefinition {
	id: string;
	name: string;
	description?: string;
	dataSchema: StructuredWorkspaceDataSchema;
	representationSchema: StructuredWorkspaceRepresentationSchema;
	revision: number;
	items: StructuredWorkspaceItemReference[];
	createdAt: string;
	updatedAt: string;
}

export interface StructuredWorkspaceItemView
	extends StructuredWorkspaceItemReference {
	documentName: string;
	pinnedAt?: string;
	data: Record<string, unknown>;
	dataRevision: number;
}

export interface StructuredWorkspaceCollectionDocumentView {
	collectionId: string;
	documentId: string;
	documentName: string;
}

export type StructuredWorkspaceIntegrity =
	| { status: "ready"; issues: [] }
	| { status: "incomplete"; issues: string[] };

export interface StructuredWorkspaceTemplateDocumentView {
	documentId: string;
	documentName: string;
	roles: Array<{
		role: "collection" | "compact" | "detail";
		collectionId: string;
		bindingId?: string;
	}>;
}

export interface StructuredWorkspaceView
	extends Omit<StructuredWorkspaceDefinition, "items"> {
	integrity: StructuredWorkspaceIntegrity;
	items: StructuredWorkspaceItemView[];
	collectionDocuments: StructuredWorkspaceCollectionDocumentView[];
	templateDocuments: StructuredWorkspaceTemplateDocumentView[];
}

export type StructuredWorkspacePageProvenance =
	| {
			kind: "template";
			workspaceId: string;
			templateDocumentId: string;
			templatePageId: string;
	  }
	| { kind: "instance"; workspaceId: string };

export type StructuredWorkspaceFindingSeverity = "error" | "warning" | "hint";

export type StructuredWorkspaceFindingObject =
	| "schema"
	| "collection"
	| "template"
	| "item"
	| "form"
	| "index";

/** One fact about a Workspace definition or its owned documents, with the
 * correction and the call that applies it. */
export interface StructuredWorkspaceFinding {
	severity: StructuredWorkspaceFindingSeverity;
	object: StructuredWorkspaceFindingObject;
	collection?: string;
	/** Where the fact sits: an argument path such as
	 * `representation_schema.collections.books.groupBy`, or a document. */
	path: string;
	message: string;
	fix: string;
	next?: string;
}

export interface StructuredWorkspaceCheck {
	workspace: string;
	verdict: "ready" | "not ready";
	findings: StructuredWorkspaceFinding[];
}

/** One way an item breaks its schema: the data path, the JSON Schema rule,
 * and the correction. */
export interface StructuredWorkspaceItemDataIssue {
	path: string;
	rule: string;
	message: string;
	fix: string;
}

export function validateStructuredWorkspaceDefinition(
	dataSchema: StructuredWorkspaceDataSchema,
	representationSchema: StructuredWorkspaceRepresentationSchema,
): string[] {
	return diagnoseStructuredWorkspaceDefinition(
		dataSchema,
		representationSchema,
	).map((finding) => finding.message);
}

/** Every definition error, each naming its collection, path and fix. */
export function diagnoseStructuredWorkspaceDefinition(
	dataSchema: StructuredWorkspaceDataSchema,
	representationSchema: StructuredWorkspaceRepresentationSchema,
): StructuredWorkspaceFinding[] {
	const findings = validateDataSchema(dataSchema);
	if (representationSchema.version !== 1) {
		findings.push({
			severity: "error",
			object: "schema",
			path: "representation_schema.version",
			message: "Representation schema version must be 1.",
			fix: "Set representation_schema.version to 1.",
		});
	}
	findings.push(
		...validateCollectionRepresentations(
			dataSchema,
			representationSchema.collections,
		),
	);
	return findings;
}

function definitionError(
	collection: string | undefined,
	path: string,
	message: string,
	fix: string,
	object: StructuredWorkspaceFindingObject = "collection",
): StructuredWorkspaceFinding {
	return {
		severity: "error",
		object,
		...(collection === undefined ? {} : { collection }),
		path,
		message,
		fix,
	};
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Definition validation: checks each collection against the schema and pointer helpers that own those formats.
function validateCollectionRepresentations(
	dataSchema: StructuredWorkspaceDataSchema,
	collectionsById: StructuredWorkspaceRepresentationSchema["collections"],
): StructuredWorkspaceFinding[] {
	const findings: StructuredWorkspaceFinding[] = [];
	const collections = Object.entries(collectionsById ?? {});
	if (collections.length === 0) {
		findings.push(
			definitionError(
				undefined,
				"representation_schema.collections",
				"Representation schema must declare at least one collection.",
				'Omit representation_schema to let Maket generate one collection, or declare one, for example {"items":{"name":"Items"}}.',
			),
		);
	}
	for (const [collectionId, collection] of collections) {
		const base = `representation_schema.collections.${collectionId}`;
		if (!collectionId.trim())
			findings.push(
				definitionError(
					collectionId,
					base,
					"Collection ids must not be empty.",
					'Give the collection a non-empty key, for example "items".',
				),
			);
		if (!collection.name?.trim()) {
			findings.push(
				definitionError(
					collectionId,
					`${base}.name`,
					`Collection "${collectionId}" requires a name.`,
					`Set ${base}.name to the display name of the collection.`,
				),
			);
		}
		if (!collection.collectionTemplateDocumentId?.trim()) {
			findings.push(
				definitionError(
					collectionId,
					`${base}.collectionTemplateDocumentId`,
					`Collection "${collectionId}" requires a collection template document.`,
					`Remove collectionTemplateDocumentId so Maket generates the index template, or give ${base}.indexTemplateHtml.`,
					"template",
				),
			);
		}
		findings.push(...validateCollectionGrouping(collectionId, collection));
		const bindings = Object.entries(collection.bindings ?? {});
		if (bindings.length === 0) {
			findings.push(
				definitionError(
					collectionId,
					`${base}.bindings`,
					`Collection "${collectionId}" must declare at least one binding.`,
					`Omit ${base}.bindings so Maket binds the whole item schema, or declare one, for example {"item":{"schemaPath":""}}.`,
				),
			);
		}
		for (const [bindingId, binding] of bindings) {
			findings.push(
				...validateBinding(dataSchema, collectionId, bindingId, binding),
			);
		}
	}
	return findings;
}

function validateCollectionGrouping(
	collectionId: string,
	collection: StructuredWorkspaceCollectionRepresentation,
): StructuredWorkspaceFinding[] {
	const base = `representation_schema.collections.${collectionId}`;
	const findings: StructuredWorkspaceFinding[] = [];
	const push = (field: string, message: string, fix: string) =>
		findings.push(
			definitionError(collectionId, `${base}.${field}`, message, fix, "index"),
		);
	if (collection.groupBy !== undefined) {
		try {
			if (parseJsonPointer(collection.groupBy).length === 0) {
				push(
					"groupBy",
					`Collection "${collectionId}" groupBy must point inside the item data, for example "/status".`,
					'Set groupBy to a property pointer such as "/status", or remove it.',
				);
			}
		} catch {
			push(
				"groupBy",
				`Collection "${collectionId}" groupBy must be a JSON Pointer into the item data, for example "/status".`,
				`Write groupBy with a leading slash, for example "/${collection.groupBy.replace(/^\/*/, "")}".`,
			);
		}
	}
	findings.push(...validateCollectionSort(collectionId, collection));
	if (collection.groupOrder !== undefined) {
		if (collection.groupBy === undefined) {
			push(
				"groupOrder",
				`Collection "${collectionId}" groupOrder requires groupBy.`,
				"Add groupBy or remove groupOrder.",
			);
		}
		if (
			!Array.isArray(collection.groupOrder) ||
			!collection.groupOrder.every(isGroupValue)
		) {
			push(
				"groupOrder",
				`Collection "${collectionId}" groupOrder must list string, number, boolean, or null values.`,
				'List plain values, for example ["live","paused"].',
			);
		}
	}
	if (collection.pageSize !== undefined) {
		if (collection.groupBy === undefined) {
			push(
				"pageSize",
				`Collection "${collectionId}" pageSize requires groupBy.`,
				"Add groupBy or remove pageSize.",
			);
		}
		if (
			!Number.isInteger(collection.pageSize) ||
			collection.pageSize < 1 ||
			collection.pageSize > structuredWorkspaceMaxPageSize
		) {
			push(
				"pageSize",
				`Collection "${collectionId}" pageSize must be an integer from 1 to ${structuredWorkspaceMaxPageSize}.`,
				`Set pageSize to an integer from 1 to ${structuredWorkspaceMaxPageSize}, or remove it for the default ${structuredWorkspaceDefaultPageSize}.`,
			);
		}
	}
	return findings;
}

function validateCollectionSort(
	collectionId: string,
	collection: StructuredWorkspaceCollectionRepresentation,
): StructuredWorkspaceFinding[] {
	const base = `representation_schema.collections.${collectionId}`;
	const findings: StructuredWorkspaceFinding[] = [];
	const push = (field: string, message: string, fix: string) =>
		findings.push(
			definitionError(collectionId, `${base}.${field}`, message, fix, "index"),
		);
	if (collection.sortBy !== undefined) {
		try {
			if (parseJsonPointer(collection.sortBy).length === 0) {
				push(
					"sortBy",
					`Collection "${collectionId}" sortBy must point inside the item data, for example "/place".`,
					'Set sortBy to a property pointer such as "/place", or remove it.',
				);
			}
		} catch {
			push(
				"sortBy",
				`Collection "${collectionId}" sortBy must be a JSON Pointer into the item data, for example "/place".`,
				`Write sortBy with a leading slash, for example "/${collection.sortBy.replace(/^\/*/, "")}".`,
			);
		}
	}
	if (collection.sortDirection !== undefined) {
		if (collection.sortBy === undefined) {
			push(
				"sortDirection",
				`Collection "${collectionId}" sortDirection requires sortBy.`,
				"Add sortBy or remove sortDirection.",
			);
		}
		if (
			collection.sortDirection !== "ascending" &&
			collection.sortDirection !== "descending"
		) {
			push(
				"sortDirection",
				`Collection "${collectionId}" sortDirection must be "ascending" or "descending".`,
				'Set sortDirection to "ascending" or "descending".',
			);
		}
	}
	return findings;
}

function isGroupValue(value: unknown): value is StructuredWorkspaceGroupValue {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

export function validateStructuredWorkspaceItemData(
	schema: StructuredWorkspaceDataSchema,
	data: Record<string, unknown>,
): string[] {
	const compiled = compiledJsonSchema(schema);
	if (!compiled.ok) {
		return compiled.errors.map(
			(error) => `Invalid data schema${error.instancePath}: ${error.message}`,
		);
	}
	if (compiled.validate(data)) return [];
	return (compiled.validate.errors ?? []).map(
		(error) => `Invalid item data${error.instancePath}: ${error.message}`,
	);
}

/** How item data breaks its schema, one issue per failed rule. */
export function structuredWorkspaceItemDataIssues(
	schema: StructuredWorkspaceDataSchema,
	data: Record<string, unknown>,
): StructuredWorkspaceItemDataIssue[] {
	const compiled = compiledJsonSchema(schema);
	if (!compiled.ok) {
		return compiled.errors.map((error) => ({
			path: `data_schema${error.instancePath}`,
			rule: error.keyword,
			message: `Invalid data schema${error.instancePath}: ${error.message}`,
			fix: "Correct the data schema with update_definition before writing items.",
		}));
	}
	if (compiled.validate(data)) return [];
	return (compiled.validate.errors ?? []).map((error) => {
		const params = error.params as Record<string, unknown>;
		const path = error.instancePath || "/";
		return {
			path,
			rule: error.keyword,
			message: `Invalid item data${error.instancePath}: ${error.message}`,
			fix: itemDataFix(error.keyword, path, params),
		};
	});
}

function itemDataFix(
	rule: string,
	path: string,
	params: Record<string, unknown>,
): string {
	const at = path === "/" ? "" : path;
	switch (rule) {
		case "required":
			return `Add "${at}/${String(params.missingProperty)}" to data.`;
		case "additionalProperties":
			return `Remove "${at}/${String(params.additionalProperty)}" from data, or declare it in the data schema with update_definition.`;
		case "type":
			return `Give ${path} a value of type ${String(params.type)}.`;
		case "enum":
			return `Use one of ${JSON.stringify(params.allowedValues)} at ${path}.`;
		case "const":
			return `Use ${JSON.stringify(params.allowedValue)} at ${path}.`;
		case "oneOf":
		case "anyOf":
			return `Make ${path} match exactly one alternative of the data schema; read them with action=view.`;
		case "format":
			return `Give ${path} a value in the "${String(params.format)}" format.`;
		default:
			return `Change ${path} so that it satisfies the "${rule}" rule of the data schema.`;
	}
}

export function structuredWorkspaceBindingSchema(
	dataSchema: StructuredWorkspaceDataSchema,
	binding: StructuredWorkspaceTemplateBinding,
): StructuredWorkspaceDataSchema {
	let target = readJsonPointer(dataSchema, binding.schemaPath);
	if (!target || typeof target !== "object" || Array.isArray(target)) {
		throw new Error(
			`Binding schemaPath "${binding.schemaPath}" must resolve to a JSON Schema object.`,
		);
	}
	const reference = (target as Record<string, unknown>).$ref;
	if (typeof reference === "string" && reference.startsWith("#/")) {
		target = readJsonPointer(dataSchema, reference.slice(1));
		if (!target || typeof target !== "object" || Array.isArray(target)) {
			throw new Error(`Binding schema reference "${reference}" is invalid.`);
		}
	}
	const concrete = structuredClone(target) as StructuredWorkspaceDataSchema;
	for (const definitionsKey of ["$defs", "definitions"] as const) {
		if (concrete[definitionsKey] === undefined && dataSchema[definitionsKey]) {
			concrete[definitionsKey] = structuredClone(dataSchema[definitionsKey]);
		}
	}
	return concrete;
}

/**
 * Whether item data under `schema` can hold a value at `pointer`: every
 * segment is a declared property (or an index of an array), following local
 * `$ref`s and any branch of `oneOf`, `anyOf` or `allOf`. An object level that
 * does not set `additionalProperties: false` accepts any other segment.
 */
export function structuredWorkspaceSchemaDeclaresPath(
	schema: StructuredWorkspaceDataSchema,
	pointer: string,
): boolean {
	let segments: string[];
	try {
		segments = parseJsonPointer(pointer);
	} catch {
		return false;
	}
	return declaresSegments(schema, schema, segments, 0);
}

function declaresSegments(
	root: StructuredWorkspaceDataSchema,
	node: unknown,
	segments: string[],
	depth: number,
): boolean {
	if (depth > 32 || !isRecord(node)) return false;
	const resolved = resolveLocalReference(root, node);
	if (!resolved) return false;
	const [segment, ...rest] = segments;
	if (segment === undefined) return true;
	for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
		const branches = resolved[keyword];
		if (
			Array.isArray(branches) &&
			branches.some((branch) =>
				declaresSegments(root, branch, segments, depth + 1),
			)
		)
			return true;
	}
	const properties = resolved.properties;
	if (isRecord(properties) && Object.hasOwn(properties, segment)) {
		return declaresSegments(root, properties[segment], rest, depth + 1);
	}
	if (/^\d+$/.test(segment) && resolved.items !== undefined) {
		return declaresSegments(root, resolved.items, rest, depth + 1);
	}
	return (
		resolved.oneOf === undefined &&
		resolved.anyOf === undefined &&
		resolved.allOf === undefined &&
		resolved.additionalProperties !== false &&
		(resolved.type === undefined || resolved.type === "object")
	);
}

function resolveLocalReference(
	root: StructuredWorkspaceDataSchema,
	node: Record<string, unknown>,
): Record<string, unknown> | null {
	const reference = node.$ref;
	if (typeof reference !== "string") return node;
	if (!reference.startsWith("#")) return null;
	try {
		const target = readJsonPointer(root, reference.slice(1));
		return isRecord(target) ? target : null;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One property of a binding schema the generated templates show. */
export interface StructuredWorkspaceTemplateField {
	name: string;
	label: string;
	kind: "value" | "list";
	/** A JSON Forms control can edit it: a terminal type and no
	 * `readOnly: true`. */
	editable: boolean;
}

/** Templates Maket writes when the agent gives neither documents nor HTML. */
export interface StructuredWorkspaceGeneratedTemplates {
	indexHtml: string;
	detailHtml: string;
	compactHtml: string;
	/** JSON Forms definition of the detail template's form page, absent when
	 * no property is editable. */
	detailForm?: { uischema: Record<string, unknown> };
}

const FIELD_NAME = /^[\p{L}_][\p{L}\p{N}_-]*$/u;

/** The direct properties of a binding schema, in schema order, that a state
 * placeholder can name. */
export function structuredWorkspaceTemplateFields(
	bindingSchema: StructuredWorkspaceDataSchema,
): StructuredWorkspaceTemplateField[] {
	const resolved = resolveLocalReference(bindingSchema, bindingSchema);
	const properties = resolved?.properties;
	if (!isRecord(properties)) return [];
	return Object.entries(properties).flatMap(
		([name, raw]): StructuredWorkspaceTemplateField[] => {
			if (!FIELD_NAME.test(name) || !isRecord(raw)) return [];
			const property = resolveLocalReference(bindingSchema, raw);
			if (!property) return [];
			const label =
				typeof property.title === "string" && property.title.trim()
					? property.title
					: humanizeFieldName(name);
			if (isTerminalSchema(property)) {
				return [
					{
						name,
						label,
						kind: "value" as const,
						editable:
							property.readOnly !== true && property.const === undefined,
					},
				];
			}
			if (
				property.type === "array" &&
				isRecord(property.items) &&
				isTerminalSchema(property.items)
			) {
				return [{ name, label, kind: "list" as const, editable: false }];
			}
			return [];
		},
	);
}

/** A property of a binding schema the generated templates leave out. */
export interface StructuredWorkspaceHiddenProperty {
	/** The property name; empty when the schema has no direct properties. */
	name: string;
	reason: string;
}

/**
 * What generated templates cannot show: every direct property that is not a
 * terminal value or a list of terminal values or whose name a placeholder
 * cannot use, or the whole schema when it declares no direct properties but
 * combines alternatives.
 */
export function structuredWorkspaceHiddenProperties(
	bindingSchema: StructuredWorkspaceDataSchema,
): StructuredWorkspaceHiddenProperty[] {
	const resolved = resolveLocalReference(bindingSchema, bindingSchema);
	const properties = resolved?.properties;
	if (!isRecord(properties)) {
		const keyword = (["oneOf", "anyOf", "allOf"] as const).find(
			(candidate) => resolved?.[candidate] !== undefined,
		);
		return keyword
			? [
					{
						name: "",
						reason: `the binding schema has no direct properties (it uses ${keyword})`,
					},
				]
			: [];
	}
	const shown = new Set(
		structuredWorkspaceTemplateFields(bindingSchema).map((field) => field.name),
	);
	return Object.entries(properties).flatMap(([name, raw]) => {
		if (shown.has(name)) return [];
		if (!FIELD_NAME.test(name))
			return [{ name, reason: "its name cannot be used in a placeholder" }];
		const property = isRecord(raw)
			? resolveLocalReference(bindingSchema, raw)
			: null;
		const reason =
			property?.type === "object"
				? "it is a nested object"
				: property?.type === "array"
					? "it is a list of objects or lists"
					: "its type is neither a value nor a list of values";
		return [{ name, reason }];
	});
}

function isTerminalSchema(schema: Record<string, unknown>): boolean {
	if (
		Array.isArray(schema.enum) &&
		schema.enum.every((value) => typeof value === "string")
	)
		return true;
	return (
		schema.type === "string" ||
		schema.type === "number" ||
		schema.type === "integer" ||
		schema.type === "boolean"
	);
}

function humanizeFieldName(name: string): string {
	const spaced = name
		.replace(/[_-]+/g, " ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.trim();
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Default templates for one binding: an index page with one item slot, a
 * detail page with one labelled line per property, a form on its editable
 * properties, and a compact card with the title and the next two properties.
 * The title is the first string property, or the collection name.
 */
export function generateStructuredWorkspaceTemplates(
	collectionName: string,
	bindingSchema: StructuredWorkspaceDataSchema,
): StructuredWorkspaceGeneratedTemplates {
	const fields = structuredWorkspaceTemplateFields(bindingSchema);
	const root = resolveLocalReference(bindingSchema, bindingSchema);
	const properties = isRecord(root?.properties) ? root.properties : {};
	const titleField = fields.find((field) => {
		const property = properties[field.name];
		return (
			field.kind === "value" && isRecord(property) && property.type === "string"
		);
	});
	const title = titleField
		? `{{ state.${titleField.name} }}`
		: escapeTemplateText(collectionName);
	const line = (field: StructuredWorkspaceTemplateField) =>
		field.kind === "list"
			? `<div data-id="field-${dataIdToken(field.name)}"><dt>${escapeTemplateText(field.label)}</dt><dd>{{#state.${field.name}}}<span>{{.}}</span> {{/state.${field.name}}}</dd></div>`
			: `<div data-id="field-${dataIdToken(field.name)}"><dt>${escapeTemplateText(field.label)}</dt><dd>{{ state.${field.name} }}</dd></div>`;
	const editable = fields.filter((field) => field.editable);
	const detailForm = editable.length
		? {
				uischema: {
					type: "VerticalLayout",
					elements: editable.map((field) => ({
						type: "Control",
						scope: `#/properties/${field.name}`,
					})),
				},
			}
		: undefined;
	const detailHtml = [
		`<style>.maket-detail{box-sizing:border-box;padding:14mm;font-family:var(--charte-font-body,system-ui,sans-serif);color:var(--charte-color-text,#1f2937)}.maket-detail h1{margin:0 0 6mm;font-size:9mm}.maket-detail dl{display:grid;grid-template-columns:max-content 1fr;gap:2mm 6mm;margin:0 0 8mm}.maket-detail dl>div{display:contents}.maket-detail dt{font-weight:600}.maket-detail dd{margin:0}</style>`,
		`<article data-id="detail" class="maket-detail">`,
		`<h1 data-id="detail-title">${title}</h1>`,
		`<dl data-id="detail-fields">${fields.map(line).join("")}</dl>`,
		"</article>",
	].join("");
	const cardFields = fields
		.filter((field) => field !== titleField && field.kind === "value")
		.slice(0, 2);
	const compactHtml = [
		`<style>.maket-card{display:flex;flex-direction:column;gap:1.5mm;padding:4mm;border:1px solid var(--charte-color-line,#d1d5db);border-radius:2mm;font-family:var(--charte-font-body,system-ui,sans-serif)}.maket-card strong{font-size:4.5mm}.maket-card span{font-size:3.5mm;color:var(--charte-color-muted,#64748b)}</style>`,
		`<article data-id="card" class="maket-card" data-maket-compact-root>`,
		`<strong data-id="card-title">${title}</strong>`,
		...cardFields.map(
			(field) =>
				`<span data-id="card-${dataIdToken(field.name)}">${escapeTemplateText(field.label)}: {{ state.${field.name} }}</span>`,
		),
		"</article>",
	].join("");
	const indexHtml = [
		`<style>.maket-index{box-sizing:border-box;padding:12mm;font-family:var(--charte-font-body,system-ui,sans-serif)}.maket-index h1{margin:0 0 6mm;font-size:8mm}.maket-index__items{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4mm}</style>`,
		`<main data-id="index" class="maket-index">`,
		`<h1 data-id="index-title">${escapeTemplateText(collectionName)}</h1>`,
		`<section data-id="index-items" class="maket-index__items" data-maket-structured-items></section>`,
		"</main>",
	].join("");
	return {
		indexHtml,
		detailHtml,
		compactHtml,
		...(detailForm ? { detailForm } : {}),
	};
}

function dataIdToken(name: string): string {
	return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

function escapeTemplateText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll("{", "&#123;")
		.replaceAll("}", "&#125;");
}

function validateDataSchema(
	schema: StructuredWorkspaceDataSchema,
	validator = createValidator(),
): StructuredWorkspaceFinding[] {
	if (validator.validateSchema(schema)) return [];
	return (validator.errors ?? []).map((error) => ({
		severity: "error",
		object: "schema",
		path: `data_schema${error.instancePath.replaceAll("/", ".")}`,
		message: `Invalid data schema${error.instancePath}: ${error.message}`,
		fix: 'Write data_schema as a JSON Schema object, for example {"type":"object","properties":{"title":{"type":"string"}},"required":["title"]}.',
	}));
}

function createValidator(): Ajv {
	return new Ajv({ allErrors: true, strict: false });
}

function validateBinding(
	dataSchema: StructuredWorkspaceDataSchema,
	collectionId: string,
	bindingId: string,
	binding: StructuredWorkspaceTemplateBinding,
): StructuredWorkspaceFinding[] {
	const bindingPath = `${collectionId}.${bindingId}`;
	const base = `representation_schema.collections.${collectionId}.bindings.${bindingId}`;
	const findings: StructuredWorkspaceFinding[] = [];
	if (!bindingId.trim())
		findings.push(
			definitionError(
				collectionId,
				base,
				"Binding ids must not be empty.",
				'Give the binding a non-empty key, for example "item".',
			),
		);
	if (!binding.detailTemplateDocumentId?.trim()) {
		findings.push(
			definitionError(
				collectionId,
				`${base}.detailTemplateDocumentId`,
				`Binding "${bindingPath}" requires a detail template document.`,
				`Remove detailTemplateDocumentId so Maket generates the detail template, or give ${base}.detailTemplateHtml.`,
				"template",
			),
		);
	}
	try {
		structuredWorkspaceBindingSchema(dataSchema, binding);
	} catch (error) {
		findings.push(
			definitionError(
				collectionId,
				`${base}.schemaPath`,
				`Binding "${bindingPath}" has an invalid schemaPath: ${error instanceof Error ? error.message : String(error)}`,
				'Set schemaPath to "" for the whole data schema, or to a pointer of an object schema such as "/$defs/task".',
				"schema",
			),
		);
	}
	return findings;
}
