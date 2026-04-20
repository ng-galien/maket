import { describe, expect, it, vi } from "vitest";
import { createBus } from "../services/bus.js";
import { createDocuments } from "../services/documents.js";
import { createPending } from "../services/pending.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketMessageTool, messagesPack } from "./messages.js";

function fixture() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const pending = createPending({ bus });
	return { store, bus, documents, pending };
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
			expect.arrayContaining(["documents", "pending"]),
		);
	});
});

describe("maket_message — action=list", () => {
	it("returns 'No pending messages' when the doc's bucket is empty", async () => {
		const { store, documents, pending } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		const tool = createMaketMessageTool({ documents, pending });
		const res = await tool.handler({ action: "list", doc: "d" }, NO_EXTRA);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		expect((res.content[0] as any).text).toMatch(/No pending messages/);
		store.close();
	});

	it("errors when the document is missing", async () => {
		const { store, documents, pending } = fixture();
		const tool = createMaketMessageTool({ documents, pending });
		const res = await tool.handler({ action: "list", doc: "ghost" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("returns pending messages for a known doc", async () => {
		const { store, documents, pending } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		pending.syncFromClient([
			{ id: "m1", docName: "d", text: "fix this" },
			{ id: "m2", docName: "d", type: "delete" },
		]);
		const tool = createMaketMessageTool({ documents, pending });
		const res = await tool.handler({ action: "list", doc: "d" }, NO_EXTRA);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		const out = (res.content[0] as any).text as string;
		expect(out).toMatch(/m1/);
		expect(out).toMatch(/m2/);
		store.close();
	});

	it("returns workspace messages when doc is omitted", async () => {
		const { store, documents, pending } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		pending.syncFromClient([
			{ id: "w1", type: "classify-images", text: "new uploads" },
			{ id: "d1", docName: "d", text: "fix" },
		]);
		const tool = createMaketMessageTool({ documents, pending });
		const res = await tool.handler({ action: "list" }, NO_EXTRA);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		const out = (res.content[0] as any).text as string;
		expect(out).toMatch(/w1/);
		// doc messages must NOT leak into workspace view
		expect(out).not.toMatch(/d1/);
		store.close();
	});

	it("returns the empty-workspace sentinel when nothing is queued", async () => {
		const { store, documents, pending } = fixture();
		const tool = createMaketMessageTool({ documents, pending });
		const res = await tool.handler({ action: "list" }, NO_EXTRA);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		expect((res.content[0] as any).text).toMatch(/No pending workspace/);
		store.close();
	});
});

describe("maket_message — action=ack", () => {
	it("removes doc-scoped pending and emits messages:acked", async () => {
		const { store, bus, documents, pending } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		pending.syncFromClient([
			{ id: "m1", docName: "d", text: "hi" },
			{ id: "m2", docName: "d", text: "ho" },
		]);

		const listener = vi.fn();
		bus.on("messages:acked", listener);

		const tool = createMaketMessageTool({ documents, pending });
		const res = await tool.handler({ action: "ack", ids: ["m1"] }, NO_EXTRA);
		expect(res.isError).toBeUndefined();
		expect(listener).toHaveBeenCalledWith({ ids: ["m1"] });
		expect(pending.forDoc("d").map((m) => m.id)).toEqual(["m2"]);
		store.close();
	});

	it("acks across workspace and doc buckets in one call", async () => {
		const { store, bus, documents, pending } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		pending.syncFromClient([
			{ id: "d1", docName: "d", text: "doc msg" },
			{ id: "w1", type: "classify-images" },
		]);
		const listener = vi.fn();
		bus.on("messages:acked", listener);

		const tool = createMaketMessageTool({ documents, pending });
		const res = await tool.handler(
			{ action: "ack", ids: ["d1", "w1"] },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(pending.forDoc("d")).toEqual([]);
		expect(pending.forWorkspace()).toEqual([]);
		expect(listener).toHaveBeenCalledWith({
			ids: expect.arrayContaining(["d1", "w1"]),
		});
		store.close();
	});

	it("errors when ids is missing", async () => {
		const { store, documents, pending } = fixture();
		const tool = createMaketMessageTool({ documents, pending });
		const res = await tool.handler({ action: "ack" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("reports no-match when every id is unknown", async () => {
		const { store, bus, documents, pending } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		pending.syncFromClient([{ id: "m1", docName: "d", text: "hi" }]);

		const listener = vi.fn();
		bus.on("messages:acked", listener);

		const tool = createMaketMessageTool({ documents, pending });
		const res = await tool.handler({ action: "ack", ids: ["ghost"] }, NO_EXTRA);
		expect(res.isError).toBe(true);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		expect((res.content[0] as any).text).toMatch(/No matches/);
		expect(pending.forDoc("d").length).toBe(1);
		expect(listener).not.toHaveBeenCalled();
		store.close();
	});

	it("reports partial match with unknown ids flagged", async () => {
		const { store, bus, documents, pending } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		pending.syncFromClient([
			{ id: "m1", docName: "d", text: "hi" },
			{ id: "m2", docName: "d", text: "ho" },
		]);
		const listener = vi.fn();
		bus.on("messages:acked", listener);

		const tool = createMaketMessageTool({ documents, pending });
		const res = await tool.handler(
			{ action: "ack", ids: ["m1", "ghost"] },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		const out = (res.content[0] as any).text as string;
		expect(out).toMatch(/Acknowledged 1 of 2/);
		expect(out).toMatch(/unknown id\(s\) ignored: ghost/);
		expect(listener).toHaveBeenCalledWith({ ids: ["m1"] });
		expect(pending.forDoc("d").length).toBe(1);
		store.close();
	});
});
