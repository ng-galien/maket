import { describe, expect, it, vi } from "vitest";
import { createBus } from "./bus.js";
import { createWsBridge } from "./ws-bridge.js";

describe("ws-bridge", () => {
	it("emits a client-request with _reqId and resolves on matching reply", async () => {
		const bus = createBus();
		const emitted: unknown[] = [];
		bus.on("workspace:client-request", (msg) => emitted.push(msg));
		const bridge = createWsBridge({ bus });

		const p = bridge.sendRequest(
			{ type: "check_layout_request", docName: "poster", pageIdx: 0 },
			1000,
		);
		const msg = emitted[0] as {
			type: string;
			docName: string;
			pageIdx: number;
			_reqId: string;
		};
		expect(msg.type).toBe("check_layout_request");
		expect(msg.docName).toBe("poster");
		expect(msg.pageIdx).toBe(0);
		expect(typeof msg._reqId).toBe("string");

		bridge.resolveResponse(msg._reqId, { ok: true });
		await expect(p).resolves.toEqual({ ok: true });
	});

	it("resolves null on timeout", async () => {
		vi.useFakeTimers();
		const bus = createBus();
		const bridge = createWsBridge({ bus });

		const p = bridge.sendRequest(
			{ type: "check_layout_request", docName: "poster", pageIdx: 0 },
			50,
		);
		vi.advanceTimersByTime(51);
		await expect(p).resolves.toBeNull();
		vi.useRealTimers();
	});

	it("waitForResponse resolves by externally-chosen id", async () => {
		const bus = createBus();
		const bridge = createWsBridge({ bus });

		const p = bridge.waitForResponse("measure-1", 1000);
		bridge.resolveResponse("measure-1", { overflow: false });
		await expect(p).resolves.toEqual({ overflow: false });
	});

	it("ignores replies with an unknown id", () => {
		const bus = createBus();
		const bridge = createWsBridge({ bus });
		// Should not throw
		bridge.resolveResponse("ghost", { x: 1 });
	});
});
