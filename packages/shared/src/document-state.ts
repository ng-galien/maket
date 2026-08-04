import Ajv from "ajv";
import Mustache from "mustache";

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
	data: DocumentStateData;
	createdAt: string;
}

const ajv = new Ajv({ allErrors: true, strict: false });

export function validateDocumentState(
	schema: DocumentStateSchema,
	data: DocumentStateData,
): string[] {
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

/** Render a stateful page without collection expansion. */
export function resolveDocumentStateText(
	template: string,
	data: DocumentStateData,
): string {
	validateDocumentStateTemplate(template);
	return Mustache.render(template, { state: data });
}

export function validateDocumentStateTemplate(template: string): void {
	const tokens = Mustache.parse(template) as Array<
		[string, string, ...unknown[]]
	>;
	let stateScopeDepth = 0;
	for (const [kind, name] of tokens) {
		if (kind === "text") continue;
		if (kind === "!") continue;
		if (kind === "#" || kind === "^") {
			if (!isStateReference(name) && stateScopeDepth === 0) {
				throw stateNamespaceError(name);
			}
			stateScopeDepth += 1;
			continue;
		}
		if (kind === "/") {
			stateScopeDepth -= 1;
			continue;
		}
		if (kind !== "name") {
			throw new Error(
				"Document state templates support escaped values, sections, inverted sections, and comments only.",
			);
		}
		if (!isStateReference(name) && stateScopeDepth === 0) {
			throw stateNamespaceError(name);
		}
	}
}

function isStateReference(name: string): boolean {
	return name.startsWith("state.") && name.length > "state.".length;
}

function stateNamespaceError(name: string): Error {
	return new Error(
		`Document state placeholder "${name}" must use the state namespace.`,
	);
}
