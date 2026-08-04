import {
	type DocumentStateData,
	type DocumentStateRevision,
	type DocumentStateSchema,
	validateDocumentState,
} from "@maket/shared";
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

export interface DocumentStateDifference {
	path: string;
	before?: unknown;
	after?: unknown;
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
	history(docName: string): DocumentStateRevision[];
	revision(docName: string, revision: number): DocumentStateRevision | null;
	restore(
		docName: string,
		revision: number,
		expectedRevision: number,
	): DocumentStateRevision;
	diff(
		docName: string,
		fromRevision: number,
		toRevision: number,
	): DocumentStateDifference[];
}

export interface DocumentStatesDeps {
	bus: Bus;
	documents: Documents;
	store: DocumentStateRepository;
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
			assertValidState(schema, data);
			const current = deps.store.initializeDocumentState(doc.id, schema, data);
			doc.dataModel = "state";
			emitStateChanged(deps.bus, doc.name, current.revision);
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
			const { doc, definition } = requiredState(deps, docName);
			assertValidState(definition.schema, data);
			const revision = deps.store.appendDocumentStateRevision(
				doc.id,
				expectedRevision,
				data,
			);
			emitStateChanged(deps.bus, doc.name, revision.revision);
			return revision;
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
				throw new Error(
					`Document state revision ${revision} not found for "${doc.name}".`,
				);
			}
			const restored = deps.store.appendDocumentStateRevision(
				doc.id,
				expectedRevision,
				source.data,
			);
			emitStateChanged(deps.bus, doc.name, restored.revision);
			return restored;
		},
		diff(docName, fromRevision, toRevision) {
			const { doc } = requiredState(deps, docName);
			const from = deps.store.loadDocumentStateRevision(doc.id, fromRevision);
			const to = deps.store.loadDocumentStateRevision(doc.id, toRevision);
			if (!from || !to) {
				throw new Error(
					`Document state revisions ${fromRevision} and ${toRevision} must both exist for "${doc.name}".`,
				);
			}
			return diffDocumentState(from.data, to.data);
		},
	};
}

function requiredDocument(documents: Documents, docName: string) {
	const doc = documents.resolveOrLoad(docName);
	if (!doc) throw new Error(`Document "${docName}" not found.`);
	return doc;
}

function requiredState(deps: DocumentStatesDeps, docName: string) {
	const doc = requiredDocument(deps.documents, docName);
	if (doc.dataModel !== "state") {
		throw new Error(`Document "${doc.name}" has no state.`);
	}
	const definition = deps.store.loadDocumentState(doc.id);
	if (!definition) throw new Error(`Document "${doc.name}" has no state.`);
	return { doc, definition };
}

function assertValidState(
	schema: DocumentStateSchema,
	data: DocumentStateData,
): void {
	const issues = validateDocumentState(schema, data);
	if (issues.length > 0) throw new Error(issues.join("\n"));
}

function emitStateChanged(bus: Bus, docName: string, revision: number): void {
	bus.emit("document-state:changed", { docName, revision });
	bus.emit("toast", {
		text: `Document state updated to revision ${revision}`,
		level: "success",
	});
}

export function diffDocumentState(
	before: DocumentStateData,
	after: DocumentStateData,
): DocumentStateDifference[] {
	const differences: DocumentStateDifference[] = [];
	diffValue(before, after, "", differences);
	return differences;
}

function diffValue(
	before: unknown,
	after: unknown,
	path: string,
	differences: DocumentStateDifference[],
): void {
	if (Object.is(before, after)) return;
	if (isRecord(before) && isRecord(after)) {
		const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
		for (const key of [...keys].sort()) {
			const childPath = `${path}/${escapePointerToken(key)}`;
			if (!(key in before)) {
				differences.push({ path: childPath, after: after[key] });
			} else if (!(key in after)) {
				differences.push({ path: childPath, before: before[key] });
			} else {
				diffValue(before[key], after[key], childPath, differences);
			}
		}
		return;
	}
	if (JSON.stringify(before) === JSON.stringify(after)) return;
	differences.push({ path: path || "/", before, after });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapePointerToken(value: string): string {
	return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
