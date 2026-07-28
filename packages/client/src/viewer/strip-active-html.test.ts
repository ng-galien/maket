import { describe, expect, it } from "vitest";
import { stripActiveHtml, stripNetworkCss } from "./strip-active-html";

// Exercises the shared strip policy through the browser (DOMParser) backend —
// the path that renders untrusted .maket files.
describe("stripActiveHtml (DOMParser backend)", () => {
	it("removes forbidden tags but keeps content", () => {
		const out = stripActiveHtml(
			'<div>ok</div><script>window.x=1</script><iframe src="https://evil.example"></iframe><base href="https://evil.example/">',
		);
		expect(out).toContain("<div>ok</div>");
		expect(out).not.toContain("script");
		expect(out).not.toContain("iframe");
		expect(out).not.toContain("base");
	});

	it("scrubs on* handlers and executable URLs, keeps safe images", () => {
		const out = stripActiveHtml(
			'<img src="data:image/svg+xml,x" onerror="p()" alt="a"/><a href="javascript:alert(1)">l</a>',
		);
		expect(out).not.toContain("onerror");
		expect(out).not.toContain("javascript:");
		expect(out).toContain('src="data:image/svg+xml,x"');
		expect(out).toContain('alt="a"');
	});

	it("removes every passive network load but keeps bundled blob assets", () => {
		const out = stripActiveHtml(
			'<link rel="stylesheet" href="https://evil.example/x.css">' +
				'<img src="https://evil.example/pixel">' +
				'<img src="/assets/missing.png">' +
				'<img src="blob:http://localhost/asset-id">' +
				'<img srcset="data:image/png;base64,x 1x, https://evil.example/retina 2x">' +
				'<video poster="https://evil.example/poster"><source srcset="https://evil.example/video"></video>' +
				'<svg><image href="https://evil.example/vector"></image></svg>' +
				'<a href="https://example.com/read-more">Read more</a>',
		);
		expect(out).not.toContain("evil.example");
		expect(out).not.toContain("srcset");
		expect(out).not.toContain("/assets/missing.png");
		expect(out).toContain('src="blob:http://localhost/asset-id"');
		expect(out).toContain('href="https://example.com/read-more"');
	});

	it("removes network URLs from inline and embedded CSS", () => {
		const out = stripActiveHtml(
			'<style>@import url("https://evil.example/theme.css"); .x{background:url(https://evil.example/pixel)}</style>' +
				'<div style="background:url(https://evil.example/inline);filter:url(#shadow)">x</div>' +
				'<svg><use href="#mark"></use></svg>',
		);
		expect(out).not.toContain("evil.example");
		expect(out).toContain('url("")');
		expect(out).toContain("url(#shadow)");
		expect(out).toContain('href="#mark"');
		expect(
			stripNetworkCss("background:url(data:image/png;base64,x)"),
		).toContain("data:image/png");
	});

	it("passes through empty and inert html unchanged", () => {
		expect(stripActiveHtml("")).toBe("");
		expect(stripActiveHtml("<p style='color:red'>t</p>")).toContain("t");
	});
});
