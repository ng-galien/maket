/**
 * McpAppViews — the MCP Apps views Maket serves as `ui://` resources, each
 * with its HTML and the content security policy its host must apply. The
 * MCP handler registers them on every server it builds; tools link to them
 * through `_meta.ui.resourceUri`.
 */

import {
	MAKET_PAGE_VIEW_FONT_HOSTS,
	MAKET_PAGE_VIEW_URI,
	MCP_APP_MIME_TYPE,
	maketPageViewHtml,
} from "../lib/maket-page-view.js";

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

export function createMcpAppViews(): McpAppViews {
	const views: McpAppView[] = [
		{
			uri: MAKET_PAGE_VIEW_URI,
			name: "maket_page",
			description:
				"A Maket page rendered read-only from the result of maket_preview snapshot.",
			mimeType: MCP_APP_MIME_TYPE,
			ui: {
				csp: {
					resourceDomains: [...MAKET_PAGE_VIEW_FONT_HOSTS],
					connectDomains: [],
				},
				prefersBorder: true,
			},
			html: maketPageViewHtml,
		},
	];
	return { all: () => views };
}
