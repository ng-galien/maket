import { describe, expect, it, vi } from "vitest";
import { createWsBridge } from "./ws-bridge.js";
import { createWsRegistry, type WsLike } from "./ws-registry.js";

function openClient(): WsLike & { sent: string[] } {
	const sent: string[] = [];
	return {
		readyState: 1,
		send(msg) {
			sent.push(msg);
		},
		sent,
	};
}

describe("ws-bridge", () => {
	it("broadcasts a request with _reqId and resolves on matching reply", async () => {
		const wsRegistry = createWsRegistry();
		const client = openClient();
		wsRegistry.add(client);
		const bridge = createWsBridge({ wsRegistry });

		const p = bridge.sendRequest("ping", { k: 1 }, 1000);
		const msg = JSON.parse(client.sent[0] ?? "{}");
		expect(msg.type).toBe("ping");
		expect(msg.k).toBe(1);
		expect(typeof msg._reqId).toBe("string");

		bridge.resolveResponse(msg._reqId, { ok: true });
		await expect(p).resolves.toEqual({ ok: true });
	});

	it("resolves null on timeout", async () => {
		vi.useFakeTimers();
		const wsRegistry = createWsRegistry();
		wsRegistry.add(openClient());
		const bridge = createWsBridge({ wsRegistry });

		const p = bridge.sendRequest("ping", {}, 50);
		vi.advanceTimersByTime(51);
		await expect(p).resolves.toBeNull();
		vi.useRealTimers();
	});

	it("waitForResponse resolves by externally-chosen id", async () => {
		const wsRegistry = createWsRegistry();
		const bridge = createWsBridge({ wsRegistry });

		const p = bridge.waitForResponse("measure-1", 1000);
		bridge.resolveResponse("measure-1", { overflow: false });
		await expect(p).resolves.toEqual({ overflow: false });
	});

	it("ignores replies with an unknown id", () => {
		const wsRegistry = createWsRegistry();
		const bridge = createWsBridge({ wsRegistry });
		// Should not throw
		bridge.resolveResponse("ghost", { x: 1 });
	});
});
