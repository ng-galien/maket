import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSafeUrl, boundedFetch } from "./safe-fetch.ts";

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

describe("boundedFetch redirect handling", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("refuses a redirect that points to a loopback IP", async () => {
		vi.stubGlobal("fetch", vi.fn(fetchFixture));

		await expect(
			boundedFetch("http://public.test/redirect-loopback"),
		).rejects.toThrow(/private\/loopback/);
	});

	it("refuses a redirect that points to AWS IMDS", async () => {
		vi.stubGlobal("fetch", vi.fn(fetchFixture));

		await expect(
			boundedFetch("http://public.test/redirect-imds"),
		).rejects.toThrow(/private\/loopback/);
	});

	it("caps redirect chains at 5 hops", async () => {
		vi.stubGlobal("fetch", vi.fn(fetchFixture));

		await expect(boundedFetch("http://93.184.216.34/loop")).rejects.toThrow(
			/Too many redirects/,
		);
	});

	it("returns the body when no redirect is involved", async () => {
		vi.stubGlobal("fetch", vi.fn(fetchFixture));

		const buf = await boundedFetch("http://public.test/ok");
		expect(buf.toString("utf-8")).toBe("hello");
	});
});

function fetchFixture(input: RequestInfo | URL): Response {
	const url = new URL(input.toString());
	if (url.pathname === "/redirect-loopback") {
		return new Response(null, {
			status: 302,
			headers: { Location: "http://127.0.0.1:1/secret" },
		});
	}
	if (url.pathname === "/redirect-imds") {
		return new Response(null, {
			status: 302,
			headers: { Location: "http://169.254.169.254/latest" },
		});
	}
	if (url.pathname === "/loop") {
		return new Response(null, {
			status: 302,
			headers: { Location: "/loop" },
		});
	}
	if (url.pathname === "/ok") {
		return new Response("hello", {
			status: 200,
			headers: { "Content-Type": "text/plain" },
		});
	}
	return new Response("missing", { status: 404 });
}
