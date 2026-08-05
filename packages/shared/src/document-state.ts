import Ajv from "ajv";
import Mustache from "mustache";
import {
	appendJsonPointer,
	isTerminalJsonValue,
	parseJsonPointer,
	readJsonPointer,
} from "./json-patch.js";

export type DocumentStateSchema = Record<string, unknown> & {
	type?: unknown;
	properties?: Record<string, unknown>;
	required?: unknown;
	additionalProperties?: unknown;
};

export type DocumentStateData = Record<string, unknown>;

export interface DocumentStateRevision {
	documentId: string;
	revision: number;
	schema: DocumentStateSchema;
	data: DocumentStateData;
	createdAt: string;
}

export interface DocumentStateClientView {
	schema: DocumentStateSchema;
	data: DocumentStateData;
	revision: number;
	createdAt: string;
	templates: Record<string, string>;
}

export interface DocumentStateRenderResult {
	html: string;
	dependencies: string[];
	bindingPaths: string[];
}

export interface DocumentStateRenderOptions {
	schema?: DocumentStateSchema;
}

export const stateBindingAttribute = "data-maket-bind";
export const stateBindingPathAttribute = "data-maket-path";
export const stateBindingTypeAttribute = "data-maket-type";

export type DocumentStateTerminalType =
	| "string"
	| "number"
	| "boolean"
	| "null";

export function validateDocumentState(
	schema: DocumentStateSchema,
	data: DocumentStateData,
): string[] {
	const ajv = createDocumentStateValidator();
	if (!ajv.validateSchema(schema)) {
		return (ajv.errors ?? []).map(
			(error) => `Invalid state schema${error.instancePath}: ${error.message}`,
		);
	}
	const validate = ajv.compile(schema);
	if (validate(data)) return [];
	return (validate.errors ?? []).map(
		(error) => `Invalid state${error.instancePath}: ${error.message}`,
	);
}

function createDocumentStateValidator(): Ajv {
	return new Ajv({ allErrors: true, strict: false });
}

/** Render a stateful page without collection expansion. */
export function resolveDocumentStateText(
	template: string,
	data: DocumentStateData,
): string {
	return renderDocumentStateText(template, data).html;
}

/**
 * Render the supported Mustache subset and hydrate author-declared native
 * controls while retaining the absolute JSON Pointer of every resolved value.
 * Mustache interpolation itself is display-only.
 */
export function renderDocumentStateText(
	template: string,
	data: DocumentStateData,
	options: DocumentStateRenderOptions = {},
): DocumentStateRenderResult {
	const tokens = Mustache.parse(template) as MustacheToken[];
	validateTemplateTokens(tokens, false, template);
	if (options.schema) {
		validateTemplateBindings(tokens, [{ schema: options.schema, pointer: "" }]);
	}
	const dependencies = new Set<string>();
	const frames: RenderFrame[] = [{ value: data, pointer: "" }];
	const html = renderTokens(tokens, frames, template, dependencies, options);
	const hydrated = hydrateSelectOptions(html, data, options.schema);
	return {
		html: hydrated,
		dependencies: [...dependencies],
		bindingPaths: collectBindingPaths(hydrated),
	};
}

export function validateDocumentStateTemplate(template: string): void {
	validateTemplateTokens(
		Mustache.parse(template) as MustacheToken[],
		false,
		template,
	);
}

export function documentStateValueType(
	schema: DocumentStateSchema,
	pointer: string,
	value: unknown,
): DocumentStateTerminalType | null {
	if (typeof value === "string") return "string";
	if (typeof value === "number") return "number";
	if (typeof value === "boolean") return "boolean";
	if (value !== null) return null;
	const targetSchema = schemaAtPointer(schema, pointer);
	const type = schemaType(targetSchema);
	return type === "string" ||
		type === "number" ||
		type === "integer" ||
		type === "boolean"
		? type === "integer"
			? "number"
			: type
		: "null";
}

type MustacheToken = [
	string,
	string,
	number,
	number,
	MustacheToken[]?,
	...unknown[],
];

interface RenderFrame {
	value: unknown;
	pointer: string;
}

