import Ajv from "ajv";
import type { TemplateSpans } from "mustache";
import Mustache from "mustache";

export interface Collection {
	name: string;
	description?: string;
	schema: CollectionSchema;
	members: CollectionMember[];
}

export interface CollectionReference {
	name: string;
}

export type CollectionSchema = Record<string, unknown> & {
	type?: unknown;
	properties?: Record<string, unknown>;
	required?: unknown;
	additionalProperties?: unknown;
};

export interface CollectionMember {
	id: string;
	position: number;
	data: Record<string, unknown>;
}

export interface CollectionMemberReference {
	collection: CollectionReference;
	id: string;
}

export interface CollectionField {
	key: string;
	title?: string;
	type: string;
	required: boolean;
}

export interface CollectionSummary {
	name: string;
	description?: string;
	fieldCount: number;
	memberCount: number;
}

export type GeneratedPlaceholder =
	| "page.number"
	| "page.total"
	| "member.number"
	| "member.total";

export type CollectionPlaceholder =
	| { kind: "collectionField"; field: string }
	| { kind: "generatedValue"; value: GeneratedPlaceholder };

export interface CollectionPlaceholderOccurrence {
	raw: string;
	name: string;
	start: number;
	end: number;
	placeholder?: CollectionPlaceholder;
}

export type CollectionTemplateIssueCode =
	| "duplicateField"
	| "invalidField"
	| "invalidMember"
	| "invalidSchema"
	| "invalidTemplate"
	| "malformedPlaceholder"
	| "placeholderInAttribute"
	| "unsupportedCollectionField"
	| "unsupportedTemplateFeature"
	| "unknownCollectionField"
	| "unknownGeneratedValue";

export interface CollectionTemplateIssue {
	code: CollectionTemplateIssueCode;
	message: string;
	placeholder?: string;
	field?: string;
	memberId?: string;
	start?: number;
	end?: number;
}

export interface CollectionRenderContext {
	member: CollectionMember;
	memberNumber: number;
	memberTotal: number;
	pageNumber: number;
	pageTotal: number;
}

export const generatedPlaceholders = [
	"page.number",
	"page.total",
	"member.number",
	"member.total",
] as const satisfies readonly GeneratedPlaceholder[];

const fieldKeyPattern = /^[a-z][a-z0-9_]*$/;
const generatedPlaceholderSet = new Set<string>(generatedPlaceholders);
const collectionValueToken = "name";
const collectionPlaceholderAttribute = "data-collection-placeholder";
const collectionPlaceholderKindAttribute = "data-collection-placeholder-kind";
const collectionPlaceholderBoundAttribute = "data-collection-bound";
const scalarJsonTypes = new Set(["string", "number", "integer", "boolean"]);
const ajv = new Ajv({ allErrors: true, strict: false });
type TemplateToken = TemplateSpans[number];

export function parseCollectionPlaceholder(
	source: string,
): CollectionPlaceholder | null {
	const occurrences = listCollectionPlaceholders(source.trim());
	if (occurrences.length !== 1) return null;
	const [occurrence] = occurrences;
	if (!occurrence) return null;
	return occurrence.raw === source.trim()
		? (occurrence.placeholder ?? null)
		: null;
}

export function parseCollectionPlaceholderName(
	name: string,
): CollectionPlaceholder | null {
	if (isGeneratedPlaceholder(name)) {
		return { kind: "generatedValue", value: name };
	}
	if (fieldKeyPattern.test(name)) {
		return { kind: "collectionField", field: name };
	}
	return null;
}

export function listCollectionPlaceholders(
	template: string,
): CollectionPlaceholderOccurrence[] {
	const parsed = parseTemplate(template);
	if (!parsed.tokens) return [];
	return parsed.tokens.flatMap((token) =>
		collectionPlaceholderOccurrences(template, token),
	);
}

export function validateCollectionTemplate(
	template: string,
	collection: Collection,
): CollectionTemplateIssue[] {
	return [
		...validateCollection(collection),
		...validateTemplatePlaceholders(template, collection),
	];
}

