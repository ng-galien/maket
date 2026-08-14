import { describe, expect, it, vi } from "vitest";
import { createBus } from "../services/bus.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { canvasPack, createMaketCanvasTool } from "./canvas.js";

function fixture() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	return { store, bus, documents };
}

const NO_EXTRA = {} as any;

function makeDoc(name: string) {
	return createDocument({
		name,
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
	});
}

describe("canvasPack — registration", () => {
	it("declares id and deps", () => {
		expect(canvasPack.id).toBe("canvas");
		expect(canvasPack.requires).toEqual(
			expect.arrayContaining(["documents", "bus"]),
		);
	});
});

describe("maket_canvas (setup)", () => {
	it("updates canvas format/orientation and emits canvas:changed", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();

		const listener = vi.fn();
		bus.on("canvas:changed", listener);

		const tool = createMaketCanvasTool({ documents, bus });
		const res = await tool.handler(
			{ doc: "d", format: "A3", orientation: "landscape" },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		const d = documents.resolve("d");
		expect(d?.canvas.format).toBe("A3");
		expect(d?.canvas.orientation).toBe("landscape");
		expect(d?.canvas.w).toBe(420);
		expect(d?.canvas.h).toBe(297);
		const persisted = store.loadOne("d");
		expect(persisted?.canvas).toMatchObject({
			format: "A3",
			orientation: "landscape",
			w: 420,
			h: 297,
		});
		expect(listener).toHaveBeenCalledWith({ docName: "d" });
		store.close();
	});

	it("restores memory and storage without emitting when persistence fails", async () => {
		const { store, bus, documents } = fixture();
		const doc = makeDoc("stateful");
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html = '<p data-id="title">{{ state.title }}</p>';
		store.saveDoc(doc);
		store.initializeDocumentState(
			doc.id,
			{
				type: "object",
				properties: { title: { type: "string" } },
				required: ["title"],
			},
			{ title: "Safe" },
		);
		documents.loadAll();
		const cached = documents.resolve(doc.name);
		if (!cached?.pages[0]) throw new Error("Fixture page missing.");
		cached.pages[0].html = '<p data-id="bad">{{ page.number }}</p>';

		const listener = vi.fn();
		bus.on("canvas:changed", listener);
		const tool = createMaketCanvasTool({ documents, bus });

		await expect(
			tool.handler(
				{ doc: doc.name, format: "A3", orientation: "landscape" },
				NO_EXTRA,
			),
		).rejects.toThrow(/state namespace/);
		expect(documents.resolve(doc.name)?.canvas).toMatchObject({
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
		});
		expect(store.loadOne(doc.name)?.canvas).toMatchObject({
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
		});
		expect(listener).not.toHaveBeenCalled();
		store.close();
	});

	it("errors when document missing", async () => {
		const { store, bus, documents } = fixture();
		const tool = createMaketCanvasTool({ documents, bus });
		const res = await tool.handler({ doc: "ghost", format: "A4" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});
});
