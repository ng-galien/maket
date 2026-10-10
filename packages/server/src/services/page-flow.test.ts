import { describe, expect, it, vi } from "vitest";
import { createBus } from "./bus.js";
import {
	createPageFlow,
	flowedPageIdentity,
	flowSourcePageId,
	isFlowContinuation,
	markFlowedPage,
	remapPageLinkNumbers,
} from "./page-flow.js";

const doc = {
	name: "board",
	canvas: {
		format: "custom" as const,
		orientation: "portrait" as const,
		w: 100,
		h: 100,
		bg: "#fff",
	},
	meta: {},
};

describe("page flow helpers", () => {
	it("names continuation pages after their source page and marks the flowed set", () => {
		const page = { id: "p1", name: "Index" };
		expect(flowedPageIdentity(page, 0, 1)).toEqual({ id: "p1", name: "Index" });
		expect(flowedPageIdentity(page, 0, 3)).toEqual({
			id: "p1",
			name: "Index",
			flow: { sourcePageId: "p1", index: 0, count: 3 },
		});
		const third = flowedPageIdentity(page, 2, 3);
		expect(third).toEqual({
			id: "p1~3",
			name: "Index (3)",
			flow: { sourcePageId: "p1", index: 2, count: 3 },
		});
		expect(flowSourcePageId(third)).toBe("p1");
		expect(isFlowContinuation(third)).toBe(true);
		expect(flowSourcePageId({ id: "authored~2" })).toBe("authored~2");
		expect(isFlowContinuation({ id: "authored~2" } as never)).toBe(false);
	});

	it("marks the first element of a flowed page, after any style", () => {
		expect(
			markFlowedPage('<style>.a{}</style><main data-id="page">x</main>', 1, 3),
		).toBe(
			'<style>.a{}</style><main data-maket-flow-page="2" data-maket-flow-pages="3" data-id="page">x</main>',
		);
		expect(markFlowedPage("<main>x</main>", 0, 1)).toBe("<main>x</main>");
	});

	it("points page links at the first output page of their source page", () => {
		expect(
			remapPageLinkNumbers(
				'<a href="#page=1">a</a><a href=\'#page=2\'>b</a><a href="#page=9">c</a>',
				[0, 3],
			),
		).toBe(
			'<a href="#page=1">a</a><a href=\'#page=4\'>b</a><a href="#page=9">c</a>',
		);
	});
});

describe("page flow planning", () => {
	it("keeps a page without flowing lists as one page and measures nothing", async () => {
		const get = vi.fn();
		const flow = createPageFlow({
			bus: createBus(),
			browserPool: { get, dispose: async () => {} },
			documents: { charteCss: () => "" },
		});

		expect(
			flow.pages({
				doc,
				pageKey: "p1",
				full: { html: "<main></main>", lists: [] },
				render: () => ({ html: "", lists: [] }),
			}),
		).toBeNull();
		await flow.settle();
		expect(get).not.toHaveBeenCalled();
	});

	it("keeps one page and announces nothing when the layout cannot be measured", async () => {
		const bus = createBus();
		const flowed = vi.fn();
		bus.on("document:flowed", flowed);
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const flow = createPageFlow({
			bus,
			browserPool: {
				get: async () => {
					throw new Error("no browser");
				},
				dispose: async () => {},
			},
			documents: { charteCss: () => "" },
		});
		const request = {
			doc,
			pageKey: "p1",
			full: {
				html: "<ul><!--maket-flow:0:0--><li></li></ul>",
				lists: ["/rows"],
			},
			render: () => ({ html: "", lists: [] }),
		};

		expect(flow.pages(request)).toBeNull();
		await flow.settle();
		expect(flow.pages(request)).toBeNull();
		expect(flowed).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith("[page-flow] board: no browser");
		error.mockRestore();
	});

	it("measures a page once when the same content is asked again during its measurement", async () => {
		const newPage = vi.fn(async () => ({
			setNetworkGuard: async () => {},
			setViewport: async () => {},
			setContent: async () => {},
			waitForNetworkIdle: async () => {},
			evaluate: async () => ({}),
			close: async () => {},
		}));
		const flow = createPageFlow({
			bus: createBus(),
			browserPool: {
				get: async () => ({ newPage }) as never,
				dispose: async () => {},
			},
			documents: { charteCss: () => "" },
		});
		const request = {
			doc,
			pageKey: "p1",
			full: {
				html: "<ul><!--maket-flow:0:0--><li></li><!--/maket-flow--></ul>",
				lists: ["/rows"],
			},
			render: () => ({ html: "", lists: [] }),
		};

		flow.pages(request);
		await Promise.resolve();
		await Promise.resolve();
		flow.pages(request);
		await flow.settle();
		flow.pages(request);
		await flow.settle();

		expect(newPage).toHaveBeenCalledTimes(1);
	});
});
