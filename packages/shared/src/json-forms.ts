import Ajv from "ajv";
import type {
	DocumentStateData,
	DocumentStateRenderResult,
	DocumentStateSchema,
} from "./document-state.js";
import {
	appendJsonPointer,
	parseJsonPointer,
	readJsonPointer,
} from "./json-patch.js";

export interface JsonFormsTemplate {
	/** Standard JSON Forms UI schema. Omit it to generate a vertical form. */
	uischema?: Record<string, unknown>;
}

type UiElement = Record<string, unknown>;

interface RenderContext {
	schema: DocumentStateSchema;
	data: DocumentStateData;
	dependencies: Set<string>;
	bindingPaths: Set<string>;
}

interface Choice {
	value: string;
	label: string;
}

const JSON_FORMS_STYLE = `<style>
.maket-json-forms{box-sizing:border-box;width:100%;height:100%;padding:10mm;overflow:auto;color:var(--charte-color-text,var(--charte-color-ink,#1f2937));font-family:var(--charte-font-body,var(--charte-font-heading,Inter,system-ui,sans-serif));font-size:3.5mm;line-height:1.4;background:var(--charte-color-bg,var(--charte-color-paper,var(--charte-color-surface,#fff)))}
.maket-json-forms *{box-sizing:border-box}.maket-json-forms__layout{display:flex;gap:4mm}.maket-json-forms__layout--vertical{flex-direction:column}.maket-json-forms__layout--horizontal{align-items:flex-start}.maket-json-forms__layout--horizontal>*{min-width:0;flex:1}.maket-json-forms__group{display:flex;flex-direction:column;gap:3mm;margin:0;padding:4mm;border:1px solid var(--charte-color-line,var(--charte-color-border,#d1d5db));border-radius:2mm}.maket-json-forms__group>legend{padding:0 1.5mm;font-weight:700}.maket-json-forms__control{display:flex;flex-direction:column;gap:1.2mm}.maket-json-forms__control>span,.maket-json-forms__label{font-weight:600}.maket-json-forms__control input:not([type=checkbox]):not([type=radio]),.maket-json-forms__control textarea,.maket-json-forms__control select{width:100%;min-height:9mm;padding:2mm 2.5mm;border:1px solid var(--charte-color-line,var(--charte-color-border,#cbd5e1));border-radius:1.5mm;background:var(--charte-color-surface,var(--charte-color-paper,#fff));color:inherit;font:inherit}.maket-json-forms__control input[type=checkbox],.maket-json-forms__control input[type=radio]{accent-color:var(--charte-color-primary,var(--charte-color-accent,#2563eb))}.maket-json-forms__control input:focus-visible,.maket-json-forms__control textarea:focus-visible,.maket-json-forms__control select:focus-visible{outline:2px solid var(--charte-color-primary,var(--charte-color-accent,#2563eb));outline-offset:1px}.maket-json-forms__control textarea{min-height:24mm;resize:vertical}.maket-json-forms__check{flex-direction:row;align-items:center;gap:2mm}.maket-json-forms__check input{width:4.5mm;height:4.5mm}.maket-json-forms__radio{display:flex;flex-wrap:wrap;gap:2mm 4mm}.maket-json-forms__radio label{display:flex;align-items:center;gap:1.5mm}.maket-json-forms__description{font-size:3mm;color:var(--charte-color-muted,#64748b);font-weight:400}.maket-json-forms [data-maket-error]{outline:1px solid #dc2626}.maket-json-forms [data-maket-pending]{opacity:.65}
</style>`;

export function validateJsonFormsTemplate(template: JsonFormsTemplate): void {
	if (!isRecord(template))
		throw new Error("JSON Forms template must be an object.");
	if (template.uischema === undefined) return;
	validateUiElement(template.uischema, "uischema");
}

export function renderJsonFormsTemplate(
	template: JsonFormsTemplate,
	data: DocumentStateData,
	schema: DocumentStateSchema,
): DocumentStateRenderResult {
	validateJsonFormsTemplate(template);
	if (schema.type !== undefined && schema.type !== "object") {
		throw new Error("JSON Forms requires an object document-state schema.");
	}
	const context: RenderContext = {
		schema,
		data,
		dependencies: new Set(),
		bindingPaths: new Set(),
	};
	const ui = template.uischema ?? generatedUiSchema(schema);
	const body = renderUiElement(ui, context, "root");
	return {
		html: `${JSON_FORMS_STYLE}<div class="maket-json-forms" data-maket-json-forms data-id="json-form" role="form">${body}</div>`,
		dependencies: [...context.dependencies],
		bindingPaths: [...context.bindingPaths],
	};
}

