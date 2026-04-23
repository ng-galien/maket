import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAssetsService } from "./assets.js";

/** Minimal valid 1x1 PNG (transparent) — 67 bytes. */
const TINY_PNG = Buffer.from(
	"89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63000100000500010d0a2db40000000049454e44ae426082",
	"hex",
);

describe("createAssetsService", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "maket-assets-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("listFilenames returns only recognized image extensions", () => {
		writeFileSync(join(dir, "a.png"), TINY_PNG);
		writeFileSync(join(dir, "b.jpg"), TINY_PNG);
		writeFileSync(join(dir, "c.txt"), "not an image");
		mkdirSync(join(dir, "thumbs")); // subdirectory ignored

		const assets = createAssetsService({ assetsDir: dir });
		expect(assets.listFilenames().sort()).toEqual(["a.png", "b.jpg"]);
	});

	it("resolveSafePath rejects path traversal", () => {
		const assets = createAssetsService({ assetsDir: dir });
		expect(assets.resolveSafePath("../evil")).toBeNull();
		expect(assets.resolveSafePath("sub/../../escape")).toBeNull();
	});

	it("resolveSafePath accepts a filename inside the dir", () => {
		const assets = createAssetsService({ assetsDir: dir });
		const p = assets.resolveSafePath("foo.png");
		expect(p).toBe(join(dir, "foo.png"));
	});

	it("exists returns true only for files inside the dir", () => {
		writeFileSync(join(dir, "here.png"), TINY_PNG);
		const assets = createAssetsService({ assetsDir: dir });
		expect(assets.exists("here.png")).toBe(true);
		expect(assets.exists("missing.png")).toBe(false);
		expect(assets.exists("../escape")).toBe(false);
	});

	it("mimeFromExt maps common extensions", () => {
		const assets = createAssetsService({ assetsDir: dir });
		expect(assets.mimeFromExt("a.png")).toBe("image/png");
		expect(assets.mimeFromExt("a.jpg")).toBe("image/jpeg");
		expect(assets.mimeFromExt("a.svg")).toBe("image/svg+xml");
		expect(assets.mimeFromExt("a.unknown")).toBe("image/png"); // fallback
	});

	it("readBase64 returns b64 + mime for an existing file", () => {
		writeFileSync(join(dir, "pic.png"), TINY_PNG);
		const assets = createAssetsService({ assetsDir: dir });
		const r = assets.readBase64("pic.png");
		expect(r).not.toBeNull();
		expect(r?.mime).toBe("image/png");
		expect(r?.data).toBe(TINY_PNG.toString("base64"));
	});

	it("readBase64 returns null when file is missing", () => {
		const assets = createAssetsService({ assetsDir: dir });
		expect(assets.readBase64("ghost.png")).toBeNull();
	});

	// Thumbs live under <source-filename>.thumb.jpg so assets that differ
	// only by extension (logo.png + logo.jpg) each get their own thumb.
	it.each([
		"pic.png",
		"pic.jpg",
		"pic.webp",
		"pic.gif",
	])("readBase64 serves the .thumb.jpg for %s", (source) => {
		const thumbBytes = Buffer.from("thumb-bytes");
		writeFileSync(join(dir, source), TINY_PNG);
		mkdirSync(join(dir, "thumbs"));
		writeFileSync(join(dir, "thumbs", `${source}.thumb.jpg`), thumbBytes);
		const assets = createAssetsService({ assetsDir: dir });
		const r = assets.readBase64(source);
		expect(r?.mime).toBe("image/jpeg");
		expect(r?.data).toBe(thumbBytes.toString("base64"));
	});

	it("readBase64 does not collide between same-basename different-ext assets", () => {
		const pngThumb = Buffer.from("png-thumb");
		const jpgThumb = Buffer.from("jpg-thumb");
		writeFileSync(join(dir, "logo.png"), TINY_PNG);
		writeFileSync(join(dir, "logo.jpg"), TINY_PNG);
		mkdirSync(join(dir, "thumbs"));
		writeFileSync(join(dir, "thumbs", "logo.png.thumb.jpg"), pngThumb);
		writeFileSync(join(dir, "thumbs", "logo.jpg.thumb.jpg"), jpgThumb);
		const assets = createAssetsService({ assetsDir: dir });
		expect(assets.readBase64("logo.png")?.data).toBe(
			pngThumb.toString("base64"),
		);
		expect(assets.readBase64("logo.jpg")?.data).toBe(
			jpgThumb.toString("base64"),
		);
	});

	it("readBase64 skips the thumb when preferThumb is false", () => {
		writeFileSync(join(dir, "pic.png"), TINY_PNG);
		mkdirSync(join(dir, "thumbs"));
		writeFileSync(join(dir, "thumbs", "pic.png.thumb.jpg"), Buffer.from("t"));
		const assets = createAssetsService({ assetsDir: dir });
		const r = assets.readBase64("pic.png", false);
		expect(r?.mime).toBe("image/png");
		expect(r?.data).toBe(TINY_PNG.toString("base64"));
	});

	it("remove deletes the .thumb.jpg sibling", () => {
		writeFileSync(join(dir, "pic.png"), TINY_PNG);
		mkdirSync(join(dir, "thumbs"));
		writeFileSync(join(dir, "thumbs", "pic.png.thumb.jpg"), Buffer.from("t"));
		const assets = createAssetsService({ assetsDir: dir });
		assets.remove("pic.png");
		expect(assets.exists("pic.png")).toBe(false);
		expect(existsSync(join(dir, "thumbs", "pic.png.thumb.jpg"))).toBe(false);
	});

	describe("migrateLegacyThumbs", () => {
		it("renames legacy <base>.jpg thumbs to <source>.thumb.jpg", () => {
			writeFileSync(join(dir, "logo.png"), TINY_PNG);
			mkdirSync(join(dir, "thumbs"));
			const legacy = Buffer.from("legacy");
			writeFileSync(join(dir, "thumbs", "logo.jpg"), legacy);
			const assets = createAssetsService({ assetsDir: dir });
			const stats = assets.migrateLegacyThumbs();
			expect(stats).toEqual({ migrated: 1, orphansDeleted: 0, ambiguous: 0 });
			expect(existsSync(join(dir, "thumbs", "logo.jpg"))).toBe(false);
			expect(
				readFileSync(join(dir, "thumbs", "logo.png.thumb.jpg")).toString(),
			).toBe("legacy");
		});

		it("deletes orphan thumbs whose source is gone", () => {
			mkdirSync(join(dir, "thumbs"));
			writeFileSync(join(dir, "thumbs", "ghost.jpg"), Buffer.from("orphan"));
			const assets = createAssetsService({ assetsDir: dir });
			const stats = assets.migrateLegacyThumbs();
			expect(stats).toEqual({ migrated: 0, orphansDeleted: 1, ambiguous: 0 });
			expect(existsSync(join(dir, "thumbs", "ghost.jpg"))).toBe(false);
		});

		it("leaves the legacy thumb in place when the basename is ambiguous", () => {
			writeFileSync(join(dir, "logo.png"), TINY_PNG);
			writeFileSync(
				join(dir, "logo.jpg"),
				Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
			);
			mkdirSync(join(dir, "thumbs"));
			writeFileSync(join(dir, "thumbs", "logo.jpg"), Buffer.from("shared"));
			const assets = createAssetsService({ assetsDir: dir });
			const stats = assets.migrateLegacyThumbs();
			expect(stats).toEqual({ migrated: 0, orphansDeleted: 0, ambiguous: 1 });
			expect(existsSync(join(dir, "thumbs", "logo.jpg"))).toBe(true);
		});

		it("is idempotent and ignores already-migrated thumbs", () => {
			writeFileSync(join(dir, "pic.png"), TINY_PNG);
			mkdirSync(join(dir, "thumbs"));
			writeFileSync(
				join(dir, "thumbs", "pic.png.thumb.jpg"),
				Buffer.from("already-new"),
			);
			const assets = createAssetsService({ assetsDir: dir });
			expect(assets.migrateLegacyThumbs()).toEqual({
				migrated: 0,
				orphansDeleted: 0,
				ambiguous: 0,
			});
			expect(assets.migrateLegacyThumbs()).toEqual({
				migrated: 0,
				orphansDeleted: 0,
				ambiguous: 0,
			});
		});

		it("is a no-op when the thumbs dir does not exist", () => {
			const assets = createAssetsService({ assetsDir: dir });
			expect(assets.migrateLegacyThumbs()).toEqual({
				migrated: 0,
				orphansDeleted: 0,
				ambiguous: 0,
			});
		});

		// Regression: a pre-v1.1.0 source whose basename ended in `.thumb`
		// produced a legacy thumb named `<base>.thumb.jpg`, which looks like a
		// new-convention thumb. The migration must still rename it.
		it("migrates legacy thumbs from sources whose basename ends in .thumb", () => {
			writeFileSync(join(dir, "foo.thumb.png"), TINY_PNG);
			mkdirSync(join(dir, "thumbs"));
			writeFileSync(
				join(dir, "thumbs", "foo.thumb.jpg"),
				Buffer.from("legacy"),
			);
			const assets = createAssetsService({ assetsDir: dir });
			const stats = assets.migrateLegacyThumbs();
			expect(stats).toEqual({ migrated: 1, orphansDeleted: 0, ambiguous: 0 });
			expect(existsSync(join(dir, "thumbs", "foo.thumb.jpg"))).toBe(false);
			expect(existsSync(join(dir, "thumbs", "foo.thumb.png.thumb.jpg"))).toBe(
				true,
			);
		});

		// Regression: on case-sensitive filesystems the synthesized candidate
		// (lowercase ext) could not find a source with an uppercase ext, so the
		// legacy thumb was wrongly unlinked as orphan.
		it("matches sources with case-preserving filenames (PIC.PNG)", () => {
			writeFileSync(join(dir, "PIC.PNG"), TINY_PNG);
			mkdirSync(join(dir, "thumbs"));
			writeFileSync(join(dir, "thumbs", "PIC.jpg"), Buffer.from("legacy"));
			const assets = createAssetsService({ assetsDir: dir });
			const stats = assets.migrateLegacyThumbs();
			expect(stats).toEqual({ migrated: 1, orphansDeleted: 0, ambiguous: 0 });
			expect(existsSync(join(dir, "thumbs", "PIC.PNG.thumb.jpg"))).toBe(true);
		});

		it("counts a legacy thumb cleaned up by an existing new thumb as an orphan, not a migration", () => {
			writeFileSync(join(dir, "logo.png"), TINY_PNG);
			mkdirSync(join(dir, "thumbs"));
			writeFileSync(
				join(dir, "thumbs", "logo.png.thumb.jpg"),
				Buffer.from("already-new"),
			);
			writeFileSync(join(dir, "thumbs", "logo.jpg"), Buffer.from("stale"));
			const assets = createAssetsService({ assetsDir: dir });
			const stats = assets.migrateLegacyThumbs();
			expect(stats).toEqual({ migrated: 0, orphansDeleted: 1, ambiguous: 0 });
			expect(existsSync(join(dir, "thumbs", "logo.jpg"))).toBe(false);
		});
	});

	it("imageToken returns a 16-char hex string for an existing file", () => {
		writeFileSync(join(dir, "tok.png"), TINY_PNG);
		const assets = createAssetsService({ assetsDir: dir });
		const token = assets.imageToken("tok.png");
		expect(token).toMatch(/^[a-f0-9]{16}$/);
	});

	it("imageToken returns null for a missing file", () => {
		const assets = createAssetsService({ assetsDir: dir });
		expect(assets.imageToken("ghost.png")).toBeNull();
	});

	it("importFromLocal copies a file into the assets dir", async () => {
		const src = join(dir, "source.png");
		writeFileSync(src, TINY_PNG);
		const otherDir = mkdtempSync(join(tmpdir(), "maket-other-"));
		try {
			const dest = join(otherDir, "copy.png");
			writeFileSync(dest, TINY_PNG);
			const assets = createAssetsService({ assetsDir: dir });
			await assets.importFromLocal(dest, "imported.png", false);
			expect(assets.exists("imported.png")).toBe(true);
		} finally {
			rmSync(otherDir, { recursive: true, force: true });
		}
	});

	it("importFromLocal refuses overwrite by default", async () => {
		writeFileSync(join(dir, "exists.png"), TINY_PNG);
		const src = mkdtempSync(join(tmpdir(), "maket-src-"));
		try {
			const srcFile = join(src, "src.png");
			writeFileSync(srcFile, TINY_PNG);
			const assets = createAssetsService({ assetsDir: dir });
			await expect(
				assets.importFromLocal(srcFile, "exists.png", false),
			).rejects.toThrow(/already exists/);
		} finally {
			rmSync(src, { recursive: true, force: true });
		}
	});

	it("getDimensions reads PNG header", () => {
		writeFileSync(join(dir, "tiny.png"), TINY_PNG);
		const assets = createAssetsService({ assetsDir: dir });
		expect(assets.getDimensions("tiny.png")).toEqual({ w: 1, h: 1 });
	});

	describe("validateImageFile", () => {
		it("accepts a valid PNG", () => {
			writeFileSync(join(dir, "ok.png"), TINY_PNG);
			const assets = createAssetsService({ assetsDir: dir });
			expect(assets.validateImageFile("ok.png")).toEqual({ valid: true });
		});

		it("rejects a text file renamed to .png", () => {
			writeFileSync(join(dir, "fake.png"), "this is not a png");
			const assets = createAssetsService({ assetsDir: dir });
			const result = assets.validateImageFile("fake.png");
			expect(result.valid).toBe(false);
			expect(result.reason).toMatch(/PNG/);
		});

		it("rejects an empty file", () => {
			writeFileSync(join(dir, "empty.png"), "");
			const assets = createAssetsService({ assetsDir: dir });
			const result = assets.validateImageFile("empty.png");
			expect(result.valid).toBe(false);
			expect(result.reason).toMatch(/[Ee]mpty/);
		});

		it("rejects a missing file", () => {
			const assets = createAssetsService({ assetsDir: dir });
			expect(assets.validateImageFile("ghost.png").valid).toBe(false);
		});

		it("accepts a JPEG with proper magic bytes", () => {
			writeFileSync(
				join(dir, "ok.jpg"),
				Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]),
			);
			const assets = createAssetsService({ assetsDir: dir });
			expect(assets.validateImageFile("ok.jpg")).toEqual({ valid: true });
		});

		it("accepts a minimal SVG", () => {
			writeFileSync(
				join(dir, "ok.svg"),
				'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
			);
			const assets = createAssetsService({ assetsDir: dir });
			expect(assets.validateImageFile("ok.svg")).toEqual({ valid: true });
		});

		it("rejects an SVG-named text file that is not XML/SVG", () => {
			writeFileSync(join(dir, "fake.svg"), "hello world");
			const assets = createAssetsService({ assetsDir: dir });
			expect(assets.validateImageFile("fake.svg").valid).toBe(false);
		});

		it("rejects unknown extensions with a supported-format hint", () => {
			writeFileSync(join(dir, "oops.bmp"), Buffer.from([0x42, 0x4d]));
			const assets = createAssetsService({ assetsDir: dir });
			const result = assets.validateImageFile("oops.bmp");
			expect(result.valid).toBe(false);
			expect(result.reason).toMatch(/Unsupported format/);
		});

		// Adobe Illustrator + Inkscape + Wikipedia emit self-closing or empty
		// <foreignObject> tags as benign export artifacts. Rejecting them
		// blanket-blocks the dominant SVG-in-the-wild shape, so we only flag
		// non-empty ones.
		it.each([
			[
				"illustrator flow placeholder (self-closing)",
				'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject height="1" width="1" requiredExtensions="http://ns.adobe.com/Flows/1.0/"/></svg>',
			],
			[
				"empty <foreignObject></foreignObject>",
				'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject></foreignObject></svg>',
			],
			[
				"whitespace-only <foreignObject>",
				'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject>   \n  </foreignObject></svg>',
			],
		])("accepts SVG with %s", (_label, svg) => {
			writeFileSync(join(dir, "ok.svg"), svg);
			const assets = createAssetsService({ assetsDir: dir });
			expect(assets.validateImageFile("ok.svg")).toEqual({ valid: true });
		});

		it("rejects SVG with non-empty <foreignObject> (HTML payload)", () => {
			writeFileSync(
				join(dir, "bad.svg"),
				'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>hi</div></foreignObject></svg>',
			);
			const assets = createAssetsService({ assetsDir: dir });
			const result = assets.validateImageFile("bad.svg");
			expect(result.valid).toBe(false);
			expect(result.reason).toMatch(/foreignObject/);
		});
	});

	describe("optimize (SVG)", () => {
		const MINIMAL_SVG = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#00f"/></svg>`;

		it("rasterizes an SVG into <filename>.thumb.png and returns natural dims", async () => {
			writeFileSync(join(dir, "logo.svg"), MINIMAL_SVG);
			const assets = createAssetsService({ assetsDir: dir });
			const dims = await assets.optimize("logo.svg");
			expect(dims).toEqual({ w: 120, h: 80 });
			const thumb = join(dir, "thumbs", "logo.svg.thumb.png");
			expect(existsSync(thumb)).toBe(true);
			// PNG magic bytes — confirms we wrote a raster, not the SVG source.
			const head = readFileSync(thumb).subarray(0, 4);
			expect(Array.from(head)).toEqual([0x89, 0x50, 0x4e, 0x47]);
		});

		it("readBase64 serves the SVG thumb as image/png", async () => {
			writeFileSync(join(dir, "logo.svg"), MINIMAL_SVG);
			const assets = createAssetsService({ assetsDir: dir });
			await assets.optimize("logo.svg");
			const r = assets.readBase64("logo.svg");
			expect(r?.mime).toBe("image/png");
		});

		it("hasThumb reflects whether the rasterized thumb exists", async () => {
			writeFileSync(join(dir, "logo.svg"), MINIMAL_SVG);
			const assets = createAssetsService({ assetsDir: dir });
			expect(assets.hasThumb("logo.svg")).toBe(false);
			await assets.optimize("logo.svg");
			expect(assets.hasThumb("logo.svg")).toBe(true);
		});

		it("returns null and writes no thumb when the SVG is malformed", async () => {
			writeFileSync(join(dir, "bad.svg"), "<svg not closed");
			const assets = createAssetsService({ assetsDir: dir });
			const dims = await assets.optimize("bad.svg");
			expect(dims).toBeNull();
			expect(existsSync(join(dir, "thumbs", "bad.svg.thumb.png"))).toBe(false);
		});
	});
});
