/**
 * Persistent, server-owned user annotations exposed to the browser and agent.
 * The browser mirrors this state; it never replaces it on connection.
 */

import { MessageError } from "../lib/message-error.js";
import type { PendingMessage } from "../types.js";
import type { Bus } from "./bus.js";
import type { Store } from "./store.js";

export interface Annotations {
	create(annotation: PendingMessage): void;
	forDoc(docName: string): PendingMessage[];
	forWorkspace(): PendingMessage[];
	all(): PendingMessage[];
	ack(ids: string[]): { matched: string[]; unknown: string[] };
	/** Replaces the text of a pending note and marks it edited. Throws a
	 * MessageError when the note was acknowledged, is not a note, or the text
	 * is empty. */
	edit(id: string, text: string): PendingMessage;
}

export interface AnnotationsDeps {
	bus: Bus;
	store: Store;
}

export function createAnnotations({
	bus,
	store,
}: AnnotationsDeps): Annotations {
	return {
		create(annotation) {
			const { edited: _edited, editedAt: _editedAt, ...fresh } = annotation;
			const documentId = store.saveAnnotation(fresh);
			bus.emit("annotations:changed", documentId ? { documentId } : {});
		},
		forDoc(docName) {
			return store
				.loadAnnotations()
				.filter((annotation) => annotation.docName === docName);
		},
		forWorkspace() {
			return store
				.loadAnnotations()
				.filter((annotation) => !annotation.docName);
		},
		all() {
			return store.loadAnnotations();
		},
		ack(ids) {
			if (ids.length === 0) return { matched: [], unknown: [] };
			const matched = store.deleteAnnotations(ids);
			const matchedSet = new Set(matched);
			const unknown = ids.filter((id) => !matchedSet.has(id));
			if (matched.length > 0) bus.emit("messages:acked", { ids: matched });
			return { matched, unknown };
		},
		edit(id, text) {
			const next = text.trim();
			if (!next)
				throw new MessageError(
					"A message needs some text.",
					"msg_annotation_text_required",
				);
			const current = store
				.loadAnnotations()
				.find((annotation) => annotation.id === id);
			if (!current)
				throw new MessageError(
					`Message "${id}" is no longer pending: the agent already acknowledged it or it was deleted.`,
					"msg_annotation_not_found",
				);
			if (current.type !== "note")
				throw new MessageError(
					`Message "${id}" is a ${current.type} request; only notes carry editable text.`,
					"msg_annotation_not_editable",
				);
			if (current.text === next) return current;
			const editedAt = Date.now();
			store.updateAnnotationText(id, next, editedAt);
			bus.emit("annotations:changed", {});
			return { ...current, text: next, edited: true, editedAt };
		},
	};
}