function generatedUiSchema(schema: DocumentStateSchema): UiElement {
	const properties = isRecord(schema.properties) ? schema.properties : {};
	return {
		type: "VerticalLayout",
		elements: Object.keys(properties).map((name) => ({
			type: "Control",
			scope: `#/properties/${escapeJsonPointerToken(name)}`,
		})),
	};
}

function validateUiElement(
	value: unknown,
	path: string,
): asserts value is UiElement {
	if (!isRecord(value))
		throw new Error(`JSON Forms ${path} must be an object.`);
	const type = value.type;
	if (typeof type !== "string") {
		throw new Error(`JSON Forms ${path}.type is required.`);
	}
	if (type === "Control") {
		if (typeof value.scope !== "string") {
			throw new Error(`JSON Forms ${path}.scope is required for a Control.`);
		}
		return;
	}
	if (type === "Label") {
		if (typeof value.text !== "string") {
			throw new Error(`JSON Forms ${path}.text is required for a Label.`);
		}
		return;
	}
	if (
		type !== "VerticalLayout" &&
		type !== "HorizontalLayout" &&
		type !== "Group"
	) {
		throw new Error(
			`Unsupported JSON Forms element type "${type}" at ${path}.`,
		);
	}
	if (!Array.isArray(value.elements)) {
		throw new Error(`JSON Forms ${path}.elements must be an array.`);
	}
	for (const [index, child] of value.elements.entries()) {
		validateUiElement(child, `${path}.elements[${index}]`);
	}
}

function renderUiElement(
	element: UiElement,
	context: RenderContext,
	key: string,
): string {
	const ruleState = evaluateRule(element.rule, context);
	if (ruleState.hidden) return "";
	const type = element.type;
	if (type === "Control")
		return renderControl(element, context, key, ruleState.disabled);
	if (type === "Label") {
		return `<div class="maket-json-forms__label" data-id="json-form-${safeToken(key)}">${escapeHtml(String(element.text ?? ""))}</div>`;
	}
	const children = (element.elements as UiElement[])
		.map((child, index) => renderUiElement(child, context, `${key}-${index}`))
		.join("");
	if (type === "Group") {
		const label = typeof element.label === "string" ? element.label : "";
		return `<fieldset class="maket-json-forms__group" data-id="json-form-${safeToken(key)}"${ruleState.disabled ? " disabled" : ""}>${label ? `<legend>${escapeHtml(label)}</legend>` : ""}${children}</fieldset>`;
	}
	const direction = type === "HorizontalLayout" ? "horizontal" : "vertical";
	return `<div class="maket-json-forms__layout maket-json-forms__layout--${direction}" data-id="json-form-${safeToken(key)}">${children}</div>`;
}

