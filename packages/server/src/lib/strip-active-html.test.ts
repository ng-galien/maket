import { describe, expect, it } from "vitest";
import { stripActiveHtml } from "./strip-active-html.ts";

describe("stripActiveHtml", () => {
	it("removes <script> tags entirely", () => {
		const out = stripActiveHtml("<p>hi</p><script>fetch('/x')</script>");
		expect(out).not.toMatch(/<script/i);
		expect(out).toContain("<p>hi</p>");
	});

	it("removes <iframe>, <object>, <embed>, <frame>, <frameset>", () => {
		const out = stripActiveHtml(
			'<iframe src="x"></iframe><object data="y"></object><embed src="z"><frame></frame><frameset></frameset>',
		);
		for (const tag of ["iframe", "object", "embed", "frame", "frameset"]) {
			expect(out.toLowerCase()).not.toContain(`<${tag}`);
		}
	});

	it("removes <meta> and <base>", () => {
		const out = stripActiveHtml(
			'<meta http-equiv="refresh" content="0;url=http://evil"><base href="http://evil"><p>x</p>',
		);
		expect(out.toLowerCase()).not.toContain("<meta");
		expect(out.toLowerCase()).not.toContain("<base");
		expect(out).toContain("<p>x</p>");
	});

	it("strips on* event handler attributes", () => {
		const out = stripActiveHtml(
			'<img src="x.png" onerror="fetch(\'/exfil\')" onload="alert(1)">',
		);
		expect(out).not.toMatch(/onerror=/i);
		expect(out).not.toMatch(/onload=/i);
		expect(out).toContain('src="x.png"');
	});

	it("strips javascript: URLs in href / src / action", () => {
		const out = stripActiveHtml(
			'<a href="javascript:alert(1)">x</a><img src="JavaScript:foo"><form action="javascript:bar"></form>',
		);
		expect(out.toLowerCase()).not.toContain("javascript:");
	});

	it("preserves charte-aware markup (data-id, classes, normal images)", () => {
		const html =
			'<div data-id="root" class="hero"><img src="/assets/logo.png" alt="logo"><h1>Maket</h1></div>';
		expect(stripActiveHtml(html)).toBe(html);
	});

	it("returns empty input untouched", () => {
		expect(stripActiveHtml("")).toBe("");
	});
});
