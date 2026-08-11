import { describe, expect, it } from "vitest";
import { createDocument } from "../types.js";
import { createAnnotations } from "./annotations.js";
import { createBus } from "./bus.js";
import { createSQLiteStore } from "./store.js";

describe("annotations persistence boundary", () => {
	it("survives service recreation and preserves document scope", () => {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		store.saveDoc(
			createDocument({
				name: "poster",
				canvas: {
					format: "A4",
					orientation: "portrait",
					w: 210,
					h: 297,
					bg: "#fff",
				},
			}),
		);

		createAnnotations({ bus, store }).create({
			id: "note-1",
			docName: "poster",
			pageIndex: 0,
			elementId: "title",
			type: "note",
			text: "Make it larger",
			ts: 42,
		});

		const reloaded = createAnnotations({ bus, store });
		expect(reloaded.forDoc("poster")).toEqual([
			{
				id: "note-1",
				docName: "poster",
				pageIndex: 0,
				elementId: "title",
				type: "note",
				text: "Make it larger",
				ts: 42,
			},
		]);
		store.close();
	});

	it("cascades document deletion without touching workspace annotations", () => {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const doc = createDocument({
			name: "poster",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
		});
		store.saveDoc(doc);
		const annotations = createAnnotations({ bus, store });
		annotations.create({ id: "doc-note", docName: "poster", type: "note" });
		annotations.create({ id: "workspace-note", type: "classify-images" });

		store.deleteDoc("poster");

		expect(annotations.all().map((message) => message.id)).toEqual([
			"workspace-note",
		]);
		store.close();
	});
});
