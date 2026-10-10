import { describe, expect, it } from "vitest";
import {
	stripActiveHtml,
	stripDocumentNavigationHtml,
} from "./strip-active-html.ts";

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

	it("keeps in-document page links", () => {
		const out = stripActiveHtml(
			'<a data-id="a" href="#page=3">3</a><a data-id="b" href="#page:Synthèse annuelle">S</a><svg><a href="#page=2"><text>2</text></a></svg>',
		);
		expect(out).toContain('href="#page=3"');
		expect(out).toContain('href="#page:Synthèse annuelle"');
		expect(out).toContain('href="#page=2"');
	});

	it("returns empty input untouched", () => {
		expect(stripActiveHtml("")).toBe("");
	});
});

describe("stripDocumentNavigationHtml", () => {
	it("neutralizes native navigation controls while preserving visible content", () => {
		const html =
			'<article data-id="card" data-maket-action="open-document" data-maket-document="Missing item" role="button" tabindex="0" style="cursor:pointer;color:red"><strong>Ship</strong><button class="open" type="button" data-maket-action="open-document" data-maket-document="Missing item">Open</button><a class="details" href="/documents/missing" target="_blank" data-maket-action="open-document" data-maket-document="Missing item">Details</a></article>';
		const result = stripDocumentNavigationHtml(html);

		expect(result).toContain("<strong>Ship</strong>");
		expect(result).toContain('<span class="open">Open</span>');
		expect(result).toContain('<span class="details">Details</span>');
		expect(result).toContain("color:red");
		expect(result).not.toMatch(/<button(?:\s|>)/);
		expect(result).not.toMatch(/<a(?:\s|>)/);
		expect(result).not.toContain("href=");
		expect(result).not.toContain("open-document");
		expect(result).not.toContain("data-maket-document");
		expect(result).not.toContain('role="button"');
		expect(result).not.toContain('tabindex="0"');
		expect(result).not.toContain("cursor");
	});

	it("leaves unrelated authored buttons and anchors unchanged", () => {
		const html =
			'<button class="save" type="button">Save</button><a class="help" href="/help">Help</a>';

		expect(stripDocumentNavigationHtml(html)).toBe(html);
	});
});