function renderControl(
	element: UiElement,
	context: RenderContext,
	key: string,
	disabledByRule: boolean,
): string {
	const scope = String(element.scope);
	const pointer = scopeToDataPointer(scope);
	const propertySchema = schemaAtScope(context.schema, scope);
	const value = readOptionalPointer(context.data, pointer);
	context.dependencies.add(pointer);
	const options = isRecord(element.options) ? element.options : {};
	const readOnly =
		disabledByRule ||
		propertySchema.readOnly === true ||
		options.readonly === true;
	const label = controlLabel(element, propertySchema, pointer);
	const required = isRequiredScope(context.schema, scope);
	const description =
		typeof propertySchema.description === "string"
			? `<small class="maket-json-forms__description">${escapeHtml(propertySchema.description)}</small>`
			: "";
	const id = `json-form-${safeToken(pointer || key)}`;
	const choices = schemaChoices(propertySchema);
	if (choices) {
		context.bindingPaths.add(pointer);
		if (options.format === "radio") {
			const radios = choices
				.map(
					(choice) =>
						`<label><input type="radio" name="${escapeAttribute(id)}" value="${escapeAttribute(choice.value)}" data-maket-bind="${escapeAttribute(scope)}" data-maket-path="${escapeAttribute(pointer)}" data-maket-type="string"${String(value) === choice.value ? " checked" : ""}${readOnly ? " disabled" : ""}><span>${escapeHtml(choice.label)}</span></label>`,
				)
				.join("");
			return `<div class="maket-json-forms__control" data-id="${escapeAttribute(id)}"><span>${escapeHtml(label)}${required ? " *" : ""}</span><div class="maket-json-forms__radio">${radios}</div>${description}</div>`;
		}
		const optionHtml = choices
			.map(
				(choice) =>
					`<option value="${escapeAttribute(choice.value)}"${String(value) === choice.value ? " selected" : ""}>${escapeHtml(choice.label)}</option>`,
			)
			.join("");
		return `<label class="maket-json-forms__control" data-id="${escapeAttribute(id)}"><span>${escapeHtml(label)}${required ? " *" : ""}</span><select aria-label="${escapeAttribute(label)}" data-maket-bind="${escapeAttribute(scope)}" data-maket-path="${escapeAttribute(pointer)}" data-maket-type="string"${required ? " required" : ""}${readOnly ? " disabled" : ""}>${optionHtml}</select>${description}</label>`;
	}
	const type = schemaType(propertySchema);
	if (type === "boolean") {
		context.bindingPaths.add(pointer);
		return `<label class="maket-json-forms__control maket-json-forms__check" data-id="${escapeAttribute(id)}"><input type="checkbox" data-maket-bind="${escapeAttribute(scope)}" data-maket-path="${escapeAttribute(pointer)}" data-maket-type="boolean"${value === true ? " checked" : ""}${required ? " required" : ""}${readOnly ? " disabled" : ""}><span>${escapeHtml(label)}</span>${description}</label>`;
	}
	if (type === "string") {
		context.bindingPaths.add(pointer);
		const attrs = stringConstraintAttributes(
			propertySchema,
			required,
			readOnly,
		);
		if (options.multi === true) {
			return `<label class="maket-json-forms__control" data-id="${escapeAttribute(id)}"><span>${escapeHtml(label)}${required ? " *" : ""}</span><textarea data-maket-bind="${escapeAttribute(scope)}" data-maket-path="${escapeAttribute(pointer)}" data-maket-type="string"${attrs}>${escapeHtml(typeof value === "string" ? value : "")}</textarea>${description}</label>`;
		}
		const inputType = stringInputType(propertySchema.format);
		return `<label class="maket-json-forms__control" data-id="${escapeAttribute(id)}"><span>${escapeHtml(label)}${required ? " *" : ""}</span><input type="${inputType}" value="${escapeAttribute(typeof value === "string" ? value : "")}" data-maket-bind="${escapeAttribute(scope)}" data-maket-path="${escapeAttribute(pointer)}" data-maket-type="string"${attrs}>${description}</label>`;
	}
	if (type === "number" || type === "integer") {
		context.bindingPaths.add(pointer);
		const step =
			type === "integer" ? "1" : String(propertySchema.multipleOf ?? "any");
		return `<label class="maket-json-forms__control" data-id="${escapeAttribute(id)}"><span>${escapeHtml(label)}${required ? " *" : ""}</span><input type="number" value="${typeof value === "number" ? value : ""}" step="${escapeAttribute(step)}" data-maket-bind="${escapeAttribute(scope)}" data-maket-path="${escapeAttribute(pointer)}" data-maket-type="number"${numberConstraintAttributes(propertySchema, required, readOnly)}>${description}</label>`;
	}
	throw new Error(
		`JSON Forms control "${scope}" uses unsupported schema type "${String(type ?? "unknown")}".`,
	);
}

function evaluateRule(
	rule: unknown,
	context: RenderContext,
): { hidden: boolean; disabled: boolean } {
	if (rule === undefined) return { hidden: false, disabled: false };
	if (!isRecord(rule) || !isRecord(rule.condition)) {
		throw new Error("JSON Forms rule requires a condition object.");
	}
	const effect = rule.effect;
	if (
		effect !== "HIDE" &&
		effect !== "SHOW" &&
		effect !== "DISABLE" &&
		effect !== "ENABLE"
	) {
		throw new Error(`Unsupported JSON Forms rule effect "${String(effect)}".`);
	}
	const scope = rule.condition.scope;
	const conditionSchema = rule.condition.schema;
	if (typeof scope !== "string" || !isRecord(conditionSchema)) {
		throw new Error("JSON Forms rule conditions require scope and schema.");
	}
	const pointer = scopeToDataPointer(scope);
	context.dependencies.add(pointer);
	const value = readOptionalPointer(context.data, pointer);
	const matches = new Ajv({ allErrors: true, strict: false }).compile(
		conditionSchema,
	)(value);
	return {
		hidden:
			effect === "HIDE"
				? Boolean(matches)
				: effect === "SHOW"
					? !matches
					: false,
		disabled:
			effect === "DISABLE"
				? Boolean(matches)
				: effect === "ENABLE"
					? !matches
					: false,
	};
}

function schemaAtScope(
	schema: DocumentStateSchema,
	scope: string,
): Record<string, unknown> {
	if (!scope.startsWith("#/")) {
		throw new Error(
			`JSON Forms scope "${scope}" must be a local JSON Schema reference.`,
		);
	}
	let value = readJsonPointer(schema, scope.slice(1));
	if (!isRecord(value)) {
		throw new Error(
			`JSON Forms scope "${scope}" does not resolve to a schema.`,
		);
	}
	const reference = value.$ref;
	if (typeof reference === "string" && reference.startsWith("#/")) {
		value = readJsonPointer(schema, reference.slice(1));
		if (!isRecord(value)) {
			throw new Error(`JSON Forms reference "${reference}" is invalid.`);
		}
	}
	return value;
}

