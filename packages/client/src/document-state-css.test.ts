import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("document-state canvas CSS ownership", () => {
	it("does not style document binding controls from the Maket shell", () => {
		const css = readFileSync(
			resolve(process.cwd(), "packages/client/src/index.css"),
			"utf8",
		);

		expect(css).not.toMatch(/data-maket-(?:bind|path|type|pending|error)/);
		expect(css).not.toMatch(/\.page-canvas\.state-live\s+\[data-id\]/);
		expect(css).not.toMatch(
			/^[ \t]*\.page-canvas[^{]*(?:\bcheckbox\b|\binput\b|\bselect\b|\bbutton\b)/im,
		);
	});
});
