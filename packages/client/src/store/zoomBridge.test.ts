import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	consumePendingFit,
	type FitTarget,
	fitToView,
	registerFitToView,
	registerRequestFit,
	registerZoomTo,
	requestFit,
	zoomTo,
} from "./zoomBridge";

// The bridge is a module-level singleton — each test registers fresh stubs
// so we observe exactly the calls made in that test.
describe("zoomBridge", () => {
	beforeEach(() => {
		consumePendingFit();
		registerRequestFit(null);
		registerZoomTo(() => {});
		registerFitToView(() => {});
	});

	it("forwards zoomTo(pct) to the registered handler", () => {
		const handler = vi.fn();
		registerZoomTo(handler);
		zoomTo(125);
		expect(handler).toHaveBeenCalledExactlyOnceWith(125);
	});

	it("forwards fitToView() to the registered handler", () => {
		const handler = vi.fn();
		registerFitToView(handler);
		fitToView();
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("ignores zoomTo when no handler has been registered yet", () => {
		registerZoomTo(null as unknown as (pct: number) => void);
		// If we had simply not registered, the bridge would still be holding
		// the beforeEach stub. Set it back to null by calling with null and
		// assert no throw — covers the optional-chaining branch.
		expect(() => zoomTo(50)).not.toThrow();
	});

	it("lets the last registration win", () => {
		const first = vi.fn();
		const second = vi.fn();
		registerZoomTo(first);
		registerZoomTo(second);
		zoomTo(80);
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledExactlyOnceWith(80);
	});
});

describe("requestFit", () => {
	it("routes through a registered deferred handler", () => {
		const calls: (FitTarget | undefined)[] = [];
		registerRequestFit((target) => calls.push(target));
		requestFit();
		requestFit({ docName: "doc", pageIndex: 2 });
		registerRequestFit(null);
		expect(calls).toEqual([undefined, { docName: "doc", pageIndex: 2 }]);
	});

	it("queues the latest fit until a Board registers its deferred handler", () => {
		registerRequestFit(null);
		requestFit();
		requestFit({ docName: "d", pageIndex: 1 });
		expect(consumePendingFit()).toEqual({
			target: { docName: "d", pageIndex: 1 },
		});
	});

	it("reports when no pending fit is available", () => {
		registerRequestFit(null);
		expect(consumePendingFit()).toBeNull();
	});
});
