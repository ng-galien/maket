import {
	applyJsonPatch,
	type DocumentStateData,
	type DocumentStateRevision,
	type DocumentStateSchema,
	isTerminalJsonValue,
	type JsonPatchOperation,
	readJsonPointer,
	renderDocumentStateText,
	validateDocumentState,
	validateDocumentStateTemplate,
} from "@maket/shared";
import { MessageError } from "../lib/message-error.js";
import type { Document } from "../types.js";
import type { Bus } from "./bus.js";
import type { Documents } from "./documents.js";
import type {
	DocumentStateRepository,
	StoredDocumentState,
} from "./sqlite-store/document-state-repository.js";

export interface DocumentStateView {
	definition: StoredDocumentState;
	current: DocumentStateRevision;
}

export interface DocumentStates {
	initialize(
		docName: string,
		schema: DocumentStateSchema,
		data: DocumentStateData,
	): DocumentStateView;
	get(docName: string): DocumentStateView | null;
	update(
		docName: string,
		expectedRevision: number,
		data: DocumentStateData,
	): DocumentStateRevision;
	patch(
		docName: string,
		expectedRevision: number,
		operations: JsonPatchOperation[],
	): DocumentStateRevision;
	patchTerminal(
		docName: string,
		expectedRevision: number,
		operation: Extract<JsonPatchOperation, { op: "replace" }>,
	): DocumentStateRevision;
	changeSchema(
		docName: string,
		expectedRevision: number,
		schema: DocumentStateSchema,
		data?: DocumentStateData,
	): DocumentStateRevision;
	validateSchema(
		docName: string,
		schema: DocumentStateSchema,
		data?: DocumentStateData,
	): void;
	history(docName: string): DocumentStateRevision[];
	revision(docName: string, revision: number): DocumentStateRevision | null;
	restore(
		docName: string,
		revision: number,
		expectedRevision: number,
	): DocumentStateRevision;
}

export interface DocumentStatesDeps {
	bus: Bus;
	documents: Documents;
	store: DocumentStateRepository;
}

/** Validate one prospective page before any state-template HTML is persisted. */
export function validateStateTemplateUpdate(
	doc: Document,
	store: DocumentStateRepository,
	html: string,
): void {
	if (doc.dataModel !== "state") return;
	const definition = store.loadDocumentState(doc.id);
	const current = store.loadCurrentDocumentState(doc.id);
	if (!definition || !current) {
		throw new MessageError(
			`Document "${doc.name}" has no state.`,
			"msg_document_no_state",
			{ name: doc.name },
		);
	}
	validateDocumentStateTemplate(html);
	renderDocumentStateText(html, current.data, { schema: current.schema });
}

export function createDocumentStates(deps: DocumentStatesDeps): DocumentStates {
	return {
		initialize(docName, schema, data) {
			const doc = requiredDocument(deps.documents, docName);
			if (doc.dataModel !== "static") {
				throw new Error(
					`Document "${doc.name}" uses the ${doc.dataModel} data model.`,
				);
			}
			assertValidStateTemplates(doc);
			assertValidState(schema, data);
			assertRenderableStateTemplates(doc, schema, data);
			const current = deps.store.initializeDocumentState(doc.id, schema, data);
			doc.dataModel = "state";
			emitStateChanged(deps.bus, doc.name, current.revision, [""], true, true);
			const definition = deps.store.loadDocumentState(doc.id);
			if (!definition) throw new Error("Document state was not persisted.");
			return { definition, current };
		},
		get(docName) {
			const doc = requiredDocument(deps.documents, docName);
			const definition = deps.store.loadDocumentState(doc.id);
			if (!definition) return null;
			const current = deps.store.loadCurrentDocumentState(doc.id);
			if (!current) throw new Error("Document state has no revision.");
			return { definition, current };
		},
		update(docName, expectedRevision, data) {
			const { doc, current } = requiredState(deps, docName);
			assertValidState(current.schema, data);
			assertRenderableStateTemplates(doc, current.schema, data);
			const revision = deps.store.appendDocumentStateRevision(
				doc.id,
				expectedRevision,
				data,
			);
			emitStateChanged(deps.bus, doc.name, revision.revision, [""]);
			return revision;
		},
		patch(docName, expectedRevision, operations) {
			return patchState(deps, docName, expectedRevision, operations);
		},
		patchTerminal(docName, expectedRevision, operation) {
			if (operation.path === "") {
				throw new MessageError(
					"The document-state root is not an editable terminal.",
					"msg_state_root_not_terminal",
				);
			}
			const { doc, current } = requiredState(deps, docName);
			const previous = readJsonPointer(current.data, operation.path);
			if (
				!isTerminalJsonValue(previous) ||
				!isTerminalJsonValue(operation.value)
			) {
				throw new MessageError(
					"Live document interactions can replace terminal JSON values only.",
					"msg_state_terminal_only",
				);
			}
			if (!activeBindingPaths(doc, current).has(operation.path)) {
				throw new MessageError(
					`Document state path "${operation.path}" is not exposed by an active document binding.`,
					"msg_state_path_not_bound",
					{ path: operation.path },
				);
			}
			return patchState(deps, docName, expectedRevision, [operation]);
		},
		changeSchema(docName, expectedRevision, schema, data) {
			const { doc, current } = requiredState(deps, docName);
			const nextData = data ?? current.data;
			assertValidState(schema, nextData);
			assertRenderableStateTemplates(doc, schema, nextData);
			const revision = deps.store.replaceDocumentStateSchema(
				doc.id,
				expectedRevision,
				schema,
				nextData,
			);
			emitStateChanged(deps.bus, doc.name, revision.revision, [""], true);
			return revision;
		},
		validateSchema(docName, schema, data) {
			const { doc, current } = requiredState(deps, docName);
			const nextData = data ?? current.data;
			assertValidState(schema, nextData);
			assertRenderableStateTemplates(doc, schema, nextData);
		},
		history(docName) {
			const { doc } = requiredState(deps, docName);
			return deps.store.loadDocumentStateHistory(doc.id);
		},
		revision(docName, revision) {
			const { doc } = requiredState(deps, docName);
			return deps.store.loadDocumentStateRevision(doc.id, revision);
		},
		restore(docName, revision, expectedRevision) {
			const { doc } = requiredState(deps, docName);
			const source = deps.store.loadDocumentStateRevision(doc.id, revision);
			if (!source) {
				throw new MessageError(
					`Document state revision ${revision} not found for "${doc.name}".`,
					"msg_state_revision_not_found",
					{ revision, name: doc.name },
				);
			}
			assertValidState(source.schema, source.data);
			assertRenderableStateTemplates(doc, source.schema, source.data);
			const restored = deps.store.replaceDocumentStateSchema(
				doc.id,
				expectedRevision,
				source.schema,
				source.data,
			);
			emitStateChanged(deps.bus, doc.name, restored.revision, [""], true);
			return restored;
		},
	};
}

