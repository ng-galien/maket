import { describe, expect, it } from "vitest";
import { resolveActivity } from "./activity-contract.js";

describe("activity contract", () => {
	it("resolves visible actions from the explicit catalog", () => {
		expect(resolveActivity("maket_collection", { action: "create" })).toEqual({
			icon: "table",
			key: "bubble_maket_collection_create",
		});
	});

	it("keeps intentional reads silent instead of creating empty bubbles", () => {
		expect(resolveActivity("maket_html", { action: "get" })).toBeNull();
		expect(resolveActivity("maket_page", { action: "list" })).toBeNull();
		expect(resolveActivity("maket_learn", { action: "overview" })).toBeNull();
	});

	it("keeps document-state mutations silent", () => {
		for (const action of [
			"init",
			"update",
			"patch",
			"change_schema",
			"restore",
		]) {
			expect(resolveActivity("maket_state", { action })).toBeNull();
		}
	});

	it("keeps cursor reads silent and reports only cursor mutations", () => {
		expect(
			resolveActivity("maket_collection", {
				action: "cursor",
				doc: "poster",
				page: 1,
			}),
		).toBeNull();
		expect(
			resolveActivity("maket_collection", {
				action: "cursor",
				doc: "poster",
				page: 1,
				mode: "rendered",
			}),
		).toEqual({
			icon: "table",
			key: "bubble_maket_collection_cursor",
		});
	});

	it("fails closed when a tool or action has no policy", () => {
		expect(() => resolveActivity("maket_unknown", {})).toThrow(
			/Missing activity policy for tool/,
		);
		expect(() => resolveActivity("maket_html", { action: "unknown" })).toThrow(
			/Missing activity policy for call/,
		);
	});
});
