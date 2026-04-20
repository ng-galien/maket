import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { probeServer, waitForServer } from "./probe.ts";

let current: Server | null = null;

afterEach(async () => {
	if (current) {
		await new Promise<void>((r) => current?.close(() => r()));
		current = null;
	}
});

function listenRandom(): Promise<{ server: Server; port: number }> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (typeof addr === "object" && addr) {
				resolve({ server, port: addr.port });
			} else reject(new Error("no address"));
		});
	});
}

describe("probeServer", () => {
	it("resolves true when the port is bound", async () => {
		const { server, port } = await listenRandom();
		current = server;
		expect(await probeServer(port)).toBe(true);
	});

	it("resolves false for a closed port", async () => {
		// Bind then release to grab a known-free port.
		const { server, port } = await listenRandom();
		await new Promise<void>((r) => server.close(() => r()));
		current = null;
		expect(await probeServer(port, "127.0.0.1", 200)).toBe(false);
	});
});

describe("waitForServer", () => {
	it("returns false quickly when the server never comes up", async () => {
		const { server, port } = await listenRandom();
		await new Promise<void>((r) => server.close(() => r()));
		current = null;
		const t0 = Date.now();
		const ok = await waitForServer(port, "127.0.0.1", 400, 100);
		expect(ok).toBe(false);
		expect(Date.now() - t0).toBeLessThan(1500);
	});
});
