import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelDeferredFitOnUserZoom, createDeferredFit } from "./deferredFit";

describe("createDeferredFit", () => {
	let callbacks: Map<number, FrameRequestCallback>;
	let nextId: number;

	beforeEach(() => {
		vi.useFakeTimers();
		callbacks = new Map();
		nextId = 1;
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			const id = nextId++;
			callbacks.set(id, callback);
			return id;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number) => {
			callbacks.delete(id);
		});
	});

	function runAnimationFrames(): void {
		while (callbacks.size > 0) {
			const pending = [...callbacks.entries()];
			callbacks.clear();
			for (const [, callback] of pending) callback(0);
		}
	}

	it("fits after layout and once more after the settle delay", () => {
		const fit = vi.fn();
		const deferred = createDeferredFit(fit, vi.fn());
		deferred.request();
		runAnimationFrames();
		expect(fit).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(300);
		expect(fit).toHaveBeenCalledTimes(2);
	});

	it("cancels the settle pass when the user starts interacting", () => {
		const fit = vi.fn();
		const deferred = createDeferredFit(fit, vi.fn());
		deferred.request();
		runAnimationFrames();
		cancelDeferredFitOnUserZoom(deferred, { sourceEvent: new Event("wheel") });
		vi.advanceTimersByTime(300);
		expect(fit).toHaveBeenCalledTimes(1);
	});

	it("does not cancel for programmatic zoom events", () => {
		const cancel = vi.fn();
		cancelDeferredFitOnUserZoom({ cancel }, { sourceEvent: null });
		expect(cancel).not.toHaveBeenCalled();
	});
});
