import { describe, expect, it } from "vitest";
import {
	categoryPathContains,
	categoryPathSegments,
	normalizeCategoryPath,
} from "./category-path.js";

describe("category paths", () => {
	it("normalizes whitespace, repeated separators, and empty values", () => {
		expect(normalizeCategoryPath(" clients / / acme / proposals ")).toBe(
			"clients/acme/proposals",
		);
		expect(normalizeCategoryPath("///")).toBe("general");
		expect(normalizeCategoryPath()).toBe("general");
	});

	it("returns stable segments", () => {
		expect(categoryPathSegments("clients/acme/proposals")).toEqual([
			"clients",
			"acme",
			"proposals",
		]);
	});

	it("matches a node and its descendants without prefix collisions", () => {
		expect(categoryPathContains("clients/acme", "clients")).toBe(true);
		expect(categoryPathContains("clients/acme/proposals", "clients/acme")).toBe(
			true,
		);
		expect(categoryPathContains("client-services", "clients")).toBe(false);
	});
});
