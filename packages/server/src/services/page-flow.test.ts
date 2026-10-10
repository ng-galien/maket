import { describe, expect, it, vi } from "vitest";
import { createBus } from "./bus.js";
import {
	createPageFlow,
	flowedPageIdentity,
	flowSourcePageId,
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
	it("names continuation pages after their source page", () => {
		expect(flowedPageIdentity({ id: "p1", name: "Index" }, 0)).toEqual({
			id: "p1",
			name: "Index",
		});
		expect(flowedPageIdentity({ id: "p1", name: "Index" }, 2)).toEqual({
			id: "p1~3",
			name: "Index (3)",
		});
		expect(flowSourcePageId("p1~3")).toBe("p1");
		expect(flowSourcePageId("p1")).toBe("p1");
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
		expect(await flow.settle()).toBe(false);
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
		expect(await flow.settle()).toBe(true);
		expect(flow.pages(request)).toBeNull();
		expect(flowed).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith("[page-flow] board: no browser");
		error.mockRestore();
	});
});
