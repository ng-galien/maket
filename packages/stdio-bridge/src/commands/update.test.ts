import { describe, expect, it } from "vitest";
import { compareVersions } from "./update.ts";

describe("compareVersions", () => {
	it("orders by major/minor/patch", () => {
		expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
		expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
		expect(compareVersions("1.1.0", "1.0.9")).toBeGreaterThan(0);
		expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
	});

	it("treats a prerelease as older than the plain release of the same core", () => {
		expect(compareVersions("1.2.0-beta.1", "1.2.0")).toBeLessThan(0);
		expect(compareVersions("1.2.0", "1.2.0-beta.1")).toBeGreaterThan(0);
	});

	it("compares prereleases lexicographically within the same core", () => {
		expect(compareVersions("1.2.0-alpha", "1.2.0-beta")).toBeLessThan(0);
		expect(compareVersions("1.2.0-rc.2", "1.2.0-rc.1")).toBeGreaterThan(0);
	});

	it("tolerates short or padded versions", () => {
		expect(compareVersions("1.0", "1.0.0")).toBe(0);
		expect(compareVersions("1", "1.0.0")).toBe(0);
		expect(compareVersions("1.0.0", "1.0")).toBe(0);
	});
});
