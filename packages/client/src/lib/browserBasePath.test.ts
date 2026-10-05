import { afterEach, describe, expect, it } from "vitest";
import {
	browserPath,
	linkedDocumentId,
	prefixDocumentAssetUrls,
} from "./browserBasePath";

describe("gateway browser paths", () => {
	afterEach(() =>
		document.querySelector('meta[name="maket-base-path"]')?.remove(),
	);

	it("resolves the linked reader and its assets under the configured prefix", () => {
		document.head.insertAdjacentHTML(
			"beforeend",
			'<meta name="maket-base-path" content="/mobile/apps/maket" />',
		);
		expect(linkedDocumentId("/mobile/apps/maket/documents/doc-1/read")).toBe(
			"doc-1",
		);
		expect(browserPath("/api/assets")).toBe("/mobile/apps/maket/api/assets");
		expect(
			prefixDocumentAssetUrls(
				'<img src="/assets/preview/a.png"><style>.x{background:url(/assets/b.png)}</style>',
			),
		).toContain('src="/mobile/apps/maket/assets/preview/a.png"');
		expect(prefixDocumentAssetUrls("url(/assets/b.png)")).toBe(
			"url(/mobile/apps/maket/assets/b.png)",
		);
	});
});