function scopeToDataPointer(scope: string): string {
	if (!scope.startsWith("#/")) {
		throw new Error(`JSON Forms scope "${scope}" must start with "#/".`);
	}
	const schemaTokens = parseJsonPointer(scope.slice(1));
	const dataTokens: string[] = [];
	for (let index = 0; index < schemaTokens.length; index += 2) {
		if (
			schemaTokens[index] !== "properties" ||
			schemaTokens[index + 1] === undefined
		) {
			throw new Error(
				`JSON Forms scope "${scope}" must address object properties only.`,
			);
		}
		dataTokens.push(schemaTokens[index + 1] as string);
	}
	return dataTokens.reduce(
		(pointer, token) => appendJsonPointer(pointer, token),
		"",
	);
}

function isRequiredScope(schema: DocumentStateSchema, scope: string): boolean {
	const tokens = parseJsonPointer(scope.slice(1));
	if (tokens.length < 2) return false;
	const property = tokens[tokens.length - 1];
	const parentPointer = `/${tokens.slice(0, -2).map(escapeJsonPointerToken).join("/")}`;
	const parent =
		tokens.length === 2 ? schema : readJsonPointer(schema, parentPointer);
	return (
		isRecord(parent) &&
		Array.isArray(parent.required) &&
		parent.required.includes(property)
	);
}

function schemaChoices(schema: Record<string, unknown>): Choice[] | null {
	if (Array.isArray(schema.enum)) {
		if (!schema.enum.every((value) => typeof value === "string")) {
			throw new Error(
				"JSON Forms enum controls currently require string values.",
			);
		}
		return schema.enum.map((value) => ({
			value: String(value),
			label: String(value),
		}));
	}
	if (Array.isArray(schema.oneOf)) {
		const choices = schema.oneOf.flatMap((candidate) => {
			if (!isRecord(candidate) || typeof candidate.const !== "string")
				return [];
			return [
				{
					value: String(candidate.const),
					label:
						typeof candidate.title === "string"
							? candidate.title
							: String(candidate.const),
				},
			];
		});
		if (choices.length !== schema.oneOf.length) {
			throw new Error("JSON Forms oneOf controls require string const values.");
		}
		return choices;
	}
	return null;
}

function schemaType(schema: Record<string, unknown>): string | undefined {
	return typeof schema.type === "string" ? schema.type : undefined;
}

function controlLabel(
	element: UiElement,
	schema: Record<string, unknown>,
	pointer: string,
): string {
	if (element.label === false) return "";
	if (typeof element.label === "string") return element.label;
	if (typeof schema.title === "string") return schema.title;
	const tokens = parseJsonPointer(pointer);
	return humanize(tokens[tokens.length - 1] ?? "Value");
}

function humanize(value: string): string {
	const spaced = value
		.replace(/[_-]+/g, " ")
		.replace(/([a-z])([A-Z])/g, "$1 $2");
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function stringInputType(format: unknown): string {
	if (format === "date") return "date";
	if (format === "time") return "time";
	if (format === "date-time") return "datetime-local";
	if (format === "email") return "email";
	return "text";
}

function stringConstraintAttributes(
	schema: Record<string, unknown>,
	required: boolean,
	readOnly: boolean,
): string {
	return [
		required ? " required" : "",
		readOnly ? " disabled" : "",
		numericAttribute(schema.minLength, "minlength"),
		numericAttribute(schema.maxLength, "maxlength"),
		typeof schema.pattern === "string"
			? ` pattern="${escapeAttribute(schema.pattern)}"`
			: "",
	].join("");
}

function numberConstraintAttributes(
	schema: Record<string, unknown>,
	required: boolean,
	readOnly: boolean,
): string {
	return [
		required ? " required" : "",
		readOnly ? " disabled" : "",
		numericAttribute(schema.minimum, "min"),
		numericAttribute(schema.maximum, "max"),
	].join("");
}

function numericAttribute(value: unknown, name: string): string {
	return typeof value === "number" && Number.isFinite(value)
		? ` ${name}="${value}"`
		: "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readOptionalPointer(value: unknown, pointer: string): unknown {
	try {
		return readJsonPointer(value, pointer);
	} catch {
		return undefined;
	}
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeJsonPointerToken(value: string): string {
	return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function safeToken(value: string): string {
	return (
		value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "field"
	);
}
