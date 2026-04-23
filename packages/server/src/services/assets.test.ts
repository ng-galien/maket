import {
	existsSync,
	mkdirSync,
	mkdtempSync,
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

	// Thumbs are written as .jpg regardless of source ext; readBase64 must
	// normalize the lookup or clients get the full-size blob instead.
	it.each([
		{ source: "pic.png", thumb: "pic.jpg" },
		{ source: "pic.jpg", thumb: "pic.jpg" },
		{ source: "pic.webp", thumb: "pic.jpg" },
		{ source: "pic.gif", thumb: "pic.jpg" },
	])("readBase64 serves the .jpg thumb for $source", ({ source, thumb }) => {
		const thumbBytes = Buffer.from("thumb-bytes");
		writeFileSync(join(dir, source), TINY_PNG);
		mkdirSync(join(dir, "thumbs"));
		writeFileSync(join(dir, "thumbs", thumb), thumbBytes);
		const assets = createAssetsService({ assetsDir: dir });
		const r = assets.readBase64(source);
		expect(r?.mime).toBe("image/jpeg");
		expect(r?.data).toBe(thumbBytes.toString("base64"));
	});

	it("readBase64 skips the thumb when preferThumb is false", () => {
		writeFileSync(join(dir, "pic.png"), TINY_PNG);
		mkdirSync(join(dir, "thumbs"));
		writeFileSync(join(dir, "thumbs", "pic.jpg"), Buffer.from("thumb"));
		const assets = createAssetsService({ assetsDir: dir });
		const r = assets.readBase64("pic.png", false);
		expect(r?.mime).toBe("image/png");
		expect(r?.data).toBe(TINY_PNG.toString("base64"));
	});

	it("remove deletes the .jpg thumb for non-jpg sources", () => {
		writeFileSync(join(dir, "pic.png"), TINY_PNG);
		mkdirSync(join(dir, "thumbs"));
		writeFileSync(join(dir, "thumbs", "pic.jpg"), Buffer.from("thumb"));
		const assets = createAssetsService({ assetsDir: dir });
		assets.remove("pic.png");
		expect(assets.exists("pic.png")).toBe(false);
		expect(existsSync(join(dir, "thumbs", "pic.jpg"))).toBe(false);
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

	it("remove deletes the file + its thumbnail", () => {
		writeFileSync(join(dir, "r.png"), TINY_PNG);
		mkdirSync(join(dir, "thumbs"));
		writeFileSync(join(dir, "thumbs", "r.png"), TINY_PNG);
		const assets = createAssetsService({ assetsDir: dir });
		assets.remove("r.png");
		expect(assets.exists("r.png")).toBe(false);
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
	});
});
