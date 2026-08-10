import { describe, expect, it } from "vitest";
import { viewerOptions } from "./ViewerApp";

describe("viewerOptions", () => {
	it("recognises the iframe reader contract", () => {
		expect(
			viewerOptions(
				"?src=%2Fdocuments%2Farticle.maket&doc=article%20principal&embed=1",
			),
		).toEqual({
			src: "/documents/article.maket",
			doc: "article principal",
			embedded: true,
		});
	});

	it("keeps the regular standalone reader when embed is absent", () => {
		expect(viewerOptions("?src=/article.maket")).toEqual({
			src: "/article.maket",
			doc: null,
			embedded: false,
		});
	});
});