interface ResolvedValue {
	found: boolean;
	value: unknown;
	pointer: string;
}

interface SchemaFrame {
	schema: unknown;
	pointer: string;
}

interface ResolvedSchema {
	found: boolean;
	schema: unknown;
	pointer: string;
}

function renderTokens(
	tokens: MustacheToken[],
	frames: RenderFrame[],
	template: string,
	dependencies: Set<string>,
	options: DocumentStateRenderOptions,
): string {
	let output = "";
	for (const token of tokens) {
		const [kind, name] = token;
		if (kind === "text") {
			output += hydrateBindings(name, frames, dependencies, options.schema);
			continue;
		}
		if (kind === "!") continue;
		for (const pointer of referenceDependencyPointers(name, frames)) {
			parseJsonPointer(pointer);
			dependencies.add(pointer);
		}
		const resolved = resolveTemplateReference(name, frames);
		if (kind === "name") {
			output += renderValue(token, resolved);
			continue;
		}
		if (kind === "#") {
			output += renderSection(
				token,
				resolved,
				frames,
				template,
				dependencies,
				options,
			);
			continue;
		}
		if (kind === "^" && isFalsySectionValue(resolved.value)) {
			output += renderTokens(
				sectionChildren(token),
				frames,
				template,
				dependencies,
				options,
			);
		}
	}
	return output;
}

function validateTemplateBindings(
	tokens: MustacheToken[],
	frames: SchemaFrame[],
): void {
	for (const token of tokens) {
		const [kind, name] = token;
		if (kind === "text") {
			validateBindingMarkup(name, frames);
			continue;
		}
		if (kind !== "#" && kind !== "^") continue;
		const resolved = resolveSchemaReference(name, frames);
		if (!resolved.found) {
			throw new Error(
				`Document state section "${name}" is not declared by the state schema.`,
			);
		}
		assertDirectTemplateSchema(resolved.schema, name);
		const childFrames =
			kind === "#" ? sectionSchemaFrames(frames, resolved) : frames;
		validateTemplateBindings(sectionChildren(token), childFrames);
	}
}

function sectionSchemaFrames(
	frames: SchemaFrame[],
	resolved: ResolvedSchema,
): SchemaFrame[] {
	const type = schemaType(resolved.schema);
	if (type === "array") {
		const itemSchema = isRecord(resolved.schema)
			? resolved.schema.items
			: undefined;
		return [
			...frames,
			{
				schema: itemSchema,
				pointer: appendJsonPointer(resolved.pointer, 0),
			},
		];
	}
	if (
		type === "object" ||
		type === "string" ||
		type === "number" ||
		type === "integer"
	) {
		return [...frames, { schema: resolved.schema, pointer: resolved.pointer }];
	}
	return frames;
}

function validateBindingMarkup(html: string, frames: SchemaFrame[]): void {
	let cursor = 0;
	let blockedElement: "script" | "style" | null = null;
	while (cursor < html.length) {
		const start = html.indexOf("<", cursor);
		if (start < 0) return;
		const end = findHtmlTagEnd(html, start);
		if (end < 0) return;
		const tag = html.slice(start, end + 1);
		const tagName = /^<\s*\/?\s*([A-Za-z][\w:-]*)/
			.exec(tag)?.[1]
			?.toLowerCase();
		const closing = /^<\s*\//.test(tag);
		if (blockedElement) {
			if (readHtmlAttribute(tag, stateBindingAttribute) !== null) {
				throw new Error(
					`Document state bindings cannot be placed inside ${blockedElement} elements.`,
				);
			}
			if (closing && tagName === blockedElement) blockedElement = null;
			cursor = end + 1;
			continue;
		}
		if (!closing && (tagName === "script" || tagName === "style")) {
			blockedElement = tagName;
		}
		if (!closing && tagName) {
			validateBindingTagAgainstSchema(tag, tagName, html, end, frames);
		}
		cursor = end + 1;
	}
}

