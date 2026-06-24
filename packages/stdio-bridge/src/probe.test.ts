import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({
	outcomes: [] as Array<"connect" | "error">,
	createConnection: vi.fn(() => {
		const socket = new EventEmitter() as EventEmitter & {
			destroy: ReturnType<typeof vi.fn>;
		};
		socket.destroy = vi.fn();
		const outcome = net.outcomes.shift() ?? "error";
		queueMicrotask(() => {
			if (outcome === "connect") socket.emit("connect");
			else socket.emit("error", new Error("closed"));
		});
		return socket;
	}),
}));

vi.mock("node:net", () => ({
	createConnection: net.createConnection,
}));

import { probeServer, waitForServer } from "./probe.ts";

beforeEach(() => {
	net.outcomes.length = 0;
	net.createConnection.mockClear();
});

describe("probeServer", () => {
	it("resolves true when the socket connects", async () => {
		net.outcomes.push("connect");

		await expect(probeServer(24843)).resolves.toBe(true);
		expect(net.createConnection).toHaveBeenCalledWith({
			port: 24843,
			host: "127.0.0.1",
		});
	});

	it("resolves false when the socket errors", async () => {
		net.outcomes.push("error");

		await expect(probeServer(24843, "127.0.0.1", 20)).resolves.toBe(false);
	});
});

describe("waitForServer", () => {
	it("returns false quickly when probes never connect", async () => {
		net.outcomes.push("error", "error", "error", "error");

		await expect(waitForServer(24843, "127.0.0.1", 20, 1)).resolves.toBe(false);
		expect(net.createConnection).toHaveBeenCalled();
	});
});
