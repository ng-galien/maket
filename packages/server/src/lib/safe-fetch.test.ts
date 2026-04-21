import { describe, expect, it } from "vitest";
import { assertSafeUrl } from "./safe-fetch.ts";

describe("assertSafeUrl", () => {
	it("rejects non-http(s) protocols", async () => {
		await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(
			/non-http/,
		);
		await expect(assertSafeUrl("ftp://example.com/")).rejects.toThrow(
			/non-http/,
		);
		await expect(assertSafeUrl("data:text/plain,evil")).rejects.toThrow(
			/non-http/,
		);
	});

	it("rejects malformed URLs", async () => {
		await expect(assertSafeUrl("not a url")).rejects.toThrow(/Invalid/);
	});

	it("rejects loopback hostnames", async () => {
		await expect(assertSafeUrl("http://127.0.0.1/")).rejects.toThrow(
			/private\/loopback/,
		);
		await expect(assertSafeUrl("http://localhost/")).rejects.toThrow(
			/private\/loopback/,
		);
	});

	it("rejects RFC1918 ranges by IP literal", async () => {
		await expect(assertSafeUrl("http://10.0.0.1/")).rejects.toThrow(
			/private\/loopback/,
		);
		await expect(assertSafeUrl("http://192.168.1.1/")).rejects.toThrow(
			/private\/loopback/,
		);
		await expect(assertSafeUrl("http://172.20.0.1/")).rejects.toThrow(
			/private\/loopback/,
		);
	});

	it("rejects link-local AWS IMDS", async () => {
		await expect(assertSafeUrl("http://169.254.169.254/")).rejects.toThrow(
			/private\/loopback/,
		);
	});

	it("rejects IPv6 loopback and link-local", async () => {
		await expect(assertSafeUrl("http://[::1]/")).rejects.toThrow(
			/private\/loopback/,
		);
		await expect(assertSafeUrl("http://[fe80::1]/")).rejects.toThrow(
			/private\/loopback/,
		);
	});
});
