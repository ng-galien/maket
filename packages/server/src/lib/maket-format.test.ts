import { describe, expect, it } from "vitest";
import type { Charte } from "../types.js";
import { createDocument } from "../types.js";
import type { BundleAsset } from "./maket-format.js";
import {
	bundleFilename,
	decodeBundle,
	encodeBundleV1,
	encodeBundleV2,
	MAKET_BUNDLE_KIND,
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

describe("maket-format v1 (legacy gzip-JSON)", () => {
	it("round-trips documents + chartes through gzip", async () => {
		const a = makeDoc("a");
		const b = makeDoc("b");
		const charte = makeCharte("brand");

		const buf = encodeBundleV1([a, b], [charte]);
		expect(Buffer.isBuffer(buf)).toBe(true);
		// gzip magic bytes
		expect(buf[0]).toBe(0x1f);
		expect(buf[1]).toBe(0x8b);

		const decoded = await decodeBundle(buf);
		expect(decoded.version).toBe(1);
		expect(decoded.kind).toBe(MAKET_BUNDLE_KIND);
		expect(decoded.documents).toHaveLength(2);
		expect(decoded.documents[0]?.name).toBe("a");
		expect(decoded.documents[0]?.meta?.charte).toBe("brand");
		expect(decoded.documents[0]?.pages[0]?.html).toContain("data-id");
		expect(decoded.chartes).toHaveLength(1);
		expect(decoded.chartes[0]?.tokens.color?.primary).toBe("#123456");
		expect(decoded.assets).toEqual([]);
	});

	it("strips runtime fields from documents", async () => {
		const doc = makeDoc("with-runtime");
		doc._layout = { overflow: false } as never;
		doc._displayed = true;

		const buf = encodeBundleV1([doc], []);
		const decoded = await decodeBundle(buf);
		const snap = decoded.documents[0] as unknown as Record<string, unknown>;
		expect(snap).toBeDefined();
		expect(snap._layout).toBeUndefined();
		expect(snap._displayed).toBeUndefined();
	});
});

describe("maket-format v2 (ZIP with assets)", () => {
	it("round-trips documents + chartes + asset binaries", async () => {
		const doc = makeDoc("with-assets");
		const charte = makeCharte("brand");
		const asset: BundleAsset = {
			relPath: "logo.png",
			bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		};

		const buf = await encodeBundleV2([doc], [charte], [asset]);
		// ZIP magic bytes
		expect(buf[0]).toBe(0x50);
		expect(buf[1]).toBe(0x4b);
		expect(buf[2]).toBe(0x03);
		expect(buf[3]).toBe(0x04);

		const decoded = await decodeBundle(buf);
		expect(decoded.version).toBe(2);
		expect(decoded.documents[0]?.name).toBe("with-assets");
		expect(decoded.chartes).toHaveLength(1);
		expect(decoded.assets).toHaveLength(1);
		expect(decoded.assets[0]?.relPath).toBe("logo.png");
		expect(decoded.assets[0]?.bytes).toEqual(asset.bytes);
	});

	it("accepts a bundle with no assets", async () => {
		const buf = await encodeBundleV2([makeDoc("lean")], [], []);
		const decoded = await decodeBundle(buf);
		expect(decoded.version).toBe(2);
		expect(decoded.assets).toEqual([]);
	});

	it("is reproducible when generation metadata is fixed", async () => {
		const options = {
			exportedAt: "2000-01-01T00:00:00.000Z",
			entryDate: new Date("2000-01-01T00:00:00.000Z"),
		};
		const document = makeDoc("stable");
		const asset = { relPath: "stable.svg", bytes: Buffer.from("<svg/>") };
		const first = await encodeBundleV2([document], [], [], [asset], options);
		const second = await encodeBundleV2([document], [], [], [asset], options);
		expect(first.equals(second)).toBe(true);
	});

	it("strips entries that escape the assets/ folder", async () => {
		// Forge a v2 ZIP with an entry named `../../etc/passwd` and verify
		// `decodeBundle` drops it rather than returning path-traversal bytes.
		const JSZip = (await import("jszip")).default;
		const zip = new JSZip();
		zip.file(
			"manifest.json",
			JSON.stringify({
				version: 2,
				kind: MAKET_BUNDLE_KIND,
				exportedAt: new Date().toISOString(),
				documents: [],
				chartes: [],
			}),
		);
		zip.file("assets/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		zip.file("assets/../../etc/passwd", Buffer.from("root:x:0:0:"));
		zip.file("assets/sub/nested.png", Buffer.from([0x89, 0x50]));
		const buf = await zip.generateAsync({ type: "nodebuffer" });

		const decoded = await decodeBundle(buf);
		expect(decoded.assets.map((a) => a.relPath)).toEqual(["logo.png"]);
	});
});

describe("decodeBundle dispatch", () => {
	it("rejects a non-gzip non-zip payload", async () => {
		await expect(
			decodeBundle(Buffer.from("plain text long enough")),
		).rejects.toThrow(/unknown magic bytes/);
	});

	it("rejects a too-small buffer", async () => {
		await expect(decodeBundle(Buffer.from([1, 2]))).rejects.toThrow(
			/too small/,
		);
	});

	it("rejects a valid gzip that isn't a maket bundle", async () => {
		const { gzipSync } = await import("node:zlib");
		const buf = gzipSync(
			Buffer.from(JSON.stringify({ kind: "something-else" })),
		);
		await expect(decodeBundle(buf)).rejects.toThrow(/kind/);
	});

	it("rejects a bundle with an unsupported version number", async () => {
		const { gzipSync } = await import("node:zlib");
		const buf = gzipSync(
			Buffer.from(
				JSON.stringify({
					kind: MAKET_BUNDLE_KIND,
					version: 999,
					documents: [],
				}),
			),
		);
		await expect(decodeBundle(buf)).rejects.toThrow(/version/);
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
