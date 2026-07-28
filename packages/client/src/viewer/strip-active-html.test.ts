import { describe, expect, it } from "vitest";
import { stripActiveHtml } from "./strip-active-html";

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

	it("passes through empty and inert html unchanged", () => {
		expect(stripActiveHtml("")).toBe("");
		expect(stripActiveHtml("<p style='color:red'>t</p>")).toContain("t");
	});
});