export function validateCollection(
	collection: Collection,
): CollectionTemplateIssue[] {
	const schemaIssues = validateCollectionSchema(collection.schema);
	if (schemaIssues.length > 0) return schemaIssues;
	const validate = ajv.compile(collection.schema);
	const memberIssues = collection.members.flatMap((member) =>
		validateCollectionMember(member, validate),
	);
	return memberIssues;
}

export function resolveCollectionText(
	template: string,
	collection: Collection,
	context: CollectionRenderContext,
): string {
	const issues = [
		...validateCollectionTemplate(template, collection),
		...validateCollectionMember(context.member, ajv.compile(collection.schema)),
	];
	if (issues.length > 0) {
		throw new Error(formatCollectionTemplateIssues(issues));
	}
	return resolveValidatedCollectionText(template, collection, context);
}

/**
 * Wrap each placeholder in a marker `<span>` so UIs can style them. With a
 * `collection`, `data-collection-bound` reflects whether the placeholder will
 * actually resolve against its schema (unknown fields marked "false");
 * without one, any well-formed field placeholder counts as bound.
 */
export function markCollectionPlaceholders(
	template: string,
	collection?: Collection,
): string {
	const parsed = parseTemplate(template);
	if (parsed.error) throw new Error(parsed.error);
	const occurrences = (parsed.tokens ?? [])
		.flatMap((token) => collectionPlaceholderOccurrences(template, token))
		.filter((occurrence) => !isInsideHtmlTag(template, occurrence.start));
	return insertCollectionPlaceholderMarkers(
		template,
		occurrences,
		collection ? collectionProperties(collection.schema) : null,
	);
}

export function escapeCollectionValue(value: string): string {
	return Mustache.escape(value);
}

export function formatCollectionTemplateIssues(
	issues: readonly CollectionTemplateIssue[],
): string {
	return issues.map((issue) => issue.message).join("\n");
}

export function listCollectionFields(
	collection: Collection,
): CollectionField[] {
	const required = new Set(
		Array.isArray(collection.schema.required)
			? collection.schema.required.filter(
					(key): key is string => typeof key === "string",
				)
			: [],
	);
	return [...collectionProperties(collection.schema)].map(
		([key, property]) => ({
			key,
			title: propertyTitle(property),
			type: propertyType(property),
			required: required.has(key),
		}),
	);
}

export function summarizeCollection(collection: Collection): CollectionSummary {
	return {
		name: collection.name,
		description: collection.description,
		fieldCount: listCollectionFields(collection).length,
		memberCount: collection.members.length,
	};
}

function validateTemplatePlaceholders(
	template: string,
	collection: Collection,
): CollectionTemplateIssue[] {
	const parsed = parseTemplate(template);
	if (parsed.error) {
		return [
			{
				code: "invalidTemplate",
				message: parsed.error,
			},
		];
	}
	const properties = collectionProperties(collection.schema);
	return (parsed.tokens ?? []).flatMap((token) =>
		validateTemplateToken(template, token, properties),
	);
}

function validateTemplateToken(
	template: string,
	token: TemplateToken,
	properties: ReadonlyMap<string, unknown>,
): CollectionTemplateIssue[] {
	if (token[0] === "text" || token[0] === "!") return [];
	if (token[0] !== collectionValueToken) {
		return [createUnsupportedTokenIssue(template, token)];
	}
	if (isInsideHtmlTag(template, token[2])) {
		return [createAttributePlaceholderIssue(template, token)];
	}
	return collectionPlaceholderOccurrences(template, token).flatMap(
		(occurrence) => validateTemplatePlaceholder(occurrence, properties),
	);
}

function validateTemplatePlaceholder(
	occurrence: CollectionPlaceholderOccurrence,
	properties: ReadonlyMap<string, unknown>,
): CollectionTemplateIssue[] {
	if (!occurrence.placeholder) {
		return [createInvalidPlaceholderIssue(occurrence)];
	}
	if (occurrence.placeholder.kind === "generatedValue") {
		return [];
	}
	const property = properties.get(occurrence.placeholder.field);
	if (property === undefined) {
		return [createUnknownFieldIssue(occurrence, occurrence.placeholder.field)];
	}
	if (isInlineRenderableProperty(property)) return [];
	return [
		createUnsupportedFieldIssue(occurrence, occurrence.placeholder.field),
	];
}

