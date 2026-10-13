import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderPage } from "../services/browser-pool.js";
import { waitForPageStable } from "./page-stable-wait.js";
import { RenderTimeoutError } from "./render-deadline.js";

const timeouts = { networkIdleMs: 30, pageStableMs: 200, framePumpMs: 10 };

function fakePage(overrides: Partial<RenderPage> = {}): RenderPage {
	return {
		setViewport: vi.fn(async () => {}),
		setContent: vi.fn(async () => {}),
		waitForNetworkIdle: vi.fn(async () => {}),
		evaluate: vi.fn(async (pageFunction: unknown, ...args: unknown[]) =>
			typeof pageFunction === "function"
				? (pageFunction as (...a: unknown[]) => unknown)(...args)
				: undefined,
		) as unknown as RenderPage["evaluate"],
		screenshot: vi.fn(async () => new Uint8Array()),
		pdf: vi.fn(async () => new Uint8Array()),
		close: vi.fn(async () => {}),
		...overrides,
	};
}

function stubHiddenWindow(frames: "frozen" | "ticking") {
	vi.stubGlobal("document", {
		fonts: { ready: Promise.resolve() },
		images: [],
		body: { getBoundingClientRect: () => ({}) },
	});
	vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
		if (frames === "ticking") setTimeout(callback, 0);
		return 1;
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("waitForPageStable", () => {
	it("finishes when the window never ticks a frame", async () => {
		stubHiddenWindow("frozen");
		await expect(
			waitForPageStable(fakePage(), timeouts),
		).resolves.toBeUndefined();
	});

	it("finishes on two frames when the window ticks", async () => {
		stubHiddenWindow("ticking");
		await expect(
			waitForPageStable(fakePage(), { ...timeouts, framePumpMs: 10_000 }),
		).resolves.toBeUndefined();
	});

	it("rejects with the network idle step when the network never settles", async () => {
		const page = fakePage({ waitForNetworkIdle: () => new Promise(() => {}) });
		const waiting = waitForPageStable(page, timeouts);
		await expect(waiting).rejects.toBeInstanceOf(RenderTimeoutError);
		await expect(waiting).rejects.toThrow(
			'Render step "network idle" timed out after 30ms',
		);
	});

	it("rejects with the page stable step when the in-page wait never returns", async () => {
		const page = fakePage({
			evaluate: (() => new Promise(() => {})) as RenderPage["evaluate"],
		});
		await expect(
			waitForPageStable(page, { ...timeouts, pageStableMs: 30 }),
		).rejects.toThrow('Render step "page stable" timed out after 30ms');
	});
});
