import { describe, expect, it, vi } from "vitest";
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

	it("separates workspace requests and treats an empty acknowledgement as a no-op", () => {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const annotations = createAnnotations({ bus, store });
		annotations.create({ id: "workspace-note", type: "classify-images" });
		const acknowledged: unknown[] = [];
		bus.on("messages:acked", (event) => acknowledged.push(event));

		expect(annotations.forWorkspace()).toEqual([
			expect.objectContaining({
				id: "workspace-note",
				type: "classify-images",
			}),
		]);
		expect(annotations.ack([])).toEqual({ matched: [], unknown: [] });
		expect(acknowledged).toEqual([]);
		store.close();
	});

	it("edits a pending note, marks it edited, and refuses an edit once acknowledged", () => {
		vi.useFakeTimers();
		vi.setSystemTime(5_000);
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const annotations = createAnnotations({ bus, store });
		const changes: unknown[] = [];
		bus.on("annotations:changed", (event) => changes.push(event));
		annotations.create({
			id: "note-1",
			type: "note",
			text: "Make it larger",
			ts: 42,
			edited: true,
			editedAt: 1,
		});
		expect(annotations.all()[0]).not.toHaveProperty("edited");

		expect(annotations.edit("note-1", "  Make it smaller  ")).toMatchObject({
			text: "Make it smaller",
			edited: true,
			editedAt: 5_000,
		});
		expect(createAnnotations({ bus, store }).all()).toEqual([
			{
				id: "note-1",
				type: "note",
				text: "Make it smaller",
				ts: 42,
				edited: true,
				editedAt: 5_000,
			},
		]);
		expect(changes).toHaveLength(2);

		expect(() => annotations.edit("note-1", "   ")).toThrow(
			expect.objectContaining({
				localized: { key: "msg_annotation_text_required" },
			}),
		);
		expect(annotations.ack(["note-1"])).toEqual({
			matched: ["note-1"],
			unknown: [],
		});
		expect(annotations.all()).toEqual([]);
		expect(() => annotations.edit("note-1", "Too late")).toThrow(
			expect.objectContaining({
				localized: { key: "msg_annotation_not_found" },
			}),
		);
		vi.useRealTimers();
		store.close();
	});

	it("deletes a note through acknowledgement and keeps requests without text read-only", () => {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const annotations = createAnnotations({ bus, store });
		annotations.create({ id: "note-2", type: "note", text: "Drop me" });
		annotations.create({ id: "request", type: "classify-images", text: "x" });

		expect(() => annotations.edit("request", "Other")).toThrow(
			expect.objectContaining({
				localized: { key: "msg_annotation_not_editable" },
			}),
		);
		annotations.ack(["note-2"]);
		expect(annotations.all().map((message) => message.id)).toEqual(["request"]);
		store.close();
	});
});
