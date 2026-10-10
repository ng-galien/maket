import { describe, expect, it } from "vitest";
import { scopeCssToElement } from "./scoped-css.js";

describe("scopeCssToElement", () => {
	const scope = '[data-maket-compact-template="card-0"]';

	it("prefixes selectors, maps page roots to the scope and keeps keyframes", () => {
		expect(
			scopeCssToElement(
				":root { --gap: 2mm } .a, .b > i { color: red } :scope.wide { width: 50% } @keyframes pulse { from { opacity: 0 } to { opacity: 1 } }",
				scope,
			),
		).toBe(
			`${scope} { --gap: 2mm } ${scope} .a, ${scope} .b > i { color: red } ${scope}.wide { width: 50% } @keyframes pulse { from { opacity: 0 } to { opacity: 1 } }`,
		);
	});

	it("drops a sheet that does not parse instead of applying it unscoped", () => {
		expect(scopeCssToElement(".a { color: red", scope)).toBe("");
	});
});
