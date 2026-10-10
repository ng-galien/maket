import { describe, expect, it } from "vitest";
import { normalizedPinnedAt } from "./bundle-import.js";

describe("bundle import — pin timestamps", () => {
	it("stores a bundled pin in ISO 8601 UTC whatever its format", () => {
		expect(normalizedPinnedAt("Sat, 10 Oct 2026 18:00:00 GMT")).toBe(
			"2026-10-10T18:00:00.000Z",
		);
		expect(normalizedPinnedAt("2026-10-10T20:30:00+02:00")).toBe(
			"2026-10-10T18:30:00.000Z",
		);
		expect(normalizedPinnedAt("2026-10-10T18:00:00.000Z")).toBe(
			"2026-10-10T18:00:00.000Z",
		);
	});

	it("keeps an absent or unreadable pin unpinned", () => {
		expect(normalizedPinnedAt(undefined)).toBeNull();
		expect(normalizedPinnedAt(null)).toBeNull();
		expect(normalizedPinnedAt("")).toBeNull();
		expect(normalizedPinnedAt("not a date")).toBeNull();
	});
});
