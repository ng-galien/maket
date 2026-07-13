import { describe, expect, it, vi } from "vitest";
import { CHROMIUM_HEADLESS, shouldDisableSandbox } from "./chromium-sandbox.js";

describe("CHROMIUM_HEADLESS", () => {
	it("uses chrome-headless-shell for render workloads", () => {
		expect(CHROMIUM_HEADLESS).toBe("shell");
	});
});

describe("shouldDisableSandbox", () => {
	it("honors the explicit opt-out env flag", () => {
		expect(shouldDisableSandbox({ MAKET_FORCE_NO_SANDBOX: "1" })).toBe(true);
	});

	it("keeps the sandbox outside Linux by default", () => {
		const platform = vi
			.spyOn(process, "platform", "get")
			.mockReturnValue("darwin");
		expect(shouldDisableSandbox({})).toBe(false);
		platform.mockRestore();
	});

	it("disables the sandbox on Linux when running as root", () => {
		const platform = vi
			.spyOn(process, "platform", "get")
			.mockReturnValue("linux");
		const getuid = vi.spyOn(process, "getuid").mockReturnValue(0);
		expect(shouldDisableSandbox({})).toBe(true);
		getuid.mockRestore();
		platform.mockRestore();
	});

	it("keeps the sandbox on Linux for non-root users", () => {
		const platform = vi
			.spyOn(process, "platform", "get")
			.mockReturnValue("linux");
		const getuid = vi.spyOn(process, "getuid").mockReturnValue(501);
		expect(shouldDisableSandbox({})).toBe(false);
		getuid.mockRestore();
		platform.mockRestore();
	});
});
