import { describe, expect, it } from "vitest";
import { formatCommandPreview } from "./install.ts";

describe("formatCommandPreview", () => {
	it("quotes absolute runtime paths that contain spaces", () => {
		expect(
			formatCommandPreview([
				"claude",
				"mcp",
				"add",
				"--",
				"/Applications/Node Runtime/bin/node",
				"/Users/Alex/Maket Install/index.js",
			]),
		).toBe(
			'"claude" "mcp" "add" "--" "/Applications/Node Runtime/bin/node" "/Users/Alex/Maket Install/index.js"',
		);
	});
});
