import { describe, expect, it } from "vitest";
import {
	buildRenderSurfaceHtml,
	RENDER_PAGE_TAG,
} from "./render-surface-html.js";

const canvas = { w: 420, h: 297, bg: "#123456" };
const authored =
	'<style>.page{padding:10mm}</style><main class="page">content</main>';

describe("buildRenderSurfaceHtml", () => {
	it.each([
		["snapshot", { kind: "snapshot" } as const],
		["thumbnail", { kind: "thumbnail", scale: 0.5 } as const],
		["print", { kind: "print" } as const],
	])("isolates authored page classes on the %s surface", (_name, surface) => {
		const html = buildRenderSurfaceHtml({
			canvas,
			pageHtmls: [authored],
			charteCss: "",
			surface,
		});

		expect(html).toContain(`<${RENDER_PAGE_TAG}`);
		expect(html).not.toContain('<div class="page"');
		expect(html.match(/class="page"/g)).toHaveLength(1);
		expect(html).toContain("width:420mm;height:297mm");
	});

	it("keeps print pagination on the private frame", () => {
		const html = buildRenderSurfaceHtml({
			canvas,
			pageHtmls: ["one", "two"],
			charteCss: "",
			surface: { kind: "print" },
		});

		expect(html).toContain("@page { size: 420mm 297mm; margin: 0; }");
		expect(html.match(/data-maket-render-page=/g)).toHaveLength(2);
		expect(html).toContain("page-break-before:always");
	});

	it("keeps informational print-safe margins out of physical PDF geometry", () => {
		const html = buildRenderSurfaceHtml({
			canvas: {
				...canvas,
				margins: { top: 10, right: 12, bottom: 14, left: 16 },
			},
			pageHtmls: [authored],
			charteCss: "",
			surface: { kind: "print" },
		});

		expect(html).toContain("@page { size: 420mm 297mm; margin: 0; }");
		expect(html).not.toContain("margin-guide");
	});

	it("applies thumbnail scaling only to the private frame", () => {
		const html = buildRenderSurfaceHtml({
			canvas,
			pageHtmls: [authored],
			charteCss: "",
			surface: { kind: "thumbnail", scale: 0.5 },
		});

		expect(html.match(/transform:scale\(0\.5\)/g)).toHaveLength(1);
	});
});
