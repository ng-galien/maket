import Ajv from "ajv";
import { parseJsonPointer, readJsonPointer } from "./json-patch.js";

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
}

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

export function validateStructuredWorkspaceDefinition(
	dataSchema: StructuredWorkspaceDataSchema,
	representationSchema: StructuredWorkspaceRepresentationSchema,
): string[] {
	const issues = validateDataSchema(dataSchema);
	if (representationSchema.version !== 1) {
		issues.push("Representation schema version must be 1.");
	}
	issues.push(
		...validateCollectionRepresentations(
			dataSchema,
			representationSchema.collections,
		),
	);
	return issues;
}

function validateCollectionRepresentations(
	dataSchema: StructuredWorkspaceDataSchema,
	collectionsById: StructuredWorkspaceRepresentationSchema["collections"],
): string[] {
	const issues: string[] = [];
	const collections = Object.entries(collectionsById ?? {});
	if (collections.length === 0) {
		issues.push("Representation schema must declare at least one collection.");
	}
	for (const [collectionId, collection] of collections) {
		if (!collectionId.trim()) issues.push("Collection ids must not be empty.");
		if (!collection.name?.trim()) {
			issues.push(`Collection "${collectionId}" requires a name.`);
		}
		if (!collection.collectionTemplateDocumentId?.trim()) {
			issues.push(
				`Collection "${collectionId}" requires a collection template document.`,
			);
		}
		issues.push(...validateCollectionGrouping(collectionId, collection));
		const bindings = Object.entries(collection.bindings ?? {});
		if (bindings.length === 0) {
			issues.push(
				`Collection "${collectionId}" must declare at least one binding.`,
			);
		}
		for (const [bindingId, binding] of bindings) {
			issues.push(
				...validateBinding(
					dataSchema,
					bindingId,
					`${collectionId}.${bindingId}`,
					binding,
				),
			);
		}
	}
	return issues;
}

function validateCollectionGrouping(
	collectionId: string,
	collection: StructuredWorkspaceCollectionRepresentation,
): string[] {
	const issues: string[] = [];
	if (collection.groupBy !== undefined) {
		try {
			if (parseJsonPointer(collection.groupBy).length === 0) {
				issues.push(
					`Collection "${collectionId}" groupBy must point inside the item data, for example "/status".`,
				);
			}
		} catch {
			issues.push(
				`Collection "${collectionId}" groupBy must be a JSON Pointer into the item data, for example "/status".`,
			);
		}
	}
	if (collection.groupOrder !== undefined) {
		if (collection.groupBy === undefined) {
			issues.push(`Collection "${collectionId}" groupOrder requires groupBy.`);
		}
		if (
			!Array.isArray(collection.groupOrder) ||
			!collection.groupOrder.every(isGroupValue)
		) {
			issues.push(
				`Collection "${collectionId}" groupOrder must list string, number, boolean, or null values.`,
			);
		}
	}
	if (collection.pageSize !== undefined) {
		if (collection.groupBy === undefined) {
			issues.push(`Collection "${collectionId}" pageSize requires groupBy.`);
		}
		if (
			!Number.isInteger(collection.pageSize) ||
			collection.pageSize < 1 ||
			collection.pageSize > structuredWorkspaceMaxPageSize
		) {
			issues.push(
				`Collection "${collectionId}" pageSize must be an integer from 1 to ${structuredWorkspaceMaxPageSize}.`,
			);
		}
	}
	return issues;
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
	const validator = createValidator();
	const schemaIssues = validateDataSchema(schema, validator);
	if (schemaIssues.length > 0) return schemaIssues;
	const validate = validator.compile(schema);
	if (validate(data)) return [];
	return (validate.errors ?? []).map(
		(error) => `Invalid item data${error.instancePath}: ${error.message}`,
	);
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

function validateDataSchema(
	schema: StructuredWorkspaceDataSchema,
	validator = createValidator(),
): string[] {
	if (validator.validateSchema(schema)) return [];
	return (validator.errors ?? []).map(
		(error) => `Invalid data schema${error.instancePath}: ${error.message}`,
	);
}

function createValidator(): Ajv {
	return new Ajv({ allErrors: true, strict: false });
}

function validateBinding(
	dataSchema: StructuredWorkspaceDataSchema,
	bindingId: string,
	bindingPath: string,
	binding: StructuredWorkspaceTemplateBinding,
): string[] {
	const issues: string[] = [];
	if (!bindingId.trim()) issues.push("Binding ids must not be empty.");
	if (!binding.detailTemplateDocumentId?.trim()) {
		issues.push(
			`Binding "${bindingPath}" requires a detail template document.`,
		);
	}
	try {
		structuredWorkspaceBindingSchema(dataSchema, binding);
	} catch (error) {
		issues.push(
			`Binding "${bindingPath}" has an invalid schemaPath: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return issues;
}