function validateBindingTagAgainstSchema(
	tag: string,
	tagName: string,
	html: string,
	tagEnd: number,
	frames: SchemaFrame[],
): void {
	assertNoRuntimeBindingAttributes(tag);
	const expression = readHtmlAttribute(tag, stateBindingAttribute);
	if (expression === null) return;
	if (!expression.trim()) {
		throw new Error(
			`${stateBindingAttribute} must name a document-state value.`,
		);
	}
	assertStateReference(expression, frames.length > 1, false);
	const resolved = resolveSchemaReference(expression, frames);
	if (!resolved.found) {
		throw new Error(
			`Document state binding "${expression}" is not declared by the state schema.`,
		);
	}
	assertDirectTemplateSchema(resolved.schema, expression);
	const type = schemaTerminalType(resolved.schema);
	if (!type) {
		throw new Error(
			`Document state binding "${expression}" must resolve to a terminal JSON value declared by the state schema.`,
		);
	}
	assertSupportedSchemaBindingControl(
		tag,
		tagName,
		expression,
		type,
		resolved.schema,
	);
	if (tagName !== "select") return;
	const close = findClosingSelect(html, tagEnd + 1);
	if (!close) {
		throw new Error(
			`Select binding "${expression}" must contain static document-authored options and a closing </select> tag.`,
		);
	}
	const enumValues = schemaStringEnum(resolved.schema);
	if (!enumValues) return;
	hydrateOptionTags(
		html.slice(tagEnd + 1, close.start),
		resolved.pointer,
		undefined,
		enumValues,
	);
}

const unsupportedTemplateSchemaKeywords = [
	"$ref",
	"allOf",
	"anyOf",
	"oneOf",
	"not",
	"if",
	"then",
	"else",
];

function assertDirectTemplateSchema(schema: unknown, reference: string): void {
	if (!isRecord(schema)) return;
	const keyword = unsupportedTemplateSchemaKeywords.find((candidate) =>
		Object.hasOwn(schema, candidate),
	);
	if (!keyword) return;
	throw new Error(
		`Document state template reference "${reference}" uses unsupported schema keyword "${keyword}"; bindable paths require direct properties, items, and type declarations.`,
	);
}

function assertSupportedSchemaBindingControl(
	tag: string,
	tagName: string,
	expression: string,
	type: DocumentStateTerminalType,
	targetSchema: unknown,
): void {
	const controlType = readControlType(tag);
	if (tagName === "input" && controlType === "checkbox") {
		if (type !== "boolean") {
			throw new Error(
				`Checkbox binding "${expression}" requires a boolean state value.`,
			);
		}
		return;
	}
	if (tagName === "input" && controlType === "text") {
		if (type !== "string") {
			throw new Error(
				`Text input binding "${expression}" requires a string state value.`,
			);
		}
		return;
	}
	if (tagName === "select") {
		if (readHtmlAttribute(tag, "multiple") !== null) {
			throw new Error(
				`Select binding "${expression}" cannot use multiple; one terminal string is required.`,
			);
		}
		if (type !== "string" || !schemaStringEnum(targetSchema)) {
			throw new Error(
				`Select binding "${expression}" requires a string state value constrained by a string enum.`,
			);
		}
		return;
	}
	if (tagName === "button" && controlType === "button") return;
	throw new Error(
		`${stateBindingAttribute} supports <input type="checkbox">, <input type="text">, <select>, and <button type="button"> only.`,
	);
}

function schemaTerminalType(schema: unknown): DocumentStateTerminalType | null {
	const type = schemaType(schema);
	if (type === "integer") return "number";
	return type === "string" ||
		type === "number" ||
		type === "boolean" ||
		type === "null"
		? type
		: null;
}

function resolveSchemaReference(
	name: string,
	frames: SchemaFrame[],
): ResolvedSchema {
	const root = frames[0];
	if (!root) return { found: false, schema: undefined, pointer: "" };
	assertDirectTemplateSchema(root.schema, name);
	if (name === "state") return { found: true, ...root };
	if (name.startsWith("state.")) {
		return traverseSchemaReference(
			root,
			name.slice("state.".length).split("."),
			name,
		);
	}
	const current = frames.at(-1) ?? root;
	assertDirectTemplateSchema(current.schema, name);
	if (name === ".") return { found: true, ...current };
	const segments = name.split(".");
	for (let index = frames.length - 1; index >= 0; index -= 1) {
		const resolved = traverseSchemaReference(
			frames[index] as SchemaFrame,
			segments,
			name,
		);
		if (resolved.found) return resolved;
	}
	return { found: false, schema: undefined, pointer: "" };
}

