import {
	type Collection,
	type CollectionField,
	type CollectionSummary,
	listCollectionFields,
	summarizeCollection,
} from "@maket/shared";
import { renderCollectionDocument } from "../lib/collection-render.js";
import type { Document } from "../types.js";
import type { Bus } from "./bus.js";
import type { Documents } from "./documents.js";
import type { Store } from "./store.js";

export interface Collections {
	list(): CollectionSummary[];
	loadAll(): Collection[];
	resolve(name: string): Collection | null;
	save(collection: Collection): void;
	delete(name: string): boolean;
	fields(name: string): CollectionField[];
	bindPage(
		docName: string,
		pageIndex: number,
		collectionName: string,
	): Document;
	clearPageBinding(docName: string, pageIndex: number): Document;
	renderDocument(doc: Document): Document;
	referencedBy(docs: readonly Document[]): Collection[];
}

export interface CollectionsDeps {
	bus: Bus;
	documents: Documents;
	store: Store;
}

export function createCollections({
	bus,
	documents,
	store,
}: CollectionsDeps): Collections {
	function resolveRequired(name: string): Collection {
		const collection = store.loadCollection(name);
		if (!collection) throw new Error(`Collection "${name}" not found.`);
		return collection;
	}

	function updatePageBinding(
		docName: string,
		pageIndex: number,
		collectionName: string | null,
	): Document {
		const doc = documents.resolveOrLoad(docName);
		if (!doc) throw new Error(`Document "${docName}" not found.`);
		const page = doc.pages[pageIndex];
		if (!page) throw new Error(`Page ${pageIndex + 1} not found.`);
		if (collectionName) resolveRequired(collectionName);
		if (collectionName) page.collection = { name: collectionName };
		else delete page.collection;
		documents.persist(doc.name);
		bus.emit("document:saved", { docName: doc.name });
		return doc;
	}

	function referencedBy(docs: readonly Document[]): Collection[] {
		const names = new Set<string>();
		for (const doc of docs) {
			for (const page of doc.pages) {
				if (page.collection?.name) names.add(page.collection.name);
			}
		}
		return [...names].map(resolveRequired);
	}

	return {
		list() {
			return store.loadAllCollections().map(summarizeCollection);
		},
		loadAll() {
			return store.loadAllCollections();
		},
		resolve(name) {
			return store.loadCollection(name);
		},
		save(collection) {
			store.saveCollection(collection);
			bus.emit("collection:saved", { name: collection.name });
			bus.emit("toast", {
				text: `Collection "${collection.name}" saved`,
				level: "success",
			});
		},
		delete(name) {
			const references = referencedDocuments(name, store.loadAll());
			if (references.length > 0) {
				throw new Error(
					`Collection "${name}" is used by ${references.join(", ")}. Unbind it before deleting.`,
				);
			}
			const deleted = store.deleteCollection(name);
			if (deleted) {
				bus.emit("collection:deleted", { name });
				bus.emit("toast", {
					text: `Collection "${name}" deleted`,
					level: "success",
				});
			}
			return deleted;
		},
		fields(name) {
			return listCollectionFields(resolveRequired(name));
		},
		bindPage(docName, pageIndex, collectionName) {
			return updatePageBinding(docName, pageIndex, collectionName);
		},
		clearPageBinding(docName, pageIndex) {
			return updatePageBinding(docName, pageIndex, null);
		},
		renderDocument(doc) {
			const referenced = referencedBy([doc]);
			return renderCollectionDocument(
				doc,
				new Map(referenced.map((collection) => [collection.name, collection])),
			);
		},
		referencedBy,
	};
}

function referencedDocuments(
	collectionName: string,
	docs: readonly Document[],
): string[] {
	const names = new Set<string>();
	for (const doc of docs) {
		if (doc.pages.some((page) => page.collection?.name === collectionName)) {
			names.add(doc.name);
		}
	}
	return [...names].sort();
}
