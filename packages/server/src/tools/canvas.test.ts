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
		expect(listener).toHaveBeenCalledWith({ docName: "d" });
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
