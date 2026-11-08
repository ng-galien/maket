import {
	readJsonPointer,
	type StructuredWorkspaceDefinition,
	type StructuredWorkspaceHttpSource,
	structuredWorkspaceBindingSchema,
	structuredWorkspaceIdentityValue,
	structuredWorkspaceItemDataIssues,
	structuredWorkspaceMaxBatch,
} from "@maket/shared";
import type {
	ItemPage,
	ItemQuery,
	ItemRecord,
	ItemSummary,
} from "./item-source.js";
import { isItemSourceError, itemSourceError } from "./item-source-error.js";

export interface HttpRead {
	value: unknown;
	etag?: string;
}
export interface HttpItemProtocol {
	read(url: URL, allowMissing?: boolean): Promise<HttpRead | null>;
	queryUrl(query: ItemQuery): URL;
	urlFor(path: string): URL;
	record(value: unknown, revision: unknown): ItemRecord;
	readBatch(
		query: ItemQuery,
		result: HttpRead,
	): { records: ItemRecord[]; page: ItemPage };
}

export function httpItemDocumentName(workspaceId: string, id: string): string {
	return `HTTP item ${workspaceId} ${encodeURIComponent(id)}`;
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// HTTP protocol is the adapter port between declared URL mappings, transport and the canonical shared identity/schema validators.
export function createHttpItemProtocol(
	workspace: StructuredWorkspaceDefinition,
	config: StructuredWorkspaceHttpSource,
	assertOpen: () => void,
): HttpItemProtocol {
	const collection =
		workspace.representationSchema.collections[config.collectionId];
	const binding = collection?.bindings[config.bindingId];
	if (!collection || !binding)
		throw itemSourceError(
			"invalid_record",
			"HTTP source must declare its collection and binding.",
		);
	const schema = structuredWorkspaceBindingSchema(
		workspace.dataSchema,
		binding,
	);
	const record = (value: unknown, revision: unknown): ItemRecord => {
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw itemSourceError(
				"invalid_record",
				"HTTP item data must be a JSON object.",
			);
		const data = value as Record<string, unknown>;
		const id = structuredWorkspaceIdentityValue(
			data,
			collection.identity ?? "",
		);
		if (id === null)
			throw itemSourceError(
				"invalid_record",
				`HTTP record lacks the declared identity ${collection.identity}.`,
			);
		if (
			revision !== undefined &&
			typeof revision !== "string" &&
			typeof revision !== "number"
		)
			throw itemSourceError(
				"invalid_record",
				"HTTP revision must be a string or number.",
			);
		return {
			id,
			bindingId: config.bindingId,
			revision: revision === undefined ? "" : String(revision),
			data,
		};
	};
	const read = async (url: URL, allowMissing = false) => {
		assertOpen();
		const headers: Record<string, string> = { Accept: "application/json" };
		if (config.auth) {
			const secret = process.env[config.auth.slice(4)];
			if (!secret)
				throw itemSourceError(
					"source_unreachable",
					`HTTP authentication environment reference ${config.auth} is unavailable.`,
				);
			headers.Authorization = `Bearer ${secret}`;
		}
		try {
			const response = await fetch(url, {
				headers,
				redirect: "error",
				signal: AbortSignal.timeout(10000),
			});
			if (allowMissing && response.status === 404) return null;
			if (!response.ok)
				throw itemSourceError(
					"source_unreachable",
					`HTTP source answered ${response.status}.`,
				);
			const value: unknown = await response.json();
			assertOpen();
			return { value, etag: response.headers.get("etag") ?? undefined };
		} catch (error) {
			if (isItemSourceError(error)) throw error;
			throw itemSourceError(
				"source_unreachable",
				"HTTP source could not be read; retry the query or reopen the item.",
			);
		}
	};
	const urlFor = (path: string) =>
		new URL(
			path,
			config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`,
		);
	const queryUrl = (query: ItemQuery) => {
		if (query.collectionId !== config.collectionId)
			throw itemSourceError(
				"unknown_collection",
				"HTTP source does not serve this collection.",
			);
		if (
			!Number.isInteger(query.limit) ||
			query.limit < 1 ||
			query.limit > structuredWorkspaceMaxBatch
		)
			throw itemSourceError(
				"query_unsupported",
				"HTTP batch size must be between 1 and 500.",
			);
		if (
			query.groupBy !== undefined ||
			(query.text && !config.list.params.text) ||
			(query.filters?.length && !config.list.params.filters)
		)
			throw itemSourceError(
				"query_unsupported",
				"HTTP source does not declare parameters for this query.",
			);
		const url = urlFor(config.list.path);
		const params = config.list.params;
		url.searchParams.set(params.limit, String(query.limit));
		if (query.cursor !== undefined)
			url.searchParams.set(params.cursor, query.cursor);
		if (query.text && params.text)
			url.searchParams.set(params.text, query.text);
		const sort = query.sort ?? {
			field: collection.sortBy,
			direction: collection.sortDirection ?? "ascending",
		};
		url.searchParams.set(params.sort, JSON.stringify(sort));
		if (query.filters?.length && params.filters)
			url.searchParams.set(params.filters, JSON.stringify(query.filters));

		return url;
	};
	const readBatch = (query: ItemQuery, result: HttpRead) => {
		const values = pointerValue(result.value, config.list.itemsPointer);
		const next = pointerValue(result.value, config.list.nextPointer);
		const total =
			config.list.totalPointer === undefined
				? undefined
				: pointerValue(result.value, config.list.totalPointer);
		if (!Array.isArray(values) || values.length > query.limit)
			throw itemSourceError(
				"invalid_record",
				"HTTP source must answer an array no larger than the requested batch.",
			);
		if (
			next !== undefined &&
			next !== null &&
			(typeof next !== "string" || !next || next === query.cursor)
		)
			throw itemSourceError(
				"invalid_record",
				"HTTP next cursor must be a new non-empty opaque string, or absent/null.",
			);
		if (
			total !== undefined &&
			(!Number.isSafeInteger(total) || Number(total) < 0)
		)
			throw itemSourceError(
				"invalid_record",
				"HTTP total must be a non-negative integer.",
			);
		const batch = values.map((value) =>
			record(
				value,
				config.list.revisionPointer === undefined
					? undefined
					: pointerValue(value, config.list.revisionPointer),
			),
		);
		if (new Set(batch.map((item) => item.id)).size !== batch.length)
			throw itemSourceError(
				"invalid_record",
				"HTTP batch contains duplicate item identities.",
			);
		const items: ItemSummary[] = batch.map((item) => {
			const issues = structuredWorkspaceItemDataIssues(schema, item.data);
			return {
				id: item.id,
				bindingId: item.bindingId,
				revision: item.revision,
				documentName: httpItemDocumentName(workspace.id, item.id),
				fields: item.data,
				...(issues.length ? { issues } : {}),
			};
		});

		return {
			records: batch,
			page: {
				items,
				...(typeof next === "string" ? { next } : {}),
				...(total === undefined ? {} : { total: Number(total) }),
			},
		};
	};
	return { read, queryUrl, urlFor, record, readBatch };
}

function pointerValue(value: unknown, pointer: string): unknown {
	try {
		return readJsonPointer(value, pointer);
	} catch {
		return undefined;
	}
}
