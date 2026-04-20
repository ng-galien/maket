import { describe, expect, it, vi } from "vitest";
import { createBus } from "../services/bus.js";
import { createPending } from "../services/pending.js";
import { createMaketMessageTool, messagesPack } from "./messages.js";

function fixture() {
	const bus = createBus();
	const pending = createPending({ bus });
	return { bus, pending };
}

// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
const NO_EXTRA = {} as any;

describe("messagesPack — registration", () => {
	it("declares id and deps", () => {
		expect(messagesPack.id).toBe("messages");
		expect(messagesPack.requires).toEqual(["pending"]);
	});
});

describe("maket_message — action=list", () => {
	it("returns the empty sentinel when nothing is queued", async () => {
		const { pending } = fixture();
		const tool = createMaketMessageTool({ pending });
		const res = await tool.handler({ action: "list" }, NO_EXTRA);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		expect((res.content[0] as any).text).toMatch(/No pending messages/);
	});

	it("returns every pending message across both buckets in one call", async () => {
		const { pending } = fixture();
		pending.syncFromClient([
			{ id: "w1", type: "classify-images", text: "new uploads" },
			{ id: "d1", docName: "alpha", text: "fix this" },
			{ id: "d2", docName: "beta", type: "delete" },
		]);
		const tool = createMaketMessageTool({ pending });
		const res = await tool.handler({ action: "list" }, NO_EXTRA);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		const out = (res.content[0] as any).text as string;
		expect(out).toMatch(/w1/);
		expect(out).toMatch(/d1/);
		expect(out).toMatch(/d2/);
	});
});

describe("maket_message — action=ack", () => {
	it("removes doc-scoped pending and emits messages:acked", async () => {
		const { bus, pending } = fixture();
		pending.syncFromClient([
			{ id: "m1", docName: "d", text: "hi" },
			{ id: "m2", docName: "d", text: "ho" },
		]);

		const listener = vi.fn();
		bus.on("messages:acked", listener);

		const tool = createMaketMessageTool({ pending });
		const res = await tool.handler({ action: "ack", ids: ["m1"] }, NO_EXTRA);
		expect(res.isError).toBeUndefined();
		expect(listener).toHaveBeenCalledWith({ ids: ["m1"] });
		expect(pending.forDoc("d").map((m) => m.id)).toEqual(["m2"]);
	});

	it("acks across workspace and doc buckets in one call", async () => {
		const { bus, pending } = fixture();
		pending.syncFromClient([
			{ id: "d1", docName: "d", text: "doc msg" },
			{ id: "w1", type: "classify-images" },
		]);
		const listener = vi.fn();
		bus.on("messages:acked", listener);

		const tool = createMaketMessageTool({ pending });
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
	});

	it("errors when ids is missing", async () => {
		const { pending } = fixture();
		const tool = createMaketMessageTool({ pending });
		const res = await tool.handler({ action: "ack" }, NO_EXTRA);
		expect(res.isError).toBe(true);
	});

	it("reports no-match when every id is unknown", async () => {
		const { bus, pending } = fixture();
		pending.syncFromClient([{ id: "m1", docName: "d", text: "hi" }]);

		const listener = vi.fn();
		bus.on("messages:acked", listener);

		const tool = createMaketMessageTool({ pending });
		const res = await tool.handler({ action: "ack", ids: ["ghost"] }, NO_EXTRA);
		expect(res.isError).toBe(true);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		expect((res.content[0] as any).text).toMatch(/No matches/);
		expect(pending.forDoc("d").length).toBe(1);
		expect(listener).not.toHaveBeenCalled();
	});

	it("reports partial match with unknown ids flagged", async () => {
		const { bus, pending } = fixture();
		pending.syncFromClient([
			{ id: "m1", docName: "d", text: "hi" },
			{ id: "m2", docName: "d", text: "ho" },
		]);
		const listener = vi.fn();
		bus.on("messages:acked", listener);

		const tool = createMaketMessageTool({ pending });
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
	});
});
