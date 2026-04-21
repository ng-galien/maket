import { describe, expect, it } from "vitest";
import { isLoopbackHost, isLoopbackOrigin } from "./local-origin.ts";

describe("isLoopbackHost", () => {
	it("accepts loopback variants with and without port", () => {
		// "::1" must be bracketed in a Host header per RFC 7230 §5.4.
		for (const v of [
			"localhost",
			"localhost:24842",
			"127.0.0.1",
			"127.0.0.1:80",
			"[::1]",
			"[::1]:8080",
			"0.0.0.0",
			"LOCALHOST",
		]) {
			expect(isLoopbackHost(v)).toBe(true);
		}
	});

	it("rejects non-loopback hosts", () => {
		for (const v of [
			"example.com",
			"example.com:80",
			"127.0.0.1.evil.com",
			"localhost.evil.com",
			"192.168.1.1",
			"169.254.169.254",
			"[2001:db8::1]",
			"",
			undefined,
			null,
		]) {
			expect(isLoopbackHost(v as string | undefined)).toBe(false);
		}
	});
});

describe("isLoopbackOrigin", () => {
	it("accepts loopback origins", () => {
		expect(isLoopbackOrigin("http://localhost")).toBe(true);
		expect(isLoopbackOrigin("http://localhost:24842")).toBe(true);
		expect(isLoopbackOrigin("http://127.0.0.1:5173")).toBe(true);
		expect(isLoopbackOrigin("http://[::1]:80")).toBe(true);
	});

	it("rejects non-loopback origins and malformed input", () => {
		expect(isLoopbackOrigin("https://attacker.com")).toBe(false);
		expect(isLoopbackOrigin("http://localhost.evil.com")).toBe(false);
		expect(isLoopbackOrigin("not a url")).toBe(false);
		expect(isLoopbackOrigin(undefined)).toBe(false);
		expect(isLoopbackOrigin(null)).toBe(false);
	});
});
