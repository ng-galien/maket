import {
	applyJsonPatch,
	type DocumentStateData,
	type DocumentStateRevision,
	type DocumentStateSchema,
	type JsonPatchOperation,
	validateDocumentState,
	validateStructuredWorkspaceItemData,
} from "@maket/shared";
import { MessageError } from "../lib/message-error.js";
import { assertStateMermaidSources } from "../lib/state-mermaid.js";
import type { DocumentStates, DocumentStateView } from "./document-states.js";
import type { Documents } from "./documents.js";
import type { DocumentStateRetentionChange } from "./sqlite-store/document-state-repository.js";
import type { Store } from "./store.js";
import type { StructuredWorkspaces } from "./structured-workspaces.js";

export interface DocumentStateMutations {
	initialize(
		docName: string,
		schema: DocumentStateSchema,
		data: DocumentStateData,
	): DocumentStateView;
	update(
		docName: string,
		expectedRevision: number,
		data: DocumentStateData,
	): Promise<DocumentStateRevision>;
	patch(
		docName: string,
		expectedRevision: number,
		operations: JsonPatchOperation[],
	): Promise<DocumentStateRevision>;
	patchTerminal(
		docName: string,
		expectedRevision: number,
		operation: Extract<JsonPatchOperation, { op: "replace" | "add" }>,
	): Promise<DocumentStateRevision>;
	changeSchema(
		docName: string,
		expectedRevision: number,
		schema: DocumentStateSchema,
		data?: DocumentStateData,
	): DocumentStateRevision;
	restore(
		docName: string,
		revision: number,
		expectedRevision: number,
	): DocumentStateRevision;
	setRetention(
		docName: string,
		retention: number | null,
	): DocumentStateRetentionChange;
}

export interface DocumentStateMutationsDeps {
	documentStates: DocumentStates;
	documents: Documents;
	store: Store;
	structuredWorkspaces: Pick<
		StructuredWorkspaces,
		"itemOfDocument" | "getItem" | "updateItem"
	>;
}

/**
 * Public state-write boundary. Structured Workspace internals use
 * DocumentStates directly for their owned projections; MCP and WS mutations
 * pass here so collection projections stay derived and item data satisfies the
 * aggregate workspace schema. A data write on an item document goes to the
 * item's source through the Structured Workspace at the source revision, the
 * document state being only the mirror of that item. Revision retention
 * changes neither data nor schema, so it applies to every state document,
 * Workspace projections included.
 */
export function createDocumentStateMutations(
	deps: DocumentStateMutationsDeps,
): DocumentStateMutations {
	return {
		initialize(docName, schema, data) {
			assertSchemaMutationAllowed(deps, docName);
			return deps.documentStates.initialize(docName, schema, data);
		},
		async update(docName, expectedRevision, data) {
			assertDataMutationAllowed(deps, docName, data);
			const item = deps.structuredWorkspaces.itemOfDocument(docName);
			if (item)
				return writeItem(deps, { docName, item, expectedRevision }, () => data);
			return deps.documentStates.update(docName, expectedRevision, data);
		},
		async patch(docName, expectedRevision, operations) {
			assertPatchedDataAllowed(deps, docName, operations);
			const item = deps.structuredWorkspaces.itemOfDocument(docName);
			if (item)
				return writeItem(deps, { docName, item, expectedRevision }, (data) =>
					patchedData(data, operations),
				);
			return deps.documentStates.patch(docName, expectedRevision, operations);
		},
		async patchTerminal(docName, expectedRevision, operation) {
			assertPatchedDataAllowed(deps, docName, [operation]);
			const item = deps.structuredWorkspaces.itemOfDocument(docName);
			if (item) {
				deps.documentStates.checkTerminal(docName, operation);
				return writeItem(deps, { docName, item, expectedRevision }, (data) =>
					patchedData(data, [operation]),
				);
			}
			return deps.documentStates.patchTerminal(
				docName,
				expectedRevision,
				operation,
			);
		},
		changeSchema(docName, expectedRevision, schema, data) {
			assertSchemaMutationAllowed(deps, docName);
			return deps.documentStates.changeSchema(
				docName,
				expectedRevision,
				schema,
				data,
			);
		},
		restore(docName, revision, expectedRevision) {
			assertSchemaMutationAllowed(deps, docName);
			return deps.documentStates.restore(docName, revision, expectedRevision);
		},
		setRetention(docName, retention) {
			return deps.documentStates.setRetention(docName, retention);
		},
	};
}