function traverseSchemaReference(
	frame: SchemaFrame,
	segments: string[],
	reference: string,
): ResolvedSchema {
	let schema = frame.schema;
	let pointer = frame.pointer;
	for (const segment of segments) {
		assertDirectTemplateSchema(schema, reference);
		if (!isRecord(schema)) {
			return { found: false, schema: undefined, pointer: "" };
		}
		const properties = schema.properties;
		if (!isRecord(properties) || !Object.hasOwn(properties, segment)) {
			return { found: false, schema: undefined, pointer: "" };
		}
		schema = properties[segment];
		pointer = appendJsonPointer(pointer, segment);
	}
	return { found: true, schema, pointer };
}

function referenceDependencyPointers(
	name: string,
	frames: RenderFrame[],
): string[] {
	const root = frames[0];
	if (!root) return [];
	if (name === "state") return [root.pointer];
	if (name.startsWith("state.")) {
		return [
			appendReferenceSegments(
				root.pointer,
				name.slice("state.".length).split("."),
			),
		];
	}
	const current = frames.at(-1) ?? root;
	if (name === ".") return [current.pointer];
	const segments = name.split(".");
	return [
		...new Set(
			frames.map((frame) => appendReferenceSegments(frame.pointer, segments)),
		),
	];
}

function appendReferenceSegments(pointer: string, segments: string[]): string {
	return segments.reduce(
		(current, segment) => appendJsonPointer(current, segment),
		pointer,
	);
}

function renderSection(
	token: MustacheToken,
	resolved: ResolvedValue,
	frames: RenderFrame[],
	template: string,
	dependencies: Set<string>,
	options: DocumentStateRenderOptions,
): string {
	if (!resolved.found || isFalsySectionValue(resolved.value)) return "";
	const children = sectionChildren(token);
	if (Array.isArray(resolved.value)) {
		return resolved.value
			.map((value, index) =>
				renderTokens(
					children,
					[
						...frames,
						{
							value,
							pointer: appendJsonPointer(resolved.pointer, index),
						},
					],
					template,
					dependencies,
					options,
				),
			)
			.join("");
	}
	if (
		typeof resolved.value === "object" ||
		typeof resolved.value === "string" ||
		typeof resolved.value === "number"
	) {
		return renderTokens(
			children,
			[...frames, { value: resolved.value, pointer: resolved.pointer }],
			template,
			dependencies,
			options,
		);
	}
	return renderTokens(children, frames, template, dependencies, options);
}

function renderValue(token: MustacheToken, resolved: ResolvedValue): string {
	if (!resolved.found) return "";
	if (!isTerminalJsonValue(resolved.value)) {
		throw new Error(
			`Document state placeholder "${token[1]}" must resolve to a terminal JSON value.`,
		);
	}
	return resolved.value === null ? "" : Mustache.escape(String(resolved.value));
}

function hydrateBindings(
	html: string,
	frames: RenderFrame[],
	dependencies: Set<string>,
	schema?: DocumentStateSchema,
): string {
	let output = "";
	let cursor = 0;
	let blockedElement: "script" | "style" | null = null;
	while (cursor < html.length) {
		const start = html.indexOf("<", cursor);
		if (start < 0) return output + html.slice(cursor);
		output += html.slice(cursor, start);
		const end = findHtmlTagEnd(html, start);
		if (end < 0) return output + html.slice(start);
		const tag = html.slice(start, end + 1);
		const tagName = /^<\s*\/?\s*([A-Za-z][\w:-]*)/
			.exec(tag)?.[1]
			?.toLowerCase();
		const closing = /^<\s*\//.test(tag);
		if (blockedElement) {
			if (readHtmlAttribute(tag, stateBindingAttribute) !== null) {
				throw new Error(
					`Document state bindings cannot be placed inside ${blockedElement} elements.`,
				);
			}
			if (closing && tagName === blockedElement) blockedElement = null;
			output += tag;
		} else {
			if (!closing && (tagName === "script" || tagName === "style")) {
				blockedElement = tagName;
			}
			output += hydrateBindingTag(tag, frames, dependencies, schema);
		}
		cursor = end + 1;
	}
	return output;
}

