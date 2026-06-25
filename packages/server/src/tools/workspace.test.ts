import { describe, expect, it, vi } from "vitest";
import { createBus } from "../services/bus.js";
import { createDocuments } from "../services/documents.js";
import { createPending } from "../services/pending.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketWorkspaceTool, workspacePack } from "./workspace.js";

function fixture() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const pending = createPending({ bus });
	return { store, bus, documents, pending };
}

const NO_EXTRA = {} as any;

function makeDoc(name: string, pageCount = 1) {
	const pages = Array.from({ length: pageCount }, (_, i) => ({
		name: `P${i + 1}`,
		elements: [],
		html: `<div data-id="e${i}">x</div>`,
	}));
	return createDocument({
		name,
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
		pages,
	});
}

describe("workspacePack — registration", () => {
	it("declares id and deps", () => {
		expect(workspacePack.id).toBe("workspace");
		expect(workspacePack.requires).toEqual(
			expect.arrayContaining(["documents", "bus", "pending"]),
		);
		expect(workspacePack.declaresTools).toEqual(["maket_workspace"]);
	});
});

describe("maket_workspace — action=focus", () => {
	it("sets the active page and emits document:focused", async () => {
		const { store, bus, documents, pending } = fixture();
		store.saveDoc(makeDoc("d", 3));
		documents.loadAll();
		const focused = vi.fn();
		bus.on("document:focused", focused);

		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const res = await tool.handler(
			{ action: "focus", doc: "d", page: 2 },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(documents.resolve("d")?.activePage).toBe(1);
		expect(focused).toHaveBeenCalledWith({ docName: "d" });
		store.close();
	});

	it("errors when the document is missing", async () => {
		const { store, bus, documents, pending } = fixture();
		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const res = await tool.handler(
			{ action: "focus", doc: "ghost", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when the page is out of range", async () => {
		const { store, bus, documents, pending } = fixture();
		store.saveDoc(makeDoc("d", 2));
		documents.loadAll();
		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const res = await tool.handler(
			{ action: "focus", doc: "d", page: 99 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("rejects non-integer page numbers at schema level", async () => {
		const { store, bus, documents, pending } = fixture();
		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		await expect(
			tool.handler({ action: "focus", doc: "d", page: 1.5 }, NO_EXTRA),
		).rejects.toThrow();
		store.close();
	});

	it("errors when required args are missing", async () => {
		const { store, bus, documents, pending } = fixture();
		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const res = await tool.handler({ action: "focus" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_workspace — action=state", () => {
	it("describes format, pages, charte", async () => {
		const { store, bus, documents, pending } = fixture();
		const d = makeDoc("d", 2);
		d.meta.charte = "brand";
		store.saveDoc(d);
		documents.loadAll();

		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const res = await tool.handler({ action: "state", doc: "d" }, NO_EXTRA);
		expect(res.isError).toBeUndefined();
		const txt = (res.content[0] as any).text as string;
		expect(txt).toMatch(/Document: "d"/);
		expect(txt).toMatch(/Charte: brand/);
		expect(txt).toMatch(/Pages \(2\)/);
		store.close();
	});

	it("errors when the document is missing", async () => {
		const { store, bus, documents, pending } = fixture();
		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const res = await tool.handler({ action: "state", doc: "ghost" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_workspace — action=lock", () => {
	it("toggles meta.locked and persists", async () => {
		const { store, bus, documents, pending } = fixture();
		store.saveDoc(makeDoc("doc"));
		documents.loadAll();
		const metaUpdated = vi.fn();
		bus.on("meta:updated", metaUpdated);

		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const lockRes = await tool.handler(
			{ action: "lock", doc: "doc", locked: true },
			NO_EXTRA,
		);
		expect(lockRes.isError).toBeUndefined();
		expect(documents.resolve("doc")?.meta.locked).toBe(true);
		expect(store.loadOne("doc")?.meta.locked).toBe(true);
		expect(metaUpdated).toHaveBeenCalledWith({ docName: "doc" });

		const unlockRes = await tool.handler(
			{ action: "lock", doc: "doc", locked: false },
			NO_EXTRA,
		);
		expect(unlockRes.isError).toBeUndefined();
		expect(documents.resolve("doc")?.meta.locked).toBe(false);
		store.close();
	});

	it("toggles when locked is omitted", async () => {
		const { store, bus, documents, pending } = fixture();
		store.saveDoc(makeDoc("doc"));
		documents.loadAll();
		const tool = createMaketWorkspaceTool({ bus, documents, pending });

		await tool.handler({ action: "lock", doc: "doc" }, NO_EXTRA);
		expect(documents.resolve("doc")?.meta.locked).toBe(true);
		await tool.handler({ action: "lock", doc: "doc" }, NO_EXTRA);
		expect(documents.resolve("doc")?.meta.locked).toBe(false);
		store.close();
	});

	it("errors when the document is missing", async () => {
		const { store, bus, documents, pending } = fixture();
		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const res = await tool.handler(
			{ action: "lock", doc: "ghost", locked: true },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_workspace — action=list_messages", () => {
	it("returns the empty sentinel when nothing is queued", async () => {
		const { store, bus, documents, pending } = fixture();
		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const res = await tool.handler({ action: "list_messages" }, NO_EXTRA);
		expect((res.content[0] as any).text).toMatch(/No pending messages/);
		store.close();
	});

	it("does not require a document scope", async () => {
		const { store, bus, documents, pending } = fixture();
		pending.syncFromClient([{ id: "d1", docName: "alpha", text: "fix this" }]);
		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const res = await tool.handler({ action: "list_messages" }, NO_EXTRA);
		expect(res.isError).toBeUndefined();
		expect((res.content[0] as any).text).toMatch(/alpha/);
		store.close();
	});

	it("returns every pending message across both buckets in one call", async () => {
		const { store, bus, documents, pending } = fixture();
		pending.syncFromClient([
			{ id: "w1", type: "classify-images", text: "new uploads" },
			{ id: "d1", docName: "alpha", text: "fix this" },
			{ id: "d2", docName: "beta", type: "delete" },
		]);
		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const res = await tool.handler({ action: "list_messages" }, NO_EXTRA);
		const out = (res.content[0] as any).text as string;
		expect(out).toMatch(/w1/);
		expect(out).toMatch(/d1/);
		expect(out).toMatch(/d2/);
		store.close();
	});
});

describe("maket_workspace — action=ack_messages", () => {
	it("removes doc-scoped pending and emits messages:acked", async () => {
		const { store, bus, documents, pending } = fixture();
		pending.syncFromClient([
			{ id: "m1", docName: "d", text: "hi" },
			{ id: "m2", docName: "d", text: "ho" },
		]);

		const listener = vi.fn();
		bus.on("messages:acked", listener);

		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const res = await tool.handler(
			{ action: "ack_messages", ids: ["m1"] },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(listener).toHaveBeenCalledWith({ ids: ["m1"] });
		expect(pending.forDoc("d").map((m) => m.id)).toEqual(["m2"]);
		store.close();
	});

	it("acks across workspace and doc buckets in one call", async () => {
		const { store, bus, documents, pending } = fixture();
		pending.syncFromClient([
			{ id: "d1", docName: "d", text: "doc msg" },
			{ id: "w1", type: "classify-images" },
		]);
		const listener = vi.fn();
		bus.on("messages:acked", listener);

		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const res = await tool.handler(
			{ action: "ack_messages", ids: ["d1", "w1"] },
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
		const { store, bus, documents, pending } = fixture();
		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const res = await tool.handler({ action: "ack_messages" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("reports no-match when every id is unknown", async () => {
		const { store, bus, documents, pending } = fixture();
		pending.syncFromClient([{ id: "m1", docName: "d", text: "hi" }]);

		const listener = vi.fn();
		bus.on("messages:acked", listener);

		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const res = await tool.handler(
			{ action: "ack_messages", ids: ["ghost"] },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(/No matches/);
		expect(pending.forDoc("d").length).toBe(1);
		expect(listener).not.toHaveBeenCalled();
		store.close();
	});

	it("reports partial match with unknown ids flagged", async () => {
		const { store, bus, documents, pending } = fixture();
		pending.syncFromClient([
			{ id: "m1", docName: "d", text: "hi" },
			{ id: "m2", docName: "d", text: "ho" },
		]);
		const listener = vi.fn();
		bus.on("messages:acked", listener);

		const tool = createMaketWorkspaceTool({ bus, documents, pending });
		const res = await tool.handler(
			{ action: "ack_messages", ids: ["m1", "ghost"] },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		const out = (res.content[0] as any).text as string;
		expect(out).toMatch(/Acknowledged 1 of 2/);
		expect(out).toMatch(/unknown id\(s\) ignored: ghost/);
		expect(listener).toHaveBeenCalledWith({ ids: ["m1"] });
		expect(pending.forDoc("d").length).toBe(1);
		store.close();
	});
});