function validateCollectionSchema(
	schema: CollectionSchema,
): CollectionTemplateIssue[] {
	const issues: CollectionTemplateIssue[] = [];
	if (!ajv.validateSchema(schema)) {
		issues.push({
			code: "invalidSchema",
			message: ajv.errorsText(ajv.errors),
		});
	}
	if (schema.type !== "object") {
		issues.push({
			code: "invalidSchema",
			message: "Collection schema must describe an object.",
		});
	}
	for (const key of collectionProperties(schema).keys()) {
		if (!fieldKeyPattern.test(key)) {
			issues.push({
				code: "invalidField",
				field: key,
				message: `Invalid collection field "${key}".`,
			});
		}
	}
	return issues;
}

function validateCollectionMember(
	member: CollectionMember,
	validate: ReturnType<Ajv["compile"]>,
): CollectionTemplateIssue[] {
	if (validate(member.data)) return [];
	return [
		{
			code: "invalidMember",
			memberId: member.id,
			message: `Collection member "${member.id}" does not match schema: ${ajv.errorsText(validate.errors)}`,
		},
	];
}

function createInvalidPlaceholderIssue(
	occurrence: CollectionPlaceholderOccurrence,
): CollectionTemplateIssue {
	if (looksLikeGeneratedPlaceholder(occurrence.name)) {
		return {
			code: "unknownGeneratedValue",
			placeholder: occurrence.raw,
			start: occurrence.start,
			end: occurrence.end,
			message: `Unknown generated value "${occurrence.name}".`,
		};
	}
	return {
		code: "malformedPlaceholder",
		placeholder: occurrence.raw,
		start: occurrence.start,
		end: occurrence.end,
		message: `Malformed placeholder "${occurrence.raw}".`,
	};
}

function createUnknownFieldIssue(
	occurrence: CollectionPlaceholderOccurrence,
	field: string,
): CollectionTemplateIssue {
	return {
		code: "unknownCollectionField",
		placeholder: occurrence.raw,
		field,
		start: occurrence.start,
		end: occurrence.end,
		message: `Unknown collection field "${field}".`,
	};
}

function createUnsupportedFieldIssue(
	occurrence: CollectionPlaceholderOccurrence,
	field: string,
): CollectionTemplateIssue {
	return {
		code: "unsupportedCollectionField",
		placeholder: occurrence.raw,
		field,
		start: occurrence.start,
		end: occurrence.end,
		message: `Collection field "${field}" cannot be rendered as an inline placeholder.`,
	};
}

function resolveValidatedCollectionText(
	template: string,
	collection: Collection,
	context: CollectionRenderContext,
): string {
	return Mustache.render(template, collectionRenderView(collection, context));
}

function collectionRenderView(
	collection: Collection,
	context: CollectionRenderContext,
): Record<string, unknown> {
	const view: Record<string, unknown> = {};
	for (const [key, property] of collectionProperties(collection.schema)) {
		if (!isInlineRenderableProperty(property)) continue;
		view[key] = renderableCollectionValue(context.member.data[key]);
	}
	view.page = { number: context.pageNumber, total: context.pageTotal };
	view.member = { number: context.memberNumber, total: context.memberTotal };
	return view;
}

function renderableCollectionValue(value: unknown): string | number | boolean {
	if (value === null || value === undefined) return "";
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	throw new Error(
		"Collection value cannot be rendered as an inline placeholder.",
	);
}

function collectionPlaceholderOccurrences(
	template: string,
	token: TemplateToken,
): CollectionPlaceholderOccurrence[] {
	if (token[0] !== collectionValueToken) return [];
	const name = token[1];
	const start = token[2];
	const end = token[3];
	return [
		{
			raw: template.slice(start, end),
			name,
			start,
			end,
			placeholder: parseCollectionPlaceholderName(name) ?? undefined,
		},
	];
}

