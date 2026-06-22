import type { Collection } from "@maket/shared";
import { describe, expect, it } from "vitest";
import { createDocument } from "../types.js";
import { renderCollectionDocument } from "./collection-render.js";

const clients: Collection = {
	name: "clients",
	schema: {
		type: "object",
		properties: { client_name: { type: "string" } },
		required: ["client_name"],
		additionalProperties: false,
	},
	members: [
		{ id: "client_1", position: 1, data: { client_name: "Beta" } },
		{ id: "client_0", position: 0, data: { client_name: "Acme" } },
	],
};

const offers: Collection = {
	name: "offers",
	schema: {
		type: "object",
		properties: { offer_name: { type: "string" } },
		required: ["offer_name"],
		additionalProperties: false,
	},
	members: [{ id: "offer_0", position: 0, data: { offer_name: "Audit" } }],
};

describe("renderCollectionDocument", () => {
	it("expands each linked page for every collection member", () => {
		const doc = createDocument({
			name: "poster",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					id: "cover",
					name: "Cover",
					elements: [],
					html: "<p>Cover {{ page.number }}/{{ page.total }}</p>",
				},
				{
					id: "client",
					name: "Client",
					elements: [],
					collection: { name: "clients" },
					html: "<h1>{{ client_name }}</h1><p>{{ member.number }}/{{ member.total }} {{ page.number }}/{{ page.total }}</p>",
				},
				{
					id: "offer",
					name: "Offer",
					elements: [],
					collection: { name: "offers" },
					html: "<h2>{{ offer_name }}</h2><p>{{ member.number }}/{{ member.total }} {{ page.number }}/{{ page.total }}</p>",
				},
			],
		});

		const rendered = renderCollectionDocument(
			doc,
			new Map([
				["clients", clients],
				["offers", offers],
			]),
		);

		expect(rendered.pages.map((page) => page.html)).toEqual([
			"<p>Cover {{ page.number }}/{{ page.total }}</p>",
			"<h1>Acme</h1><p>1/2 2/4</p>",
			"<h1>Beta</h1><p>2/2 3/4</p>",
			"<h2>Audit</h2><p>1/1 4/4</p>",
		]);
	});

	it("fails when a linked collection is missing", () => {
		const doc = createDocument({
			name: "poster",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					id: "client",
					name: "Client",
					elements: [],
					collection: { name: "clients" },
					html: "<h1>{{ client_name }}</h1>",
				},
			],
		});

		expect(() => renderCollectionDocument(doc, new Map())).toThrow(
			'Collection "clients" not found.',
		);
	});
});
