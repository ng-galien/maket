import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inlineImages } from "./image-inline.js";

function withTmp(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "maket-inline-"));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const TINY_PNG_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("inlineImages", () => {
	it("leaves html untouched when no /assets/ reference is present", async () => {
		const { dir, cleanup } = withTmp();
		const html = '<p>no images here <span data-id="x">hi</span></p>';
		const out = await inlineImages(html, {
			assetsDir: dir,
			pageMm: { w: 210, h: 297 },
			dpi: 96,
			mimeFromExt: () => "application/octet-stream",
		});
		expect(out).toBe(html);
		cleanup();
	});

	it("replaces /assets/foo.png with a base64 data URI", async () => {
		const { dir, cleanup } = withTmp();
		writeFileSync(join(dir, "foo.png"), Buffer.from(TINY_PNG_B64, "base64"));
		const out = await inlineImages('<img src="/assets/foo.png">', {
			assetsDir: dir,
			pageMm: { w: 210, h: 297 },
			dpi: 96,
			mimeFromExt: () => "image/png",
		});
		expect(out).toMatch(/^<img src="data:image\/png;base64,/);
		expect(out).not.toContain("/assets/foo.png");
		cleanup();
	});

	it("inlines svg as image/svg+xml", async () => {
		const { dir, cleanup } = withTmp();
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
		writeFileSync(join(dir, "i.svg"), svg);
		const out = await inlineImages('<img src="/assets/i.svg">', {
			assetsDir: dir,
			pageMm: { w: 210, h: 297 },
			dpi: 96,
			mimeFromExt: () => "image/svg+xml",
		});
		expect(out).toMatch(/^<img src="data:image\/svg\+xml;base64,/);
		cleanup();
	});

	it("leaves missing /assets/ paths untouched (caller decides what to do)", async () => {
		const { dir, cleanup } = withTmp();
		const html = '<img src="/assets/missing.png">';
		const out = await inlineImages(html, {
			assetsDir: dir,
			pageMm: { w: 210, h: 297 },
			dpi: 96,
			mimeFromExt: () => "image/png",
		});
		expect(out).toBe(html);
		cleanup();
	});

	it("handles duplicate references in a single pass", async () => {
		const { dir, cleanup } = withTmp();
		writeFileSync(join(dir, "dup.png"), Buffer.from(TINY_PNG_B64, "base64"));
		const html = '<img src="/assets/dup.png"><img src="/assets/dup.png">';
		const out = await inlineImages(html, {
			assetsDir: dir,
			pageMm: { w: 210, h: 297 },
			dpi: 96,
			mimeFromExt: () => "image/png",
		});
		const matches = out.match(/data:image\/png;base64,/g) ?? [];
		expect(matches.length).toBe(2);
		expect(out).not.toContain("/assets/dup.png");
		cleanup();
	});
});
