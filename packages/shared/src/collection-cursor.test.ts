import { describe, expect, it } from "vitest";
import {
	collectionCursorKey,
	collectionCursorModes,
	isCollectionCursorMode,
} from "./collection-cursor.js";

describe("isCollectionCursorMode", () => {
	it("accepts every declared mode", () => {
		for (const mode of collectionCursorModes) {
			expect(isCollectionCursorMode(mode)).toBe(true);
		}
	});

	it("rejects unknown values", () => {
		expect(isCollectionCursorMode("ligne")).toBe(false);
		expect(isCollectionCursorMode("")).toBe(false);
		expect(isCollectionCursorMode(3)).toBe(false);
		expect(isCollectionCursorMode(null)).toBe(false);
	});
});

describe("collectionCursorKey", () => {
	it("keys by doc name and page index", () => {
		expect(collectionCursorKey("Doc", 0)).not.toBe(
			collectionCursorKey("Doc", 1),
		);
		expect(collectionCursorKey("A", 0)).not.toBe(collectionCursorKey("B", 0));
	});

	it("does not collide on doc names containing digits and spaces", () => {
		expect(collectionCursorKey("Doc 1", 0)).not.toBe(
			collectionCursorKey("Doc", 10),
		);
	});
});
