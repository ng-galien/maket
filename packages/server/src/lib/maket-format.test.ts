import { describe, expect, it } from "vitest";
import type { Charte } from "../types.js";
import { createDocument } from "../types.js";
import {
	bundleFilename,
	decodeBundle,
	encodeBundle,
	MAKET_BUNDLE_KIND,
	MAKET_BUNDLE_VERSION,
	uniqueName,
} from "./maket-format.js";

function makeDoc(name: string) {
	return createDocument({
		name,
		category: "flyers",
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
		meta: { charte: "brand", rating: 4 },
		pages: [
			{ name: "P1", elements: [], html: `<div data-id="e0">${name}</div>` },
		],
	});
}

function makeCharte(name: string): Charte {
	return {
		name,
		tokens: { color: { primary: "#123456" }, font: { heading: "Inter" } },
	};
}

describe("maket-format", () => {
	it("round-trips documents + chartes through gzip", () => {
		const a = makeDoc("a");
		const b = makeDoc("b");
		const charte = makeCharte("brand");

		const buf = encodeBundle([a, b], [charte]);
		expect(Buffer.isBuffer(buf)).toBe(true);
		// gzip magic bytes
		expect(buf[0]).toBe(0x1f);
		expect(buf[1]).toBe(0x8b);

		const decoded = decodeBundle(buf);
		expect(decoded.version).toBe(MAKET_BUNDLE_VERSION);
		expect(decoded.kind).toBe(MAKET_BUNDLE_KIND);
		expect(decoded.documents).toHaveLength(2);
		expect(decoded.documents[0]?.name).toBe("a");
		expect(decoded.documents[0]?.meta?.charte).toBe("brand");
		expect(decoded.documents[0]?.pages[0]?.html).toContain("data-id");
		expect(decoded.chartes).toHaveLength(1);
		expect(decoded.chartes[0]?.tokens.color?.primary).toBe("#123456");
	});

	it("strips runtime fields from documents", () => {
		const doc = makeDoc("with-runtime");
		doc._layout = { overflow: false } as never;
		doc._displayed = true;

		const buf = encodeBundle([doc], []);
		const decoded = decodeBundle(buf);
		const snap = decoded.documents[0] as unknown as Record<string, unknown>;
		expect(snap).toBeDefined();
		expect(snap._layout).toBeUndefined();
		expect(snap._displayed).toBeUndefined();
	});

	it("rejects a non-gzip payload", () => {
		expect(() => decodeBundle(Buffer.from("plain text"))).toThrow(/gzip/);
	});

	it("rejects a valid gzip that isn't a maket bundle", () => {
		const { gzipSync } = require("node:zlib");
		const buf = gzipSync(
			Buffer.from(JSON.stringify({ kind: "something-else" })),
		);
		expect(() => decodeBundle(buf)).toThrow(/kind/);
	});

	it("rejects a bundle with a future version number", () => {
		const { gzipSync } = require("node:zlib");
		const buf = gzipSync(
			Buffer.from(
				JSON.stringify({
					kind: MAKET_BUNDLE_KIND,
					version: 999,
					documents: [],
				}),
			),
		);
		expect(() => decodeBundle(buf)).toThrow(/version/);
	});
});

describe("bundleFilename", () => {
	it("sanitises unsafe characters", () => {
		expect(bundleFilename("Hello World!")).toBe("Hello_World_.maket");
	});

	it("falls back when the input is empty", () => {
		expect(bundleFilename(undefined)).toBe("maket-bundle.maket");
		expect(bundleFilename("")).toBe("maket-bundle.maket");
	});
});

describe("uniqueName", () => {
	it("returns the wanted name when it's free", () => {
		expect(uniqueName("a", () => false)).toBe("a");
	});

	it("suffixes on collision", () => {
		const existing = new Set(["a"]);
		expect(uniqueName("a", (n) => existing.has(n))).toBe("a (imported)");
	});

	it("keeps incrementing when imported suffix is also taken", () => {
		const existing = new Set(["a", "a (imported)", "a (imported 2)"]);
		expect(uniqueName("a", (n) => existing.has(n))).toBe("a (imported 3)");
	});
});
