import { describe, expect, it, vi } from "vitest";
import { createDocument } from "../types.js";
import { createCollectionRenderer } from "./collection-renderer.js";

const schema = {
	type: "object",
	properties: { title: { type: "string" } },
	required: ["title"],
	additionalProperties: false,
};

describe("CollectionRenderer", () => {
	it("renders referenced collection rows without delegating rendering to Collections", () => {
		const doc = createDocument({
			name: "letters",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					name: "Letter",
					elements: [],
					html: "<h1>{{ title }}</h1>",
					collection: { name: "recipients" },
				},
			],
		});
		const referencedBy = vi.fn(() => [
			{
				name: "recipients",
				schema,
				members: [
					{ id: "ada", position: 0, data: { title: "Ada" } },
					{ id: "grace", position: 1, data: { title: "Grace" } },
				],
			},
		]);

		const rendered = createCollectionRenderer({
			collections: { referencedBy },
		}).render(doc);

		expect(referencedBy).toHaveBeenCalledWith([doc]);
		expect(rendered.pages.map((page) => page.html)).toEqual([
			"<h1>Ada</h1>",
			"<h1>Grace</h1>",
		]);
	});
});
