import { describe, expect, it } from "vitest";
import {
	applyJsonPatch,
	jsonPointersIntersect,
	parseJsonPointer,
	readJsonPointer,
} from "./json-patch.js";

describe("JSON Pointer and Patch", () => {
	it("reads escaped RFC 6901 pointers", () => {
		const value = { "a/b": { "~key": 42 } };
		expect(readJsonPointer(value, "/a~1b/~0key")).toBe(42);
		expect(parseJsonPointer("/a~1b/~0key")).toEqual(["a/b", "~key"]);
	});

	it("applies add, remove, replace, move, copy, and test immutably", () => {
		const source = {
			title: "Opening",
			items: [
				{ label: "Doors", done: false },
				{ label: "Windows", done: false },
			],
		};
		const patched = applyJsonPatch(source, [
			{ op: "test", path: "/title", value: "Opening" },
			{ op: "replace", path: "/items/0/done", value: true },
			{ op: "add", path: "/items/-", value: { label: "Alarm", done: false } },
			{ op: "copy", from: "/items/0", path: "/items/1" },
			{ op: "move", from: "/items/3", path: "/items/0" },
			{ op: "remove", path: "/items/2" },
		]);

		expect(source.items).toHaveLength(2);
		expect(patched).toEqual({
			title: "Opening",
			items: [
				{ label: "Alarm", done: false },
				{ label: "Doors", done: true },
				{ label: "Windows", done: false },
			],
		});
	});

	it("rejects missing targets and unsafe segments", () => {
		expect(() =>
			applyJsonPatch({ title: "x" }, [
				{ op: "replace", path: "/missing", value: "y" },
			]),
		).toThrow(/does not exist/);
		expect(() => parseJsonPointer("/__proto__/polluted")).toThrow(/Unsafe/);
	});

	it("detects ancestor and descendant pointer intersections", () => {
		expect(jsonPointersIntersect("/items", "/items/2/done")).toBe(true);
		expect(jsonPointersIntersect("/items/1", "/items/2")).toBe(false);
		expect(jsonPointersIntersect("", "/anything")).toBe(true);
	});
});
