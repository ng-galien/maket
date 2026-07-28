import { describe, expect, it } from "vitest";
import {
	buildBundleManifest,
	isGzipMagic,
	isSafeAssetEntry,
	isZipMagic,
	MAKET_BUNDLE_KIND,
	parseBundleManifest,
	snapshotBundleDocument,
	validateBundleManifest,
} from "./maket-bundle.js";

describe("magic bytes", () => {
	it("recognizes zip and gzip signatures", () => {
		expect(isZipMagic(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
		expect(isGzipMagic(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))).toBe(true);
		expect(isZipMagic(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))).toBe(false);
		expect(isGzipMagic(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
	});
});

describe("isSafeAssetEntry", () => {
	it("accepts flat filenames under assets/ only", () => {
		expect(isSafeAssetEntry("assets/logo.png")).toBe(true);
		expect(isSafeAssetEntry("assets/")).toBe(false);
		expect(isSafeAssetEntry("assets/../../etc/passwd")).toBe(false);
		expect(isSafeAssetEntry("assets/sub/dir.png")).toBe(false);
		expect(isSafeAssetEntry("assets/win\\path.png")).toBe(false);
		expect(isSafeAssetEntry("other/logo.png")).toBe(false);
	});
});

describe("manifest parse + validate", () => {
	it("rejects non-JSON, non-object, wrong kind, bad version, missing docs", () => {
		expect(() => parseBundleManifest("{nope")).toThrow(/JSON parse failed/);
		expect(() => parseBundleManifest("[1]")).toThrow(/not an object/);
		expect(() => validateBundleManifest({ kind: "zip" })).toThrow(/kind=/);
		expect(() =>
			validateBundleManifest({ kind: MAKET_BUNDLE_KIND, version: 99 }),
		).toThrow(/Unsupported .maket bundle version 99/);
		expect(() =>
			validateBundleManifest({ kind: MAKET_BUNDLE_KIND, version: 2 }),
		).toThrow(/missing documents/);
	});

	it("normalizes optional arrays and exportedAt", () => {
		const data = validateBundleManifest({
			kind: MAKET_BUNDLE_KIND,
			version: 2,
			documents: [{ name: "a" }],
		});
		expect(data.version).toBe(2);
		expect(data.exportedAt).toBe("");
		expect(data.chartes).toEqual([]);
		expect(data.collections).toEqual([]);
	});
});

describe("manifest building", () => {
	it("picks wire fields and drops runtime-only ones", () => {
		const snap = snapshotBundleDocument({
			id: "d1",
			name: "doc",
			canvas: { w: 10, h: 10 },
			meta: { charte: "c" },
			pages: [
				{
					id: "p1",
					name: "P",
					elements: [],
					html: "<b>x</b>",
					_layout: { secret: true },
				},
			],
			activePage: 0,
			nextId: 7,
		});
		expect(snap.category).toBe("general");
		expect(snap.nextId).toBe(7);
		expect((snap.pages as Record<string, unknown>[])[0]).not.toHaveProperty(
			"_layout",
		);
	});

	it("round-trips through validateBundleManifest", () => {
		const manifest = buildBundleManifest(
			[{ name: "doc", pages: [] }],
			[{ name: "charte" }],
			[],
			{ version: 2, exportedAt: "2026-01-01T00:00:00.000Z" },
		);
		const data = validateBundleManifest(manifest as Record<string, unknown>);
		expect(data.documents).toHaveLength(1);
		expect(data.chartes).toHaveLength(1);
		expect(data.exportedAt).toBe("2026-01-01T00:00:00.000Z");
	});
});
