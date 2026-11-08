/** HTTP reads are prepared at the public query/open boundary. Only the
 * requested batch and explicitly opened records are held; rendering is sync. */
import type {
	StructuredWorkspaceDefinition,
	StructuredWorkspaceHttpSource,
	StructuredWorkspaceItemReference,
} from "@maket/shared";
import { readJsonPointer } from "@maket/shared";
import {
	createHttpItemProtocol,
	httpItemDocumentName,
} from "./http-item-protocol.js";
import type {
	ItemPage,
	ItemQuery,
	ItemRecord,
	ItemSource,
} from "./item-source.js";
import { itemSourceError } from "./item-source-error.js";
import type { LocalItemSourceDeps } from "./local-item-source.js";

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// HTTP source owns the lifecycle of prepared batches and opened records, delegating wire validation to its protocol adapter and announcements to the bus.
export function createHttpItemSource(
	deps: LocalItemSourceDeps,
	workspace: StructuredWorkspaceDefinition,
	config: StructuredWorkspaceHttpSource,
): ItemSource {
	let closed = false;
	let page: ItemPage = { items: [] };
	const batches = new Map<string, ItemPage>();
	let lastQuery: ItemQuery | undefined;
	const records = new Map<string, ItemRecord>();
	const opened = new Set<string>();
	const signature = (query: ItemQuery) =>
		JSON.stringify({ ...query, whole: undefined });
	const assertOpen = () => {
		if (closed)
			throw itemSourceError("source_unreachable", "HTTP source is closed.");
	};
	const reference = (id: string): StructuredWorkspaceItemReference => ({
		id,
		sequence: 0,
		collectionId: config.collectionId,
		bindingId: config.bindingId,
		documentId: "",
		documentName: httpItemDocumentName(workspace.id, id),
	});
	const protocol = createHttpItemProtocol(workspace, config, assertOpen);
	const source: ItemSource = {
		capabilities: () => ({
			readOnly: true,
			create: false,
			delete: false,
			search: Boolean(config.list.params.text),
			sort: "pushdown",
			total: config.list.totalPointer === undefined ? "none" : "exact",
			changes: "none",
			revisions:
				config.get.revisionPointer || config.list.revisionPointer
					? "source"
					: "none",
		}),
		async prepare(query) {
			assertOpen();
			const result = await protocol.read(protocol.queryUrl(query));
			if (!result) return;
			const batch = protocol.readBatch(query, result);
			for (const id of records.keys()) if (!opened.has(id)) records.delete(id);
			for (const item of batch.records)
				if (!opened.has(item.id)) records.set(item.id, structuredClone(item));
			page = batch.page;
			if (query.cursor === undefined) batches.clear();
			batches.set(signature(query), structuredClone(page));
			lastQuery = structuredClone(query);
		},
		list(query) {
			assertOpen();
			if (!batches.size) return { items: [] };
			if (!batches.has(signature(query)))
				throw itemSourceError(
					"query_unsupported",
					"Prepare this HTTP batch before rendering it.",
				);
			return structuredClone(batches.get(signature(query)) ?? { items: [] });
		},
		get(id) {
			assertOpen();
			const item = records.get(id);
			return item ? structuredClone(item) : null;
		},
		reference(id) {
			return records.has(id) ? reference(id) : null;
		},
		referenceForDocument(name) {
			const prefix = `HTTP item ${workspace.id} `;
			if (!name.startsWith(prefix)) return null;
			try {
				const id = decodeURIComponent(name.slice(prefix.length));
				return name === httpItemDocumentName(workspace.id, id)
					? reference(id)
					: null;
			} catch {
				return null;
			}
		},
		async refresh(target) {
			assertOpen();
			if (target.scope === "index") {
				if (lastQuery) await source.prepare?.(lastQuery);
			} else {
				const result = await protocol.read(
					protocol.urlFor(
						config.get.path.replaceAll("{id}", encodeURIComponent(target.id)),
					),
					true,
				);
				if (!result) {
					records.delete(target.id);
					opened.delete(target.id);
					throw itemSourceError(
						"unknown_item",
						`HTTP item ${target.id} no longer exists.`,
					);
				}
				const data =
					config.get.dataPointer === undefined
						? result.value
						: pointerValue(result.value, config.get.dataPointer);
				const revision =
					config.get.revisionPointer === undefined
						? result.etag
						: pointerValue(data, config.get.revisionPointer);
				const item = protocol.record(data, revision);
				if (item.id !== target.id)
					throw itemSourceError(
						"invalid_record",
						"HTTP detail identity does not match the requested item.",
					);
				records.set(item.id, structuredClone(item));
				opened.add(item.id);
			}
			deps.bus.emit("structured-workspace:source-changed", {
				workspaceId: workspace.id,
				scope: target.scope,
				...(target.scope === "item" ? { itemId: target.id } : {}),
			});
		},
		async close() {
			closed = true;
			records.clear();
			opened.clear();
			page = { items: [] };
			batches.clear();
		},
	};
	return source;
}

function pointerValue(value: unknown, pointer: string): unknown {
	try {
		return readJsonPointer(value, pointer);
	} catch {
		return undefined;
	}
}
