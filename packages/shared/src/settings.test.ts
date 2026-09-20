import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings";

describe("settings", () => {
	it("defaults the document bar to the bottom and accepts a top preference", () => {
		expect(normalizeSettings({}).documentLabelPosition).toBe("bottom");
		expect(
			normalizeSettings({ documentLabelPosition: "top" }).documentLabelPosition,
		).toBe("top");
		expect(
			normalizeSettings({ documentLabelPosition: "side" })
				.documentLabelPosition,
		).toBe(DEFAULT_SETTINGS.documentLabelPosition);
	});
});
