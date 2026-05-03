import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDocument } from "../types.js";
import { collectAssetFilenames, loadAssetsFromDir } from "./asset-collector.js";

describe("collectAssetFilenames", () => {
	it("finds /assets/ refs in page HTML (dedup, multi-page, multi-doc)", () => {
		const a = createDocument({
			name: "a",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					name: "p1",
					elements: [],
					html: `<img src="/assets/logo.png"><img src="/assets/photo.jpg">`,
				},
				{
					name: "p2",
					elements: [],
					html: `<div style="background-image:url(/assets/bg.svg)"></div>`,
				},
			],
		});
		const b = createDocument({
			name: "b",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					name: "p1",
					elements: [],
					html: `<img src="/assets/logo.png">`, // duplicate
				},
			],
		});

		const refs = collectAssetFilenames([a, b]);
		expect(refs.sort()).toEqual(["bg.svg", "logo.png", "photo.jpg"]);
	});

	it("ignores absolute URLs and data: URIs", () => {
		const d = createDocument({
			name: "d",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					name: "p1",
					elements: [],
					html: `<img src="https://cdn.example/foo.png"><img src="data:image/png;base64,xxx">`,
				},
			],
		});
		expect(collectAssetFilenames([d])).toEqual([]);
	});

	it("ignores refs with unsupported extensions", () => {
		const d = createDocument({
			name: "d",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					name: "p1",
					elements: [],
					html: `<a href="/assets/doc.pdf">pdf</a>`,
				},
			],
		});
		expect(collectAssetFilenames([d])).toEqual([]);
	});
});

describe("loadAssetsFromDir", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "maket-assets-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("reads files present on disk, reports missing ones", () => {
		writeFileSync(join(dir, "logo.png"), Buffer.from([0x89, 0x50]));
		writeFileSync(join(dir, "bg.svg"), "<svg/>");

		const { assets, missing } = loadAssetsFromDir(
			["logo.png", "bg.svg", "ghost.jpg"],
			dir,
		);
		expect(assets.map((a) => a.relPath).sort()).toEqual(["bg.svg", "logo.png"]);
		expect(missing).toEqual(["ghost.jpg"]);
	});

	it("rejects paths with separators (defensive)", () => {
		writeFileSync(join(dir, "logo.png"), Buffer.from([0x89]));
		const { assets, missing } = loadAssetsFromDir(
			["../etc/passwd", "sub/logo.png"],
			dir,
		);
		expect(assets).toEqual([]);
		expect(missing).toEqual(["../etc/passwd", "sub/logo.png"]);
	});
});
