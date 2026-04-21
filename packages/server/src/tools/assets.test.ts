import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssetsService } from "../services/assets.js";
import { createBus } from "../services/bus.js";
import { createSQLiteStore, type Store } from "../services/store.js";
import { assetsPack, createMaketImageTool } from "./assets.js";

/** 1x1 transparent PNG. */
const TINY_PNG = Buffer.from(
	"89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63000100000500010d0a2db40000000049454e44ae426082",
	"hex",
);

function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "maket-plugin-assets-"));
	const store: Store = createSQLiteStore(":memory:");
	const bus = createBus();
	const assets = createAssetsService({ assetsDir: dir });
	return { dir, store, bus, assets };
}

const NO_EXTRA = {} as any;

describe("assetsPack — registration", () => {
	it("declares id and deps", () => {
		expect(assetsPack.id).toBe("assets");
		expect(assetsPack.requires).toEqual(
			expect.arrayContaining(["store", "bus", "assets"]),
		);
	});
});

describe("maket_image — action=list", () => {
	it("returns 'No images' when the dir is empty", async () => {
		const { store, bus, assets } = fixture();
		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler({ action: "list" }, NO_EXTRA);
		expect((res.content[0] as any).text).toBe("No images");
		store.close();
	});

	it("groups assets by category + flags items with no metadata", async () => {
		const { dir, store, bus, assets } = fixture();
		writeFileSync(join(dir, "a.png"), TINY_PNG);
		writeFileSync(join(dir, "b.png"), TINY_PNG);
		store.saveAsset({ filename: "a.png", title: "Alpha", category: "hero" });
		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler({ action: "list" }, NO_EXTRA);
		const text = (res.content[0] as any).text as string;
		expect(text).toMatch(/Alpha/);
		expect(text).toMatch(/no metadata/);
		expect(text).toMatch(/hero/);
		store.close();
	});

	it("filters by category", async () => {
		const { dir, store, bus, assets } = fixture();
		writeFileSync(join(dir, "a.png"), TINY_PNG);
		store.saveAsset({ filename: "a.png", category: "hero" });
		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler(
			{ action: "list", category: "other" },
			NO_EXTRA,
		);
		expect((res.content[0] as any).text).toMatch(/No assets in category/);
		store.close();
	});
});

