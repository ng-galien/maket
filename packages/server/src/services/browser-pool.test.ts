import { EventEmitter } from "node:events";
import type { Browser } from "puppeteer";
import { describe, expect, it, vi } from "vitest";
import { createBrowserPool } from "./browser-pool.js";

function mockBrowser(): Browser & {
	emit: (ev: string, ...args: unknown[]) => boolean;
} {
	const ee = new EventEmitter();
	const b = {
		connected: true,
		close: vi.fn(async () => {
			(b as { connected: boolean }).connected = false;
			ee.emit("disconnected");
		}),
		on: ee.on.bind(ee),
		emit: ee.emit.bind(ee),
	};
	return b as unknown as Browser & {
		emit: (ev: string, ...args: unknown[]) => boolean;
	};
}

describe("createBrowserPool", () => {
	it("launches once and reuses the same browser on subsequent get()", async () => {
		const b = mockBrowser();
		const launch = vi.fn(async () => b);
		const pool = createBrowserPool({}, { launch });
		const b1 = await pool.get();
		const b2 = await pool.get();
		expect(b1).toBe(b);
		expect(b2).toBe(b);
		expect(launch).toHaveBeenCalledTimes(1);
	});

	it("relaunches after a disconnect", async () => {
		const b1 = mockBrowser();
		const b2 = mockBrowser();
		const launch = vi.fn(async () =>
			launch.mock.calls.length === 1 ? b1 : b2,
		);
		const pool = createBrowserPool({}, { launch });
		await pool.get();
		(b1 as { connected: boolean }).connected = false;
		b1.emit("disconnected");
		const next = await pool.get();
		expect(next).toBe(b2);
		expect(launch).toHaveBeenCalledTimes(2);
	});

	it("coalesces concurrent first-launches into a single launch call", async () => {
		const b = mockBrowser();
		let resolveLaunch!: (browser: Browser) => void;
		const launch = vi.fn(
			() =>
				new Promise<Browser>((res) => {
					resolveLaunch = res;
				}),
		);
		const pool = createBrowserPool({}, { launch });
		const p1 = pool.get();
		const p2 = pool.get();
		expect(launch).toHaveBeenCalledTimes(1);
		resolveLaunch(b);
		expect(await p1).toBe(b);
		expect(await p2).toBe(b);
	});

	it("dispose closes the browser and clears the cached reference", async () => {
		const b = mockBrowser();
		const launch = vi.fn(async () => b);
		const pool = createBrowserPool({}, { launch });
		await pool.get();
		await pool.dispose();
		expect(b.close).toHaveBeenCalledOnce();
		// Next get() must launch again.
		await pool.get();
		expect(launch).toHaveBeenCalledTimes(2);
	});
});
