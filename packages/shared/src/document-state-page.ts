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

export interface DocumentStatePageTemplate {
	html?: string;
	jsonForms?: JsonFormsTemplate;
}

export function validateDocumentStatePageTemplate(
	template: DocumentStatePageTemplate,
): void {
	assertSingleTemplateFormat(template);
	if (template.jsonForms) validateJsonFormsTemplate(template.jsonForms);
	else if (template.html) validateDocumentStateTemplate(template.html);
}

export function renderDocumentStatePage(
	template: DocumentStatePageTemplate,
	data: DocumentStateData,
	options: DocumentStateRenderOptions = {},
): DocumentStateRenderResult {
	assertSingleTemplateFormat(template);
	if (template.jsonForms) {
		if (!options.schema) {
			throw new Error("JSON Forms rendering requires a document-state schema.");
		}
		return renderJsonFormsTemplate(template.jsonForms, data, options.schema);
	}
	if (template.html)
		return renderDocumentStateText(template.html, data, options);
	return { html: "", dependencies: [], bindingPaths: [] };
}

function assertSingleTemplateFormat(template: DocumentStatePageTemplate): void {
	if (template.html !== undefined && template.jsonForms !== undefined) {
		throw new Error(
			"A state page must use either HTML or JSON Forms, not both.",
		);
	}
}
