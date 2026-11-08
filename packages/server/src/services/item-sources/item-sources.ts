/**
 * ItemSources — the registry of item sources, one per Structured Workspace,
 * opened on first use and closed when the workspace is deleted. Every
 * workspace is served by the local connector today.
 */

import { createHttpItemSource } from "./http-item-source.js";
import { validateDataSource } from "./http-source-definition.js";
import type { ItemSource } from "./item-source.js";
import {
	createLocalItemSource,
	type LocalItemSourceDeps,
} from "./local-item-source.js";

export interface ItemSources {
	/** The source serving the items of a workspace, opened on first use. */
	sourceFor(workspaceId: string): ItemSource;
	/** Close and forget a workspace's source; the next sourceFor opens a new one. */
	close(workspaceId: string): Promise<void>;
}

export type ItemSourcesDeps = LocalItemSourceDeps;

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Source registry owns connector selection and lifecycle across provider factories.
export function createItemSources(deps: ItemSourcesDeps): ItemSources {
	const open = new Map<string, ItemSource>();
	const definitions = new Map<string, string>();
	const sources: ItemSources = {
		sourceFor(workspaceId) {
			const workspace = deps.store.loadStructuredWorkspace(workspaceId);
			const signature = JSON.stringify([
				workspace?.dataSource,
				workspace?.dataSchema,
				workspace?.representationSchema,
			]);
			const existing = open.get(workspaceId);
			if (existing && definitions.get(workspaceId) === signature)
				return existing;
			if (existing) void existing.close();
			if (workspace)
				validateDataSource(
					workspace.dataSource,
					workspace.representationSchema,
				);
			const source =
				workspace?.dataSource?.kind === "http"
					? createHttpItemSource(deps, workspace, workspace.dataSource)
					: createLocalItemSource(deps, workspaceId);
			definitions.set(workspaceId, signature);
			open.set(workspaceId, source);
			return source;
		},
		async close(workspaceId) {
			const source = open.get(workspaceId);
			open.delete(workspaceId);
			definitions.delete(workspaceId);
			await source?.close();
		},
	};
	deps.bus.on("structured-workspace:deleted", ({ workspaceId }) => {
		void sources.close(workspaceId);
	});
	return sources;
}