function hydrateBindingTag(
	tag: string,
	frames: RenderFrame[],
	dependencies: Set<string>,
	schema?: DocumentStateSchema,
): string {
	if (/^<\s*(?:\/|!|\?)/.test(tag)) return tag;
	const tagName = /^<\s*([A-Za-z][\w:-]*)/.exec(tag)?.[1]?.toLowerCase();
	if (!tagName) return tag;
	assertNoRuntimeBindingAttributes(tag);
	const expression = readHtmlAttribute(tag, stateBindingAttribute);
	if (expression === null) return tag;
	if (!expression.trim()) {
		throw new Error(
			`${stateBindingAttribute} must name a document-state value.`,
		);
	}
	assertStateReference(expression, frames.length > 1, false);
	const resolved = resolveTemplateReference(expression, frames);
	if (!resolved.found) {
		throw new Error(
			`Document state binding "${expression}" could not be resolved.`,
		);
	}
	if (!isTerminalJsonValue(resolved.value)) {
		throw new Error(
			`Document state binding "${expression}" must resolve to a terminal JSON value.`,
		);
	}
	parseJsonPointer(resolved.pointer);
	const type = documentStateValueType(
		schema ?? {},
		resolved.pointer,
		resolved.value,
	);
	if (!type) {
		throw new Error(
			`Document state binding "${expression}" has no supported terminal type.`,
		);
	}
	const targetSchema = schema
		? schemaAtPointer(schema, resolved.pointer)
		: undefined;
	assertSupportedBindingControl(
		tag,
		tagName,
		expression,
		type,
		resolved.value,
		targetSchema,
	);
	dependencies.add(resolved.pointer);
	let hydrated = setHtmlAttribute(
		tag,
		stateBindingPathAttribute,
		resolved.pointer,
	);
	hydrated = setHtmlAttribute(hydrated, stateBindingTypeAttribute, type);
	if (tagName === "input" && readControlType(tag) === "checkbox") {
		hydrated = removeHtmlAttribute(hydrated, "checked");
		if (resolved.value === true) {
			hydrated = setBooleanHtmlAttribute(hydrated, "checked");
		}
	}
	if (tagName === "input" && readControlType(tag) === "text") {
		hydrated = setHtmlAttribute(hydrated, "value", String(resolved.value));
	}
	return hydrated;
}

function assertSupportedBindingControl(
	tag: string,
	tagName: string,
	expression: string,
	type: DocumentStateTerminalType,
	value: unknown,
	targetSchema: unknown,
): void {
	const controlType = readControlType(tag);
	if (tagName === "input" && controlType === "checkbox") {
		if (type !== "boolean" || typeof value !== "boolean") {
			throw new Error(
				`Checkbox binding "${expression}" requires a boolean state value.`,
			);
		}
		return;
	}
	if (tagName === "input" && controlType === "text") {
		if (
			type !== "string" ||
			typeof value !== "string" ||
			(targetSchema !== undefined && schemaType(targetSchema) !== "string")
		) {
			throw new Error(
				`Text input binding "${expression}" requires a string state value.`,
			);
		}
		return;
	}
	if (tagName === "select") {
		if (readHtmlAttribute(tag, "multiple") !== null) {
			throw new Error(
				`Select binding "${expression}" cannot use multiple; one terminal string is required.`,
			);
		}
		const enumValues = schemaStringEnum(targetSchema);
		if (type !== "string" || typeof value !== "string" || !enumValues) {
			throw new Error(
				`Select binding "${expression}" requires a string state value constrained by a string enum.`,
			);
		}
		return;
	}
	if (tagName === "button" && controlType === "button") return;
	throw new Error(
		`${stateBindingAttribute} supports <input type="checkbox">, <input type="text">, <select>, and <button type="button"> only.`,
	);
}

function readControlType(tag: string): string | null {
	return readHtmlAttribute(tag, "type")?.toLowerCase() ?? null;
}