function createUnsupportedTokenIssue(
	template: string,
	token: TemplateToken,
): CollectionTemplateIssue {
	const start = token[2];
	const end = token[3];
	return {
		code: "unsupportedTemplateFeature",
		placeholder: template.slice(start, end),
		start,
		end,
		message: `Unsupported collection template feature "${template.slice(start, end)}".`,
	};
}

function createAttributePlaceholderIssue(
	template: string,
	token: TemplateToken,
): CollectionTemplateIssue {
	const start = token[2];
	const end = token[3];
	return {
		code: "placeholderInAttribute",
		placeholder: template.slice(start, end),
		start,
		end,
		message: `Collection placeholder "${template.slice(start, end)}" cannot be placed in an HTML attribute.`,
	};
}

function isGeneratedPlaceholder(name: string): name is GeneratedPlaceholder {
	return generatedPlaceholderSet.has(name);
}

function looksLikeGeneratedPlaceholder(name: string): boolean {
	return name.startsWith("page.") || name.startsWith("member.");
}

function parseTemplate(template: string): {
	tokens?: TemplateSpans;
	error?: string;
} {
	try {
		return { tokens: Mustache.parse(template) };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function collectionProperties(
	schema: CollectionSchema,
): ReadonlyMap<string, unknown> {
	if (!schema.properties || typeof schema.properties !== "object") {
		return new Map();
	}
	return new Map(Object.entries(schema.properties));
}

function isInlineRenderableProperty(property: unknown): boolean {
	if (!property || typeof property !== "object") return false;
	const type = (property as { type?: unknown }).type;
	if (typeof type === "string") return scalarJsonTypes.has(type);
	if (Array.isArray(type)) {
		return type.some(
			(entry) => typeof entry === "string" && scalarJsonTypes.has(entry),
		);
	}
	return false;
}

function propertyTitle(property: unknown): string | undefined {
	if (!property || typeof property !== "object") return undefined;
	const title = (property as { title?: unknown }).title;
	return typeof title === "string" ? title : undefined;
}

function propertyType(property: unknown): string {
	if (!property || typeof property !== "object") return "unknown";
	const type = (property as { type?: unknown }).type;
	if (typeof type === "string") return type;
	if (Array.isArray(type))
		return type.filter((entry) => typeof entry === "string").join("|");
	return "unknown";
}

function insertCollectionPlaceholderMarkers(
	template: string,
	occurrences: readonly CollectionPlaceholderOccurrence[],
	properties: ReadonlyMap<string, unknown> | null,
): string {
	let marked = template;
	for (const occurrence of [...occurrences].sort((a, b) => b.start - a.start)) {
		marked =
			marked.slice(0, occurrence.start) +
			collectionPlaceholderMarker(occurrence, properties) +
			marked.slice(occurrence.end);
	}
	return marked;
}

function collectionPlaceholderMarker(
	occurrence: CollectionPlaceholderOccurrence,
	properties: ReadonlyMap<string, unknown> | null,
): string {
	const kind = occurrence.placeholder?.kind ?? "unknown";
	const bound = placeholderResolves(occurrence, properties) ? "true" : "false";
	return `<span ${collectionPlaceholderAttribute}="${escapeAttribute(occurrence.name)}" ${collectionPlaceholderKindAttribute}="${kind}" ${collectionPlaceholderBoundAttribute}="${bound}">${escapeCollectionValue(occurrence.raw)}</span>`;
}

/** Whether the placeholder will produce a value at render time. */
function placeholderResolves(
	occurrence: CollectionPlaceholderOccurrence,
	properties: ReadonlyMap<string, unknown> | null,
): boolean {
	if (!occurrence.placeholder) return false;
	if (occurrence.placeholder.kind === "generatedValue") return true;
	if (!properties) return true;
	const property = properties.get(occurrence.placeholder.field);
	return property !== undefined && isInlineRenderableProperty(property);
}

function escapeAttribute(value: string): string {
	return Mustache.escape(value);
}

function isInsideHtmlTag(template: string, position: number): boolean {
	return (
		template.lastIndexOf("<", position) > template.lastIndexOf(">", position)
	);
}