function patchState(
	deps: DocumentStatesDeps,
	docName: string,
	expectedRevision: number,
	operations: JsonPatchOperation[],
): DocumentStateRevision {
	if (operations.length === 0) {
		throw new Error("At least one JSON Patch operation is required.");
	}
	const { doc, current } = requiredState(deps, docName);
	const data = applyJsonPatch(current.data, operations);
	assertStateObject(data);
	assertValidState(current.schema, data);
	assertRenderableStateTemplates(doc, current.schema, data);
	const revision = deps.store.appendDocumentStateRevision(
		doc.id,
		expectedRevision,
		data,
	);
	emitStateChanged(
		deps.bus,
		doc.name,
		revision.revision,
		changedPointers(operations),
	);
	return revision;
}

function requiredDocument(documents: Documents, docName: string) {
	const doc = documents.resolveOrLoad(docName);
	if (!doc)
		throw new MessageError(
			`Document "${docName}" not found.`,
			"msg_document_not_found",
			{ name: docName },
		);
	return doc;
}

function requiredState(deps: DocumentStatesDeps, docName: string) {
	const doc = requiredDocument(deps.documents, docName);
	if (doc.dataModel !== "state") {
		throw new MessageError(
			`Document "${doc.name}" has no state.`,
			"msg_document_no_state",
			{ name: doc.name },
		);
	}
	const definition = deps.store.loadDocumentState(doc.id);
	if (!definition)
		throw new MessageError(
			`Document "${doc.name}" has no state.`,
			"msg_document_no_state",
			{ name: doc.name },
		);
	const current = deps.store.loadCurrentDocumentState(doc.id);
	if (!current)
		throw new Error(`Document "${doc.name}" has no state revision.`);
	return { doc, definition, current };
}

function assertValidState(
	schema: DocumentStateSchema,
	data: DocumentStateData,
): void {
	const issues = validateDocumentState(schema, data);
	if (issues.length > 0) throw new Error(issues.join("\n"));
}

function assertValidStateTemplates(doc: Document): void {
	for (const page of doc.pages) {
		if (page.html) validateDocumentStateTemplate(page.html);
	}
}

function assertRenderableStateTemplates(
	doc: Document,
	schema: DocumentStateSchema,
	data: DocumentStateData,
): void {
	for (const page of doc.pages) {
		if (page.html) renderDocumentStateText(page.html, data, { schema });
	}
}

function activeBindingPaths(
	doc: Document,
	state: DocumentStateRevision,
): Set<string> {
	return new Set(
		doc.pages.flatMap((page) =>
			page.html
				? renderDocumentStateText(page.html, state.data, {
						schema: state.schema,
					}).bindingPaths
				: [],
		),
	);
}

function assertStateObject(data: unknown): asserts data is DocumentStateData {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		throw new Error("Document state must remain a JSON object.");
	}
}

function changedPointers(operations: JsonPatchOperation[]): string[] {
	if (
		operations.some(
			(operation) => operation.op === "remove" || operation.op === "move",
		)
	) {
		return [""];
	}
	return [
		...new Set(
			operations.flatMap((operation) =>
				"from" in operation
					? [operation.path, operation.from]
					: [operation.path],
			),
		),
	];
}

function emitStateChanged(
	bus: Bus,
	docName: string,
	revision: number,
	paths: string[],
	schemaChanged = false,
	attached = false,
): void {
	bus.emit("document-state:changed", {
		docName,
		revision,
		paths,
		schemaChanged,
		attached,
	});
}