function hydrateSelectOptions(
	html: string,
	data: DocumentStateData,
	schema?: DocumentStateSchema,
): string {
	let output = "";
	let cursor = 0;
	while (cursor < html.length) {
		const start = html.indexOf("<", cursor);
		if (start < 0) return output + html.slice(cursor);
		const end = findHtmlTagEnd(html, start);
		if (end < 0) return output + html.slice(cursor);
		const opening = html.slice(start, end + 1);
		const tagName = /^<\s*([A-Za-z][\w:-]*)/.exec(opening)?.[1]?.toLowerCase();
		if (
			tagName !== "select" ||
			readHtmlAttribute(opening, stateBindingAttribute) === null
		) {
			output += html.slice(cursor, end + 1);
			cursor = end + 1;
			continue;
		}

		const close = findClosingSelect(html, end + 1);
		if (!close) {
			throw new Error("A bound <select> must have a closing </select> tag.");
		}
		const pointer = readHtmlAttribute(opening, stateBindingPathAttribute);
		if (pointer === null) {
			throw new Error(
				"A hydrated <select> is missing its resolved state path.",
			);
		}
		const value = readJsonPointer(data, pointer);
		const enumValues = schemaStringEnum(
			schema ? schemaAtPointer(schema, pointer) : undefined,
		);
		if (typeof value !== "string" || !enumValues) {
			throw new Error(
				`Select binding at "${pointer}" requires a string enum state value.`,
			);
		}
		const inner = html.slice(end + 1, close.start);
		output += html.slice(cursor, end + 1);
		output += hydrateOptionTags(inner, pointer, value, enumValues);
		output += html.slice(close.start, close.end + 1);
		cursor = close.end + 1;
	}
	return output;
}

function collectBindingPaths(html: string): string[] {
	const paths = new Set<string>();
	let cursor = 0;
	while (cursor < html.length) {
		const start = html.indexOf("<", cursor);
		if (start < 0) break;
		const end = findHtmlTagEnd(html, start);
		if (end < 0) break;
		const tag = html.slice(start, end + 1);
		if (readHtmlAttribute(tag, stateBindingAttribute) !== null) {
			const pointer = readHtmlAttribute(tag, stateBindingPathAttribute);
			if (pointer !== null) {
				parseJsonPointer(pointer);
				paths.add(pointer);
			}
		}
		cursor = end + 1;
	}
	return [...paths];
}

function findClosingSelect(
	html: string,
	from: number,
): { start: number; end: number } | null {
	let cursor = from;
	while (cursor < html.length) {
		const start = html.indexOf("<", cursor);
		if (start < 0) return null;
		const end = findHtmlTagEnd(html, start);
		if (end < 0) return null;
		const tag = html.slice(start, end + 1);
		const match = /^<\s*(\/?)\s*([A-Za-z][\w:-]*)/.exec(tag);
		if (match?.[2]?.toLowerCase() === "select") {
			if (match[1]) return { start, end };
			throw new Error("Bound <select> elements cannot be nested.");
		}
		cursor = end + 1;
	}
	return null;
}

