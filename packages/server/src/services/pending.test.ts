import { describe, expect, it, vi } from "vitest";
import type { PendingMessage } from "../types.js";
import { createBus } from "./bus.js";
import { createPending } from "./pending.js";

function fixture() {
	const bus = createBus();
	const pending = createPending({ bus });
	return { bus, pending };
}

function msg(overrides: Partial<PendingMessage>): PendingMessage {
	return { id: overrides.id ?? "m", ...overrides };
}

describe("pending — syncFromClient", () => {
	it("buckets per-doc messages by docName", () => {
		const { pending } = fixture();
		pending.syncFromClient([
			msg({ id: "a1", docName: "doc-a" }),
			msg({ id: "a2", docName: "doc-a" }),
			msg({ id: "b1", docName: "doc-b" }),
		]);
		expect(pending.forDoc("doc-a").map((m) => m.id)).toEqual(["a1", "a2"]);
		expect(pending.forDoc("doc-b").map((m) => m.id)).toEqual(["b1"]);
		expect(pending.forDoc("doc-ghost")).toEqual([]);
	});

	it("routes docName-less messages into the workspace bucket", () => {
		const { pending } = fixture();
		pending.syncFromClient([
			msg({ id: "w1", type: "classify-images" }),
			msg({ id: "d1", docName: "doc-a" }),
		]);
		expect(pending.forWorkspace().map((m) => m.id)).toEqual(["w1"]);
		expect(pending.forDoc("doc-a").map((m) => m.id)).toEqual(["d1"]);
	});

	it("replaces the entire queue — stale entries are dropped", () => {
		const { pending } = fixture();
		pending.syncFromClient([
			msg({ id: "old1", docName: "doc-a" }),
			msg({ id: "oldW", type: "classify-images" }),
		]);
		pending.syncFromClient([msg({ id: "new1", docName: "doc-a" })]);
		expect(pending.forDoc("doc-a").map((m) => m.id)).toEqual(["new1"]);
		expect(pending.forWorkspace()).toEqual([]);
	});

	it("empty snapshot clears every bucket", () => {
		const { pending } = fixture();
		pending.syncFromClient([
			msg({ id: "a1", docName: "doc-a" }),
			msg({ id: "w1" }),
		]);
		pending.syncFromClient([]);
		expect(pending.forDoc("doc-a")).toEqual([]);
		expect(pending.forWorkspace()).toEqual([]);
	});
});

describe("pending — ack", () => {
	it("removes matching ids from either bucket and returns unknowns", () => {
		const { bus, pending } = fixture();
		pending.syncFromClient([
			msg({ id: "a1", docName: "doc-a" }),
			msg({ id: "a2", docName: "doc-a" }),
			msg({ id: "w1" }),
		]);

		const acked = vi.fn();
		bus.on("messages:acked", acked);

		const res = pending.ack(["a1", "w1", "ghost"]);
		expect(res.matched.sort()).toEqual(["a1", "w1"]);
		expect(res.unknown).toEqual(["ghost"]);
		expect(pending.forDoc("doc-a").map((m) => m.id)).toEqual(["a2"]);
		expect(pending.forWorkspace()).toEqual([]);
		expect(acked).toHaveBeenCalledWith({
			ids: expect.arrayContaining(["a1", "w1"]),
		});
	});

	it("is a no-op when nothing matches and does not emit", () => {
		const { bus, pending } = fixture();
		pending.syncFromClient([msg({ id: "a1", docName: "doc-a" })]);
		const acked = vi.fn();
		bus.on("messages:acked", acked);
		const res = pending.ack(["nope"]);
		expect(res.matched).toEqual([]);
		expect(res.unknown).toEqual(["nope"]);
		expect(acked).not.toHaveBeenCalled();
	});

	it("empty id list is a no-op", () => {
		const { bus, pending } = fixture();
		const acked = vi.fn();
		bus.on("messages:acked", acked);
		const res = pending.ack([]);
		expect(res).toEqual({ matched: [], unknown: [] });
		expect(acked).not.toHaveBeenCalled();
	});
});

describe("pending — dropDoc", () => {
	it("clears a single doc's bucket without touching others or workspace", () => {
		const { pending } = fixture();
		pending.syncFromClient([
			msg({ id: "a1", docName: "doc-a" }),
			msg({ id: "b1", docName: "doc-b" }),
			msg({ id: "w1" }),
		]);
		pending.dropDoc("doc-a");
		expect(pending.forDoc("doc-a")).toEqual([]);
		expect(pending.forDoc("doc-b").map((m) => m.id)).toEqual(["b1"]);
		expect(pending.forWorkspace().map((m) => m.id)).toEqual(["w1"]);
	});
});
