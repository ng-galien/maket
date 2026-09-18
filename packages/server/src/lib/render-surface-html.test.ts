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

	it("scopes competing classes to their own printed page", () => {
		const first =
			'<style>:root { --tone: red } .top { display: grid; grid-template-columns: 1fr 1fr } .kicker { color: var(--tone) }</style><main class="top"><p class="kicker">First</p></main>';
		const second =
			'<style media="all">html body { --tone: blue } .top { display: flex } .kicker { color: var(--tone) }</style><main class="top"><p class="kicker">Second</p></main>';
		const html = buildRenderSurfaceHtml({
			canvas,
			pageHtmls: [first, second],
			charteCss: ":root { --accent: gold; }",
			surface: { kind: "print" },
		});

		expect(html).toContain(
			'@scope (maket-render-page[data-maket-render-page="1"]) {\n:scope { --tone: red } .top { display: grid; grid-template-columns: 1fr 1fr } .kicker { color: var(--tone) }\n}',
		);
		expect(html).toContain(
			'<style media="all">@scope (maket-render-page[data-maket-render-page="2"]) {\n:scope { --tone: blue } .top { display: flex } .kicker { color: var(--tone) }\n}</style>',
		);
		expect(html).toContain(":root { --accent: gold; }");
		expect(html.match(/class="top"/g)).toHaveLength(2);
	});

	it("inlines data CSS imports inside their printed page scope", () => {
		const html = buildRenderSurfaceHtml({
			canvas,
			pageHtmls: [
				'<style>@import url("data:text/css,.shared%7Bcolor%3Ared%7D");</style><main class="shared">First</main>',
				'<style>@import url("data:text/css,.shared%7Bcolor%3Ablue%7D");</style><main class="shared">Second</main>',
			],
			charteCss: "",
			surface: { kind: "print" },
		});

		expect(html).toContain(
			'@scope (maket-render-page[data-maket-render-page="1"]) {\n.shared{color:red}',
		);
		expect(html).toContain(
			'@scope (maket-render-page[data-maket-render-page="2"]) {\n.shared{color:blue}',
		);
		expect(html).not.toContain("@import");
	});

	it("keeps Google Font imports valid before a printed page scope", () => {
		const html = buildRenderSurfaceHtml({
			canvas,
			pageHtmls: [
				'<style>@import url("https://fonts.googleapis.com/css2?family=Inter"); .sheet{font-family:Inter}</style><main class="sheet">First</main>',
				'<style>.sheet{font-family:serif}</style><main class="sheet">Second</main>',
			],
			charteCss: "",
			surface: { kind: "print" },
		});

		expect(html).toContain(
			'@import url("https://fonts.googleapis.com/css2?family=Inter");\n@scope (maket-render-page[data-maket-render-page="1"])',
		);
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
