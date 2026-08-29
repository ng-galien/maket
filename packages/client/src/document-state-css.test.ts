import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("document-state canvas CSS ownership", () => {
	const canvasCss = () =>
		readFileSync(
			resolve(process.cwd(), "packages/client/src/index.css"),
			"utf8",
		);

	it("does not style document binding controls from the Maket shell", () => {
		const css = canvasCss();

		expect(css).not.toMatch(/data-maket-(?:bind|path|type|pending|error)/);
		expect(css).not.toMatch(/\.page-canvas\.state-live\s+\[data-id\]/);
		expect(css).not.toMatch(
			/^[ \t]*\.page-canvas[^{]*(?:\bcheckbox\b|\binput\b|\bselect\b|\bbutton\b)/im,
		);
	});

	it("keeps the UA-default repair weaker than authored class rules", () => {
		const css = canvasCss();

		expect(css).toContain(":where(.page-canvas) p,");
		expect(css).toContain(":where(.page-canvas) h1,");
		expect(css).not.toMatch(
			/^[ \t]*\.page-canvas\s+(?:h[1-6]|p|blockquote|pre|figure|dl|dd|ul|ol|menu|b|strong|small)\b/m,
		);
	});
});
