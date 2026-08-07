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
			documents: [{ name: "a", canvas: { w: 10, h: 10 }, pages: [] }],
		});
		expect(data.version).toBe(2);
		expect(data.exportedAt).toBe("");
		expect(data.chartes).toEqual([]);
		expect(data.collections).toEqual([]);
		expect(data.documentStates).toEqual([]);
	});

	it("rejects documents that would crash a reader after hydration", () => {
		expect(() =>
			validateBundleManifest({
				kind: MAKET_BUNDLE_KIND,
				version: 2,
				documents: [{ name: "broken" }],
			}),
		).toThrow(/canvas needs positive w\/h/);
		expect(() =>
			validateBundleManifest({
				kind: MAKET_BUNDLE_KIND,
				version: 2,
				documents: [
					{
						name: "broken",
						canvas: { w: 10, h: 10 },
						pages: [{ html: 42 }],
					},
				],
			}),
		).toThrow(/html is not text/);
	});

	it("rejects malformed chartes and collections", () => {
		const doc = { name: "a", canvas: { w: 10, h: 10 }, pages: [] };
		expect(() =>
			validateBundleManifest({
				kind: MAKET_BUNDLE_KIND,
				version: 2,
				documents: [doc],
				chartes: [null],
			}),
		).toThrow(/chartes\[0\] is malformed/);
		expect(() =>
			validateBundleManifest({
				kind: MAKET_BUNDLE_KIND,
				version: 2,
				documents: [doc],
				collections: [{ name: "c", schema: {}, members: [{}] }],
			}),
		).toThrow(/members\[0\] is malformed/);
	});

	it("keeps duplicate document names for the server import renamer", () => {
		const doc = { name: "a", canvas: { w: 10, h: 10 }, pages: [] };
		const data = validateBundleManifest({
			kind: MAKET_BUNDLE_KIND,
			version: 2,
			documents: [doc, { ...doc }],
		});
		expect(data.documents).toHaveLength(2);
	});

	it("validates a current snapshot for each state-backed document", () => {
		const stateDoc = {
			id: "doc-state",
			name: "checklist",
			dataModel: "state",
			canvas: { w: 10, h: 10 },
			pages: [
				{
					id: "page-1",
					html: "<h1>{{ state.title }}</h1>",
				},
			],
		};
		const data = validateBundleManifest({
			kind: MAKET_BUNDLE_KIND,
			version: 2,
			documents: [stateDoc],
			documentStates: [
				{
					documentId: "doc-state",
					schema: {
						type: "object",
						properties: { title: { type: "string" } },
						required: ["title"],
					},
					data: { title: "Ready" },
				},
			],
		});
		expect(data.documentStates).toEqual([
			expect.objectContaining({
				documentId: "doc-state",
				data: { title: "Ready" },
			}),
		]);
	});

	it("rejects missing, orphaned, and invalid document-state snapshots", () => {
		const stateDoc = {
			id: "doc-state",
			name: "checklist",
			dataModel: "state",
			canvas: { w: 10, h: 10 },
			pages: [{ id: "page-1", html: "{{ state.title }}" }],
		};
		expect(() =>
			validateBundleManifest({
				kind: MAKET_BUNDLE_KIND,
				version: 2,
				documents: [stateDoc],
			}),
		).toThrow(/has no current state snapshot/);
		expect(() =>
			validateBundleManifest({
				kind: MAKET_BUNDLE_KIND,
				version: 2,
				documents: [{ ...stateDoc, dataModel: "static" }],
				documentStates: [{ documentId: "doc-state", schema: {}, data: {} }],
			}),
		).toThrow(/does not reference a state-backed document/);
		expect(() =>
			validateBundleManifest({
				kind: MAKET_BUNDLE_KIND,
				version: 2,
				documents: [stateDoc],
				documentStates: [
					{
						documentId: "doc-state",
						schema: {
							type: "object",
							properties: { title: { type: "string" } },
							required: ["title"],
						},
						data: { title: 42 },
					},
				],
			}),
		).toThrow(/must be string/);
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
			[{ name: "doc", canvas: { w: 10, h: 10 }, pages: [] }],
			[{ name: "charte" }],
			[],
			{ version: 2, exportedAt: "2026-01-01T00:00:00.000Z" },
		);
		const data = validateBundleManifest(manifest as Record<string, unknown>);
		expect(data.documents).toHaveLength(1);
		expect(data.chartes).toHaveLength(1);
		expect(data.exportedAt).toBe("2026-01-01T00:00:00.000Z");
	});

	it("builds a portable state snapshot without revision history", () => {
		const manifest = buildBundleManifest(
			[
				{
					id: "doc-state",
					name: "checklist",
					dataModel: "state",
					canvas: { w: 10, h: 10 },
					pages: [{ id: "page-1", html: "{{ state.done }}" }],
				},
			],
			[],
			[],
			{
				version: 2,
				exportedAt: "2026-01-01T00:00:00.000Z",
				documentStates: [
					{
						documentId: "doc-state",
						schema: {
							type: "object",
							properties: { done: { type: "boolean" } },
							required: ["done"],
						},
						data: { done: true },
					},
				],
			},
		);
		expect(manifest.documentStates).toEqual([
			expect.not.objectContaining({ revision: expect.anything() }),
		]);
	});
});