// code-moniker: ignore[smell-feature-envy-local]
// This local HTML tokenizer coordinates its own Map/Set validation state; it does not reach into another domain owner.
function hydrateOptionTags(
	html: string,
	pointer: string,
	selectedValue: string | undefined,
	enumValues: string[],
): string {
	let output = "";
	let cursor = 0;
	const selectableValues = new Map<string, number>();
	const allValues = new Set<string>();
	let disabledOptgroup = false;
	while (cursor < html.length) {
		const start = html.indexOf("<", cursor);
		if (start < 0) {
			output += html.slice(cursor);
			break;
		}
		const end = findHtmlTagEnd(html, start);
		if (end < 0) {
			output += html.slice(cursor);
			break;
		}
		output += html.slice(cursor, start);
		let tag = html.slice(start, end + 1);
		const match = /^<\s*(\/?)\s*([A-Za-z][\w:-]*)/.exec(tag);
		const closing = Boolean(match?.[1]);
		const tagName = match?.[2]?.toLowerCase();
		if (tagName === "optgroup") {
			disabledOptgroup = closing
				? false
				: readHtmlAttribute(tag, "disabled") !== null;
		}
		if (tagName === "option" && !closing) {
			const value = readHtmlAttribute(tag, "value");
			if (value === null) {
				throw new Error(
					`Select binding at "${pointer}" requires an explicit value on every option.`,
				);
			}
			if (allValues.has(value)) {
				throw new Error(
					`Select binding at "${pointer}" contains duplicate option value "${value}".`,
				);
			}
			allValues.add(value);
			const disabled =
				disabledOptgroup || readHtmlAttribute(tag, "disabled") !== null;
			if (!disabled) {
				if (!enumValues.includes(value)) {
					throw new Error(
						`Select binding at "${pointer}" contains non-enum option value "${value}".`,
					);
				}
				selectableValues.set(value, (selectableValues.get(value) ?? 0) + 1);
			}
			if (selectedValue !== undefined) {
				tag = removeHtmlAttribute(tag, "selected");
			}
			if (selectedValue !== undefined && value === selectedValue) {
				if (disabled) {
					throw new Error(
						`Select binding at "${pointer}" cannot select disabled option value "${value}".`,
					);
				}
				tag = setBooleanHtmlAttribute(tag, "selected");
			}
		}
		output += tag;
		cursor = end + 1;
	}
	for (const enumValue of enumValues) {
		if (selectableValues.get(enumValue) !== 1) {
			throw new Error(
				`Select binding at "${pointer}" must provide exactly one selectable option for enum value "${enumValue}".`,
			);
		}
	}
	return output;
}

function schemaStringEnum(schema: unknown): string[] | null {
	if (!isRecord(schema) || schemaType(schema) !== "string") return null;
	if (!Array.isArray(schema.enum) || schema.enum.length === 0) return null;
	if (!schema.enum.every((value) => typeof value === "string")) return null;
	return schema.enum;
}

const reservedBindingAttributes = [
	stateBindingPathAttribute,
	stateBindingTypeAttribute,
	"data-maket-pending",
	"data-maket-error",
	"data-maket-state-bind",
	"data-maket-state-type",
	"data-maket-state-value",
	"data-maket-state-pending",
];

function assertNoRuntimeBindingAttributes(tag: string): void {
	for (const attribute of reservedBindingAttributes) {
		if (readHtmlAttribute(tag, attribute) !== null) {
			throw new Error(
				`${attribute} is reserved for transient document-state hydration.`,
			);
		}
	}
}

function findHtmlTagEnd(html: string, start: number): number {
	let quote: '"' | "'" | null = null;
	for (let index = start + 1; index < html.length; index += 1) {
		const character = html[index];
		if (quote) {
			if (character === quote) quote = null;
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === ">") return index;
	}
	return -1;
}

function htmlAttributePattern(attribute: string): RegExp {
	const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(
		`\\s${escaped}(?=\\s|=|/?>)(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?`,
		"i",
	);
}

function readHtmlAttribute(tag: string, attribute: string): string | null {
	const match = htmlAttributePattern(attribute).exec(tag);
	if (!match) return null;
	return decodeHtmlAttribute(match[1] ?? match[2] ?? match[3] ?? "");
}

function removeHtmlAttribute(tag: string, attribute: string): string {
	return tag.replace(htmlAttributePattern(attribute), "");
}

function setHtmlAttribute(
	tag: string,
	attribute: string,
	value: string,
): string {
	const without = removeHtmlAttribute(tag, attribute);
	return without.replace(
		/\s*\/?\s*>$/,
		` ${attribute}="${escapeAttribute(value)}"$&`,
	);
}

function setBooleanHtmlAttribute(tag: string, attribute: string): string {
	return tag.replace(/\s*\/?\s*>$/, ` ${attribute}$&`);
}

function decodeHtmlAttribute(value: string): string {
	return value
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");
}

