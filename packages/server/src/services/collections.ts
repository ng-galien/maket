import {
	type Collection,
	type CollectionField,
	type CollectionMember,
	type CollectionSchema,
	type CollectionSummary,
	type CollectionTemplateIssue,
	listCollectionFields,
	summarizeCollection,
	validateCollection,
} from "@maket/shared";
import {
	type CollectionRenderOptions,
	renderCollectionDocument,
} from "../lib/collection-render.js";
import type { Document } from "../types.js";
import type { Bus } from "./bus.js";
import type { Documents } from "./documents.js";
import type { Store } from "./store.js";

export interface Collections {
	list(): CollectionSummary[];
	loadAll(): Collection[];
	resolve(name: string): Collection | null;
	create(
		name: string,
		schema: CollectionSchema,
		description?: string,
	): Collection;
	save(collection: Collection): void;
	validateSchema(
		name: string,
		schema: CollectionSchema,
	): CollectionSchemaValidation;
	changeSchema(
		name: string,
		schema: CollectionSchema,
	): CollectionSchemaValidation;
	addRow(name: string, data: Record<string, unknown>, id?: string): Collection;
	updateRow(
		name: string,
		id: string,
		data: Record<string, unknown>,
	): Collection;
	deleteRow(name: string, id: string): Collection;
	delete(name: string): boolean;
	fields(name: string): CollectionField[];
	bindPage(
		docName: string,
		pageIndex: number,
		collectionName: string,
	): Document;
	clearPageBinding(docName: string, pageIndex: number): Document;
	renderDocument(doc: Document, options?: CollectionRenderOptions): Document;
	referencedBy(docs: readonly Document[]): Collection[];
}

export interface CollectionSchemaValidation {
	valid: boolean;
	issues: CollectionTemplateIssue[];
}

export interface CollectionsDeps {
	bus: Bus;
	documents: Documents;
	store: Store;
}

export function createCollections(deps: CollectionsDeps): Collections {
	return {
		list() {
			return deps.store.loadAllCollections().map(summarizeCollection);
		},
		loadAll() {
			return deps.store.loadAllCollections();
		},
		resolve(name) {
			return deps.store.loadCollection(name);
		},
		create(name, schema, description) {
			return createCollection(deps, name, schema, description);
		},
		save(collection) {
			persistCollection(deps, collection);
		},
		validateSchema(name, schema) {
			return validateCollectionSchemaChange(deps, name, schema);
		},
		changeSchema(name, schema) {
			return changeCollectionSchema(deps, name, schema);
		},
		addRow(name, data, id) {
			return addCollectionRow(deps, name, data, id);
		},
		updateRow(name, id, data) {
			return updateCollectionRow(deps, name, id, data);
		},
		deleteRow(name, id) {
			return deleteCollectionRow(deps, name, id);
		},
		delete(name) {
			return deleteCollection(deps, name);
		},
		fields(name) {
			return listCollectionFields(resolveRequiredCollection(deps, name));
		},
		bindPage(docName, pageIndex, collectionName) {
			return updatePageBinding(deps, docName, pageIndex, collectionName);
		},
		clearPageBinding(docName, pageIndex) {
			return updatePageBinding(deps, docName, pageIndex, null);
		},
		renderDocument(doc, options) {
			const referenced = referencedBy(deps, [doc]);
			return renderCollectionDocument(
				doc,
				new Map(referenced.map((collection) => [collection.name, collection])),
				options,
			);
		},
		referencedBy(docs) {
			return referencedBy(deps, docs);
		},
	};
}

function persistCollection(
	{ bus, store }: CollectionsDeps,
	collection: Collection,
): void {
	store.saveCollection(collection);
	bus.emit("collection:saved", { name: collection.name });
	bus.emit("toast", {
		text: `Collection "${collection.name}" saved`,
		level: "success",
	});
}

function resolveRequiredCollection(
	{ store }: CollectionsDeps,
	name: string,
): Collection {
	const collection = store.loadCollection(name);
	if (!collection) throw new Error(`Collection "${name}" not found.`);
	return collection;
}

function createCollection(
	deps: CollectionsDeps,
	name: string,
	schema: CollectionSchema,
	description?: string,
): Collection {
	const collection = { name, description, schema, members: [] };
	persistCollection(deps, collection);
	return collection;
}

