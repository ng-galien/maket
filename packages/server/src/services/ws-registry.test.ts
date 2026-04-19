import { describe, expect, it, vi } from "vitest";
import { createWsRegistry, type WsLike } from "./ws-registry.js";

function fakeClient(readyState = 1) {
	const send = vi.fn<(data: string) => void>();
	return { readyState, send } satisfies WsLike;
}

describe("ws-registry", () => {
	it("adds and tracks clients", () => {
		const reg = createWsRegistry();
		const a = fakeClient();
		reg.add(a);
		expect(reg.hasClients()).toBe(true);
	});

	it("hasClients ignores clients whose readyState is not OPEN", () => {
		const reg = createWsRegistry();
		reg.add(fakeClient(0)); // CONNECTING
		reg.add(fakeClient(3)); // CLOSED
		expect(reg.hasClients()).toBe(false);
	});

	it("remove() drops a client", () => {
		const reg = createWsRegistry();
		const a = fakeClient();
		reg.add(a);
		reg.remove(a);
		expect(reg.hasClients()).toBe(false);
	});

	it("broadcast serialises the message and sends it to every open client", () => {
		const reg = createWsRegistry();
		const a = fakeClient(1);
		const b = fakeClient(1);
		const c = fakeClient(0); // not open
		reg.add(a);
		reg.add(b);
		reg.add(c);
		reg.broadcast({ type: "reload" });
		const payload = JSON.stringify({ type: "reload" });
		expect(a.send).toHaveBeenCalledWith(payload);
		expect(b.send).toHaveBeenCalledWith(payload);
		expect(c.send).not.toHaveBeenCalled();
	});

	it("instances are isolated (no module-level state)", () => {
		const a = createWsRegistry();
		const b = createWsRegistry();
		a.add(fakeClient(1));
		expect(b.hasClients()).toBe(false);
	});
});
