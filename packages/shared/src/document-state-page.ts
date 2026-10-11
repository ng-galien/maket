import Mustache from "mustache";
import {
	type DocumentStateData,
	type DocumentStateRenderOptions,
	type DocumentStateRenderResult,
	renderDocumentStateText,
	validateDocumentStateTemplate,
} from "./document-state.js";
import {
	type JsonFormsTemplate,
	renderJsonFormsTemplate,
	validateJsonFormsTemplate,
} from "./json-forms.js";

/** One current form, embedded at a static position in the authored HTML. */
export const jsonFormSlot = "<!--maket-json-form-->";

export function hasJsonFormSlot(html: string | undefined): boolean {
	return html?.includes(jsonFormSlot) ?? false;
}

export interface DocumentStatePageTemplate {
	html?: string;
	jsonForms?: JsonFormsTemplate;
}

export function validateDocumentStatePageTemplate(
	template: DocumentStatePageTemplate,
): void {
	validateComposition(template);
	if (template.jsonForms) validateJsonFormsTemplate(template.jsonForms);
	if (template.html) validateDocumentStateTemplate(template.html);
}

export function renderDocumentStatePage(
	template: DocumentStatePageTemplate,
	data: DocumentStateData,
	options: DocumentStateRenderOptions = {},
): DocumentStateRenderResult {
	validateDocumentStatePageTemplate(template);
	if (template.jsonForms) {
		if (!options.schema) {
			throw new Error("JSON Forms rendering requires a document-state schema.");
		}
		const form = renderJsonFormsTemplate(
			template.jsonForms,
			data,
			options.schema,
		);
		if (template.html === undefined) return form;
		const shell = renderDocumentStateText(template.html, data, options);
		const slot = validateFormSlot(shell.html);
		const embedded = form.html.replace(
			'class="maket-json-forms"',
			'class="maket-json-forms maket-json-forms--embedded"',
		);
		return {
			...shell,
			html:
				shell.html.slice(0, slot) +
				embedded +
				shell.html.slice(slot + jsonFormSlot.length),
			dependencies: [...new Set([...shell.dependencies, ...form.dependencies])],
			bindingPaths: [...new Set([...shell.bindingPaths, ...form.bindingPaths])],
		};
	}
	if (template.html)
		return renderDocumentStateText(template.html, data, options);
	return { html: "", dependencies: [], bindingPaths: [] };
}

function validateComposition(template: DocumentStatePageTemplate): void {
	const html = template.html;
	if (html !== undefined && template.jsonForms !== undefined) {
		validateFormSlot(html);
		const sections = Mustache.parse(html).filter(
			(token) => token[0] === "#" || token[0] === "^",
		);
		if (
			sections.some((token) =>
				html.slice(token[2], token[5]).includes(jsonFormSlot),
			)
		) {
			throw new Error(
				"The JSON Forms slot cannot be inside a Mustache section.",
			);
		}
	}
}

/** Recognise an actual HTML comment, never a string inside an attribute or raw text. */
function validateFormSlot(html: string): number {
	const tokens = html.matchAll(
		/<!--[\s\S]*?-->|<(?:[^"'<>]|"[^"]*"|'[^']*')*>/g,
	);
	const stack: string[] = [];
	const forbidden = new Set([
		"script",
		"style",
		"textarea",
		"title",
		"select",
		"svg",
		"math",
		"template",
		"form",
	]);
	const containers = new Set([
		"div",
		"section",
		"article",
		"main",
		"aside",
		"header",
		"footer",
		"nav",
		"fieldset",
		"li",
		"body",
	]);
	const voidTags = new Set([
		"area",
		"base",
		"br",
		"col",
		"embed",
		"hr",
		"img",
		"input",
		"link",
		"meta",
		"param",
		"source",
		"track",
		"wbr",
	]);
	let count = 0;
	let slot = -1;
	for (const match of tokens) {
		const token = match[0];
		if (token === jsonFormSlot) {
			if (
				stack.some((tag) => forbidden.has(tag)) ||
				!containers.has(stack.at(-1) ?? "body")
			) {
				throw new Error(
					"The JSON Forms slot must be inside a normal HTML block container.",
				);
			}
			count++;
			slot = match.index;
		} else if (!token.startsWith("<!--")) {
			updateHtmlStack(stack, token, voidTags);
		}
	}
	if (count !== 1)
		throw new Error(
			"An HTML page with JSON Forms requires exactly one <!--maket-json-form--> slot.",
		);
	return slot;
}

function updateHtmlStack(
	stack: string[],
	token: string,
	voidTags: Set<string>,
): void {
	const tag = /^<\s*(\/?)\s*([\w-]+)/.exec(token);
	if (!tag) return;
	const name = (tag[2] ?? "").toLowerCase();
	if (tag[1]) {
		const index = stack.lastIndexOf(name);
		if (index >= 0) stack.length = index;
	} else if (!voidTags.has(name) && !token.endsWith("/>")) stack.push(name);
}
