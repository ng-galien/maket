import { describe, expect, it } from "vitest";
import { parseCharteRules } from "./charte.js";

describe("parseCharteRules", () => {
	it("keeps string rules from objects and JSON strings", () => {
		expect(parseCharteRules({ titles: "Short", photos: "Bright" })).toEqual({
			titles: "Short",
			photos: "Bright",
		});
		expect(parseCharteRules('{"layout":"Tight"}')).toEqual({
			layout: "Tight",
		});
	});

	it("drops malformed or non-string rule values", () => {
		expect(parseCharteRules("not json")).toEqual({});
		expect(
			parseCharteRules('{"titles":{"bad":true},"photos":"Use people"}'),
		).toEqual({
			photos: "Use people",
		});
		expect(parseCharteRules("[1,2,3]")).toEqual({});
	});
});
