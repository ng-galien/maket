import { describe, expect, it, vi } from "vitest";
import { createBus } from "./bus.js";

describe("bus", () => {
	it("delivers emitted events to subscribers", () => {
		const bus = createBus();
		const listener = vi.fn();
		bus.on("document:created", listener);
		bus.emit("document:created", { docName: "foo" });
		expect(listener).toHaveBeenCalledWith({ docName: "foo" });
	});

	it("broadcasts to multiple listeners", () => {
		const bus = createBus();
		const a = vi.fn();
		const b = vi.fn();
		bus.on("meta:updated", a);
		bus.on("meta:updated", b);
		bus.emit("meta:updated", { docName: "x" });
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);
	});

	it("stops delivering once off() is called", () => {
		const bus = createBus();
		const listener = vi.fn();
		bus.on("document:deleted", listener);
		bus.off("document:deleted", listener);
		bus.emit("document:deleted", { docName: "foo" });
		expect(listener).not.toHaveBeenCalled();
	});

	it("instances are isolated (no shared global state)", () => {
		const a = createBus();
		const b = createBus();
		const listener = vi.fn();
		a.on("canvas:changed", listener);
		b.emit("canvas:changed", { docName: "foo" });
		expect(listener).not.toHaveBeenCalled();
	});

	it("exposes typed events (compile-time check via usage)", () => {
		const bus = createBus();
		// These compile because the payload shape matches BusEvents
		bus.emit("toast", {
			key: "toast_charte_saved",
			params: { name: "brand" },
			level: "info",
		});
		bus.emit("element:updated", { docName: "d", id: "el-1" });
		bus.emit("assets:changed", {});
		// No assertion needed — if this compiles, the typing is correct.
		expect(true).toBe(true);
	});
});