function validateCollectionSchemaChange(
	deps: CollectionsDeps,
	name: string,
	schema: CollectionSchema,
): CollectionSchemaValidation {
	const collection = resolveRequiredCollection(deps, name);
	const issues = validateCollection({ ...collection, schema });
	return { valid: issues.length === 0, issues };
}

function changeCollectionSchema(
	deps: CollectionsDeps,
	name: string,
	schema: CollectionSchema,
): CollectionSchemaValidation {
	const result = validateCollectionSchemaChange(deps, name, schema);
	if (!result.valid) return result;
	persistCollection(deps, { ...resolveRequiredCollection(deps, name), schema });
	return result;
}

function addCollectionRow(
	deps: CollectionsDeps,
	name: string,
	data: Record<string, unknown>,
	id?: string,
): Collection {
	const collection = resolveRequiredCollection(deps, name);
	const member = collectionMember(collection, data, id);
	const next = { ...collection, members: [...collection.members, member] };
	persistCollection(deps, next);
	return next;
}

function updateCollectionRow(
	deps: CollectionsDeps,
	name: string,
	id: string,
	data: Record<string, unknown>,
): Collection {
	const collection = resolveRequiredCollection(deps, name);
	assertExistingRow(collection, id);
	const next = {
		...collection,
		members: collection.members.map((member) =>
			member.id === id ? { ...member, data } : member,
		),
	};
	persistCollection(deps, next);
	return next;
}

function deleteCollectionRow(
	deps: CollectionsDeps,
	name: string,
	id: string,
): Collection {
	const collection = resolveRequiredCollection(deps, name);
	assertExistingRow(collection, id);
	const members = collection.members
		.filter((member) => member.id !== id)
		.sort((a, b) => a.position - b.position)
		.map((member, position) => ({ ...member, position }));
	const next = { ...collection, members };
	persistCollection(deps, next);
	return next;
}

function deleteCollection(
	{ bus, store }: CollectionsDeps,
	name: string,
): boolean {
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
}

function updatePageBinding(
	deps: CollectionsDeps,
	docName: string,
	pageIndex: number,
	collectionName: string | null,
): Document {
	const doc = deps.documents.resolveOrLoad(docName);
	if (!doc) throw new Error(`Document "${docName}" not found.`);
	const page = doc.pages[pageIndex];
	if (!page) throw new Error(`Page ${pageIndex + 1} not found.`);
	if (collectionName) resolveRequiredCollection(deps, collectionName);
	if (collectionName) page.collection = { name: collectionName };
	else delete page.collection;
	deps.documents.persist(doc.name);
	deps.bus.emit("document:saved", { docName: doc.name });
	return doc;
}

function referencedBy(
	deps: CollectionsDeps,
	docs: readonly Document[],
): Collection[] {
	const names = new Set<string>();
	for (const doc of docs) {
		for (const page of doc.pages) {
			if (page.collection?.name) names.add(page.collection.name);
		}
	}
	return [...names].map((name) => resolveRequiredCollection(deps, name));
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

function collectionMember(
	collection: Collection,
	data: Record<string, unknown>,
	id?: string,
): CollectionMember {
	const memberId = id ?? nextMemberId(collection);
	if (collection.members.some((member) => member.id === memberId)) {
		throw new Error(
			`Row "${memberId}" already exists in collection "${collection.name}".`,
		);
	}
	return {
		id: memberId,
		position: nextMemberPosition(collection),
		data,
	};
}

function assertExistingRow(collection: Collection, id: string): void {
	if (!collection.members.some((member) => member.id === id)) {
		throw new Error(
			`Row "${id}" not found in collection "${collection.name}".`,
		);
	}
}

function nextMemberPosition(collection: Collection): number {
	if (collection.members.length === 0) return 0;
	return Math.max(...collection.members.map((member) => member.position)) + 1;
}

function nextMemberId(collection: Collection): string {
	let index = collection.members.length + 1;
	let id = `member_${index}`;
	while (collection.members.some((member) => member.id === id)) {
		index += 1;
		id = `member_${index}`;
	}
	return id;
}
