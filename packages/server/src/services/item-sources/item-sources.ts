/**
 * ItemSources — the registry of item sources, one per Structured Workspace,
 * opened on first use and closed when the workspace is deleted. Every
 * workspace is served by the local connector today.
 */

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

export function createItemSources(deps: ItemSourcesDeps): ItemSources {
	const open = new Map<string, ItemSource>();
	const sources: ItemSources = {
		sourceFor(workspaceId) {
			const existing = open.get(workspaceId);
			if (existing) return existing;
			const source = createLocalItemSource(deps, workspaceId);
			open.set(workspaceId, source);
			return source;
		},
		async close(workspaceId) {
			const source = open.get(workspaceId);
			open.delete(workspaceId);
			await source?.close();
		},
	};
	deps.bus.on("structured-workspace:deleted", ({ workspaceId }) => {
		void sources.close(workspaceId);
	});
	return sources;
}
