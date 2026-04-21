import { describe, expect, it } from "vitest";
import { escapeCssValue, stripStyleClose } from "./css-escape.ts";

describe("escapeCssValue", () => {
	it("passes harmless colours through untouched", () => {
		expect(escapeCssValue("#fff")).toBe("#fff");
		expect(escapeCssValue("rgb(0, 0, 0)")).toBe("rgb(0, 0, 0)");
	});

	it("escapes characters that close or open declarations", () => {
		const out = escapeCssValue('red; body { background: url("http://x") }');
		expect(out).not.toContain(";");
		expect(out).not.toContain("{");
		expect(out).not.toContain("}");
		expect(out).not.toContain('"');
	});

	it("escapes the four CSS-context dangerous chars `<`, `>`, `'`, `\\`", () => {
		const out = escapeCssValue("<\\>'");
		expect(out).not.toContain("<");
		expect(out).not.toContain(">");
		expect(out).not.toContain("'");
		expect(out).not.toContain("\\>"); // raw backslash followed by >
	});
});

describe("stripStyleClose", () => {
	it("rewrites the literal close sequence so the HTML tokeniser cannot see it", () => {
		const out = stripStyleClose(
			"body { content: '</style><script>alert(1)</script>' }",
		);
		expect(out.toLowerCase()).not.toContain("</style");
	});

	it("is case-insensitive", () => {
		expect(stripStyleClose("</STYLE").toLowerCase()).not.toContain("</style");
		expect(stripStyleClose("</StyLe").toLowerCase()).not.toContain("</style");
	});

	it("leaves CSS not containing the close sequence intact", () => {
		const css = ".foo { color: red; }";
		expect(stripStyleClose(css)).toBe(css);
	});
});