describe("maket_image — action=view", () => {
	it("returns base64 + metadata text for an existing asset", async () => {
		const { dir, store, bus, assets } = fixture();
		writeFileSync(join(dir, "pic.png"), TINY_PNG);
		store.saveAsset({
			filename: "pic.png",
			title: "Picture",
			description: "A test",
		});
		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler(
			{ action: "view", filename: "pic.png" },
			NO_EXTRA,
		);
		expect(res.content).toHaveLength(2);
		const textPart = res.content[0] as any;
		const imgPart = res.content[1] as any;
		expect(textPart.text).toMatch(/Picture/);
		expect(imgPart.type).toBe("image");
		expect(imgPart.mimeType).toBe("image/png");
		store.close();
	});

	it("errors for a missing asset", async () => {
		const { store, bus, assets } = fixture();
		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler(
			{ action: "view", filename: "ghost.png" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(/not found/i);
		store.close();
	});

	it("errors when filename is missing", async () => {
		const { store, bus, assets } = fixture();
		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler({ action: "view" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("refuses to return bytes for a file that fails image validation (session-killer guard)", async () => {
		const { dir, store, bus, assets } = fixture();
		writeFileSync(join(dir, "fake.png"), "not a real png");
		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler(
			{ action: "view", filename: "fake.png" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(/Cannot view/);
		// No inline image — otherwise the Anthropic API would 400 and kill the session.
		expect(res.content).toHaveLength(1);
		store.close();
	});
});

describe("maket_image — action=meta (context_token invariant)", () => {
	it("requires a token when a token currently exists", async () => {
		const { dir, store, bus, assets } = fixture();
		writeFileSync(join(dir, "tok.png"), TINY_PNG);
		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler(
			{ action: "meta", filename: "tok.png", title: "no-token" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(/Token required/);
		store.close();
	});

	it("saves metadata when the provided token matches", async () => {
		const { dir, store, bus, assets } = fixture();
		writeFileSync(join(dir, "tok.png"), TINY_PNG);
		const token = assets.imageToken("tok.png");
		expect(token).not.toBeNull();

		const listener = vi.fn();
		bus.on("assets:changed", listener);

		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler(
			{
				action: "meta",
				filename: "tok.png",
				title: "Updated",
				context_token: token,
			},
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(store.loadAsset("tok.png")?.title).toBe("Updated");
		expect(listener).toHaveBeenCalledTimes(1);
		store.close();
	});
});

describe("maket_image — action=delete", () => {
	it("removes file + store entry and emits assets:changed", async () => {
		const { dir, store, bus, assets } = fixture();
		writeFileSync(join(dir, "gone.png"), TINY_PNG);
		store.saveAsset({ filename: "gone.png", title: "Gone" });

		const listener = vi.fn();
		bus.on("assets:changed", listener);

		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler(
			{ action: "delete", filename: "gone.png" },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(assets.exists("gone.png")).toBe(false);
		expect(store.loadAsset("gone.png")).toBeNull();
		expect(listener).toHaveBeenCalledTimes(1);
		store.close();
	});

	it("errors when the file is missing", async () => {
		const { store, bus, assets } = fixture();
		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler(
			{ action: "delete", filename: "ghost.png" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_image — action=import", () => {
	let srcDir: string;
	beforeEach(() => {
		srcDir = mkdtempSync(join(tmpdir(), "maket-import-src-"));
	});
	afterEach(() => {
		rmSync(srcDir, { recursive: true, force: true });
	});

	it("copies a local source, optimizes, and saves metadata", async () => {
		const { dir, store, bus, assets } = fixture();
		const src = join(srcDir, "source.png");
		writeFileSync(src, TINY_PNG);

		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler(
			{ action: "import", path: src, title: "Imported" },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(assets.exists("source.png")).toBe(true);
		expect(store.loadAsset("source.png")?.title).toBe("Imported");
		store.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("errors when neither source nor filename is provided", async () => {
		const { store, bus, assets } = fixture();
		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler({ action: "import" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when the local source does not exist", async () => {
		const { store, bus, assets } = fixture();
		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler(
			{ action: "import", path: "/nowhere/missing.png" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("rejects an invalid PNG at import and discards the copied file", async () => {
		const { dir, store, bus, assets } = fixture();
		const src = join(srcDir, "fake.png");
		writeFileSync(src, "this is definitely not a png");

		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler(
			{ action: "import", path: src, title: "should-fail" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(/Import rejected/);
		expect(assets.exists("fake.png")).toBe(false);
		expect(store.loadAsset("fake.png")).toBeNull();
		store.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("rejects register-mode for an invalid on-disk file but leaves the file in place", async () => {
		const { dir, store, bus, assets } = fixture();
		writeFileSync(join(dir, "corrupt.png"), "garbage");

		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler(
			{ action: "import", filename: "corrupt.png", title: "nope" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(/left in place/);
		expect(assets.exists("corrupt.png")).toBe(true);
		expect(store.loadAsset("corrupt.png")).toBeNull();
		store.close();
	});

	it("register-mode persists metadata for an already-on-disk asset", async () => {
		const { dir, store, bus, assets } = fixture();
		mkdirSync(join(dir, "thumbs"), { recursive: true });
		writeFileSync(join(dir, "existing.png"), TINY_PNG);

		const tool = createMaketImageTool({ store, bus, assets });
		const res = await tool.handler(
			{ action: "import", filename: "existing.png", title: "Pre-existing" },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(store.loadAsset("existing.png")?.title).toBe("Pre-existing");
		store.close();
	});
});
