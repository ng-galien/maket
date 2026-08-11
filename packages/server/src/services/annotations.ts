/**
 * Persistent, server-owned user annotations exposed to the browser and agent.
 * The browser mirrors this state; it never replaces it on connection.
 */

import type { PendingMessage } from "../types.js";
import type { Bus } from "./bus.js";
import type { Store } from "./store.js";

export interface Annotations {
	create(annotation: PendingMessage): void;
	forDoc(docName: string): PendingMessage[];
	forWorkspace(): PendingMessage[];
	all(): PendingMessage[];
	ack(ids: string[]): { matched: string[]; unknown: string[] };
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
			store.saveAnnotation(annotation);
			bus.emit("annotations:changed", {});
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
	};
}