/** Write an item document's data through its Structured Workspace: the
 * next data is computed from the source record, validated against the
 * document's state schema, then put at `expectedRevision`. Answers the
 * refreshed mirror. */
async function writeItem(
	deps: DocumentStateMutationsDeps,
	target: {
		docName: string;
		item: { workspaceId: string; itemId: string };
		expectedRevision: number;
	},
	next: (data: DocumentStateData) => DocumentStateData,
): Promise<DocumentStateRevision> {
	const { docName, item, expectedRevision } = target;
	const current = deps.structuredWorkspaces.getItem(
		item.workspaceId,
		item.itemId,
	);
	if (!current)
		throw new MessageError(
			`Document "${docName}" is marked as a Structured Workspace item but its membership is missing.`,
			"msg_state_invalid",
		);
	const data = next(current.data);
	const schema = deps.documentStates.current(docName)?.schema;
	if (schema) {
		const issues = validateDocumentState(schema, data);
		if (issues.length > 0)
			throw new MessageError(issues.join("\n"), "msg_state_invalid");
		assertStateMermaidSources(schema, data, current.data);
	}
	await deps.structuredWorkspaces.updateItem(
		item.workspaceId,
		item.itemId,
		expectedRevision,
		data,
	);
	const mirrored = deps.documentStates.current(docName);
	if (!mirrored)
		throw new MessageError(
			`Document "${docName}" has no state.`,
			"msg_document_no_state",
			{ name: docName },
		);
	return mirrored;
}

function patchedData(
	data: DocumentStateData,
	operations: JsonPatchOperation[],
): DocumentStateData {
	const patched = applyJsonPatch(data, operations);
	if (!isStateData(patched))
		throw new MessageError(
			"Document state must remain a JSON object.",
			"msg_state_not_object",
		);
	return patched;
}

function assertPatchedDataAllowed(
	deps: DocumentStateMutationsDeps,
	docName: string,
	operations: JsonPatchOperation[],
): void {
	assertNotDerivedCollection(deps, docName);
	const state = deps.documentStates.get(docName);
	if (!state) return;
	const data = applyJsonPatch(state.current.data, operations);
	if (!isStateData(data)) {
		throw new MessageError(
			"Document state must remain a JSON object.",
			"msg_state_not_object",
		);
	}
	assertDataMutationAllowed(deps, docName, data);
}

function assertDataMutationAllowed(
	deps: DocumentStateMutationsDeps,
	docName: string,
	data: DocumentStateData,
): void {
	const document = deps.documents.resolveOrLoad(docName);
	const owner = document?.meta.structuredWorkspace;
	if (!document || !owner) return;
	if (owner.role === "collection") throwDerivedCollection(document.name);
	if (owner.role === "template") {
		throw new MessageError(
			`The state of template "${document.name}" belongs to its Workspace.`,
			"msg_state_invalid",
		);
	}
	const workspace = deps.store
		.loadAllStructuredWorkspaces()
		.find((candidate) => candidate.id === owner.workspaceId);
	const item = workspace?.items.find(
		(candidate) =>
			candidate.id === owner.itemId && candidate.documentId === document.id,
	);
	if (!workspace || !item) {
		throw new MessageError(
			`Document "${document.name}" is marked as a Structured Workspace item but its membership is missing.`,
			"msg_state_invalid",
		);
	}
	const issues = validateStructuredWorkspaceItemData(
		workspace.dataSchema,
		data,
	);
	if (issues.length > 0) {
		throw new MessageError(issues.join("\n"), "msg_state_invalid");
	}
}

function assertNotDerivedCollection(
	deps: DocumentStateMutationsDeps,
	docName: string,
): void {
	const document = deps.documents.resolveOrLoad(docName);
	if (document?.meta.structuredWorkspace?.role !== "collection") return;
	throwDerivedCollection(document.name);
}

function throwDerivedCollection(documentName: string): never {
	throw new MessageError(
		`The state of collection document "${documentName}" is derived from its Structured Workspace items and is read-only.`,
		"msg_structured_workspace_collection_state_read_only",
		{ name: documentName },
	);
}

function assertSchemaMutationAllowed(
	deps: DocumentStateMutationsDeps,
	docName: string,
): void {
	const document = deps.documents.resolveOrLoad(docName);
	if (!document?.meta.structuredWorkspace) return;
	throw new MessageError(
		`The schema of "${document.name}" belongs to its Structured Workspace. Change it through maket_structured_workspace.`,
		"msg_state_invalid",
	);
}

function isStateData(value: unknown): value is DocumentStateData {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
