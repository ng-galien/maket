/**
 * McpAppViews — the MCP Apps views Maket serves as `ui://` resources, each
 * with its HTML and the content security policy its host must apply. The
 * MCP handler registers them on every server it builds; tools link to them
 * through `_meta.ui.resourceUri`. The one view is the Maket reader, built
 * from the client into MCP_VIEWS_DIR (`npm run build:mcp-view`); its modes
 * live in the reader, not in other resources.
 */

import {
	MAKET_PAGE_VIEW_FONT_HOSTS,
	MAKET_PAGE_VIEW_URI,
	MCP_APP_MIME_TYPE,
	readerViewHtml,
} from "../lib/maket-reader.js";
import type { Config } from "./config.js";

export interface McpAppView {
	uri: string;
	name: string;
	description: string;
	mimeType: string;
	/** `_meta.ui` of the resource: CSP and border preference. */
	ui: {
		csp: { resourceDomains: string[]; connectDomains: string[] };
		prefersBorder: boolean;
	};
	html(): string;
}

export interface McpAppViews {
	all(): McpAppView[];
}

export function createMcpAppViews({
	config,
}: {
	config: Pick<Config, "MCP_VIEWS_DIR">;
}): McpAppViews {
	const views: McpAppView[] = [
		{
			uri: MAKET_PAGE_VIEW_URI,
			name: "maket_page",
			description:
				"The Maket reader, read-only: the pages that maket_preview show or snapshot open, loaded one by one.",
			mimeType: MCP_APP_MIME_TYPE,
			ui: {
				csp: {
					resourceDomains: [...MAKET_PAGE_VIEW_FONT_HOSTS],
					connectDomains: [],
				},
				prefersBorder: true,
			},
			html: () => readerViewHtml(config.MCP_VIEWS_DIR),
		},
	];
	return { all: () => views };
}
