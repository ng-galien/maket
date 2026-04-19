import { describe, expect, it, vi } from "vitest";
import { createBus } from "../services/bus.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketMessageTool, messagesPack } from "./messages.js";

function fixture() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	return { store, bus, documents };
}

// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
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

describe("messagesPack — registration", () => {
	it("declares id and deps", () => {
		expect(messagesPack.id).toBe("messages");
		expect(messagesPack.requires).toEqual(
			expect.arrayContaining(["documents", "bus"]),
		);
	});
});

describe("maket_message — action=list", () => {
	it("returns 'No pending messages' when empty", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		const tool = createMaketMessageTool({ documents, bus });
		const res = await tool.handler({ action: "list", doc: "d" }, NO_EXTRA);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		expect((res.content[0] as any).text).toMatch(/No pending messages/);
		store.close();
	});

	it("errors when the document is missing", async () => {
		const { store, bus, documents } = fixture();
		const tool = createMaketMessageTool({ documents, bus });
		const res = await tool.handler({ action: "list", doc: "ghost" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_message — action=ack", () => {
	it("removes pending messages and emits messages:acked", async () => {
		const { store, bus, documents } = fixture();
		const d = makeDoc("d");
		d._pending = [
			{ id: "m1", text: "hi" },
			{ id: "m2", text: "ho" },
		];
		store.saveDoc(d);
		documents.loadAll();
		const cached = documents.resolve("d");
		if (cached) cached._pending = d._pending;

		const listener = vi.fn();
		bus.on("messages:acked", listener);

		const tool = createMaketMessageTool({ documents, bus });
		const res = await tool.handler(
			{ action: "ack", doc: "d", ids: ["m1"] },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(listener).toHaveBeenCalledWith({ ids: ["m1"] });
		expect(documents.resolve("d")?._pending?.length).toBe(1);
		store.close();
	});

	it("errors when ids is missing", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		const tool = createMaketMessageTool({ documents, bus });
		const res = await tool.handler({ action: "ack", doc: "d" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("reports no-match when every id is unknown", async () => {
		const { store, bus, documents } = fixture();
		const d = makeDoc("d");
		d._pending = [{ id: "m1", text: "hi" }];
		store.saveDoc(d);
		documents.loadAll();
		const cached = documents.resolve("d");
		if (cached) cached._pending = d._pending;

		const listener = vi.fn();
		bus.on("messages:acked", listener);

		const tool = createMaketMessageTool({ documents, bus });
		const res = await tool.handler(
			{ action: "ack", doc: "d", ids: ["ghost"] },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		expect((res.content[0] as any).text).toMatch(/No matches/);
		// No pending messages consumed; listener not invoked
		expect(documents.resolve("d")?._pending?.length).toBe(1);
		expect(listener).not.toHaveBeenCalled();
		store.close();
	});

	it("reports partial match with unknown ids flagged", async () => {
		const { store, bus, documents } = fixture();
		const d = makeDoc("d");
		d._pending = [
			{ id: "m1", text: "hi" },
			{ id: "m2", text: "ho" },
		];
		store.saveDoc(d);
		documents.loadAll();
		const cached = documents.resolve("d");
		if (cached) cached._pending = d._pending;

		const listener = vi.fn();
		bus.on("messages:acked", listener);

		const tool = createMaketMessageTool({ documents, bus });
		const res = await tool.handler(
			{ action: "ack", doc: "d", ids: ["m1", "ghost"] },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		const out = (res.content[0] as any).text as string;
		expect(out).toMatch(/Acknowledged 1 of 2/);
		expect(out).toMatch(/unknown id\(s\) ignored: ghost/);
		expect(listener).toHaveBeenCalledWith({ ids: ["m1"] });
		expect(documents.resolve("d")?._pending?.length).toBe(1);
		store.close();
	});
});
