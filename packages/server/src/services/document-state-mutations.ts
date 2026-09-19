import {
	applyJsonPatch,
	type DocumentStateData,
	type DocumentStateRevision,
	type DocumentStateSchema,
	type JsonPatchOperation,
	validateStructuredWorkspaceItemData,
} from "@maket/shared";
import { MessageError } from "../lib/message-error.js";
import type { DocumentStates, DocumentStateView } from "./document-states.js";
import type { Documents } from "./documents.js";
import type { Store } from "./store.js";

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
	restore(
		docName: string,
		revision: number,
		expectedRevision: number,
	): DocumentStateRevision;
}

export interface DocumentStateMutationsDeps {
	documentStates: DocumentStates;
	documents: Documents;
	store: Store;
}

/**
 * Public state-write boundary. Structured Workspace internals use
 * DocumentStates directly for their owned projections; MCP and WS mutations
 * pass here so collection projections stay derived and item data satisfies the
 * aggregate workspace schema before a revision is appended.
 */
export function createDocumentStateMutations(
	deps: DocumentStateMutationsDeps,
): DocumentStateMutations {
	return {
		initialize(docName, schema, data) {
			assertSchemaMutationAllowed(deps, docName);
			return deps.documentStates.initialize(docName, schema, data);
		},
		update(docName, expectedRevision, data) {
			assertDataMutationAllowed(deps, docName, data);
			return deps.documentStates.update(docName, expectedRevision, data);
		},
		patch(docName, expectedRevision, operations) {
			assertPatchedDataAllowed(deps, docName, operations);
			return deps.documentStates.patch(docName, expectedRevision, operations);
		},
		patchTerminal(docName, expectedRevision, operation) {
			assertPatchedDataAllowed(deps, docName, [operation]);
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
	};
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
