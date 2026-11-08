import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rewriteAssetRefs } from "./bundle";

const url = fc.oneof(
	fc.uuid().map((id) => `blob:https://maket.invalid/${id}`),
	fc
		.uint8Array({ minLength: 1, maxLength: 32 })
		.map(
			(bytes) => `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`,
		),
);

describe("viewer asset URLs", () => {
	it("preserves HTML structure and CSS images across attribute and URL delimiters", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 24 }),
				url,
				fc.constantFrom(
					{ attribute: '"', css: "'" },
					{ attribute: "'", css: '"' },
					{ attribute: '"', css: "" },
					{ attribute: "'", css: "" },
				),
				fc.constantFrom("", "thumb/", "preview/", "print/"),
				(file, image, quote, variant) => {
					const encoded = encodeURIComponent(file)
						.replaceAll("'", "%27")
						.replace(/[()]/g, (char) =>
							quote.css ? char : char === "(" ? "%28" : "%29",
						);
					const html = `<figure data-id="photo" aria-label="Photo" style=${quote.attribute}background-image:url(${quote.css}/assets/${variant}${encoded}${quote.css});width:120px${quote.attribute}><figcaption>Caption</figcaption></figure>`;
					const assets = new Map([[file, image]]);
					const rewritten = rewriteAssetRefs(html, assets);
					const root = document.createElement("div");
					root.innerHTML = rewritten;
					const figure = root.querySelector("figure");
					expect(figure?.getAttributeNames().sort()).toEqual([
						"aria-label",
						"data-id",
						"style",
					]);
					expect(figure?.style.backgroundImage).toContain(image);
					expect(figure?.style.width).toBe("120px");
					expect(root.querySelectorAll("*")).toHaveLength(2);
					expect(root.textContent).toBe("Caption");
					expect(rewriteAssetRefs(rewritten, assets)).toBe(rewritten);
				},
			),
			{ numRuns: 200 },
		);
	});
});