function resolveTemplateReference(
	name: string,
	frames: RenderFrame[],
): ResolvedValue {
	const root = frames[0];
	if (!root) return { found: false, value: undefined, pointer: "" };
	if (name === "state") return { found: true, ...root };
	if (name.startsWith("state.")) {
		return traverseReference(root, name.slice("state.".length).split("."));
	}
	const current = frames.at(-1) ?? root;
	if (name === ".") return { found: true, ...current };
	const segments = name.split(".");
	for (let index = frames.length - 1; index >= 0; index -= 1) {
		const resolved = traverseReference(frames[index] as RenderFrame, segments);
		if (resolved.found) return resolved;
	}
	return { found: false, value: undefined, pointer: "" };
}

function traverseReference(
	frame: RenderFrame,
	segments: string[],
): ResolvedValue {
	let value = frame.value;
	let pointer = frame.pointer;
	for (const segment of segments) {
		if (!isRecord(value) || !Object.hasOwn(value, segment)) {
			return { found: false, value: undefined, pointer: "" };
		}
		value = value[segment];
		pointer = appendJsonPointer(pointer, segment);
	}
	return { found: true, value, pointer };
}

function validateTemplateTokens(
	tokens: MustacheToken[],
	inStateScope: boolean,
	template: string,
): void {
	for (const token of tokens) {
		const [kind, name] = token;
		if (kind === "text" || kind === "!") continue;
		if (kind === "name") {
			assertStateReference(name, inStateScope, false);
			assertTemplatePlacement(template, token[2]);
			continue;
		}
		if (kind === "#" || kind === "^") {
			assertStateReference(name, inStateScope, true);
			assertTemplatePlacement(template, token[2]);
			validateTemplateTokens(
				sectionChildren(token),
				kind === "#" ? true : inStateScope,
				template,
			);
			continue;
		}
		throw new Error(
			"Document state templates support escaped values, sections, inverted sections, current-context values, and comments only.",
		);
	}
}

function assertStateReference(
	name: string,
	inStateScope: boolean,
	allowStateRoot: boolean,
): void {
	if (isStateReference(name) || (allowStateRoot && name === "state")) return;
	if (inStateScope && name.length > 0 && name !== "state") return;
	throw new Error(
		`Document state placeholder "${name}" must use the state namespace.`,
	);
}

function assertTemplatePlacement(template: string, position: number): void {
	if (isInsideHtmlTag(template, position)) {
		throw new Error(
			"Document state values must be placed in HTML content, not attributes.",
		);
	}
	if (
		isInsideElementContent(template, position, "style") ||
		isInsideElementContent(template, position, "script")
	) {
		throw new Error(
			"Document state values cannot be placed inside style or script elements.",
		);
	}
}

function sectionChildren(token: MustacheToken): MustacheToken[] {
	return Array.isArray(token[4]) ? token[4] : [];
}

function isStateReference(name: string): boolean {
	return name.startsWith("state.") && name.length > "state.".length;
}

function isFalsySectionValue(value: unknown): boolean {
	return !value || (Array.isArray(value) && value.length === 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInsideHtmlTag(template: string, position: number): boolean {
	return (
		template.lastIndexOf("<", position) > template.lastIndexOf(">", position)
	);
}

function isInsideElementContent(
	template: string,
	position: number,
	tag: string,
): boolean {
	const before = template.slice(0, position).toLowerCase();
	return before.lastIndexOf(`<${tag}`) > before.lastIndexOf(`</${tag}>`);
}

function schemaAtPointer(
	schema: DocumentStateSchema,
	pointer: string,
): unknown {
	let current: unknown = schema;
	for (const segment of parseJsonPointer(pointer)) {
		if (!isRecord(current)) return null;
		const type = schemaType(current);
		if (type === "array") {
			current = current.items;
			continue;
		}
		const properties = current.properties;
		if (!isRecord(properties) || !Object.hasOwn(properties, segment))
			return null;
		current = properties[segment];
	}
	return current;
}

function schemaType(schema: unknown): string | null {
	if (!isRecord(schema)) return null;
	if (typeof schema.type === "string") return schema.type;
	if (Array.isArray(schema.type)) {
		const type = schema.type.find(
			(candidate) => typeof candidate === "string" && candidate !== "null",
		);
		return typeof type === "string" ? type : null;
	}
	return null;
}

function escapeAttribute(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
