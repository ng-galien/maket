import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeBundleAssets } from "./asset-writer.js";

describe("writeBundleAssets", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "maket-writer-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("writes new asset files", () => {
		const result = writeBundleAssets(
			[
				{ relPath: "logo.png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
				{ relPath: "bg.svg", bytes: Buffer.from("<svg/>") },
			],
			dir,
		);
		expect(result.written).toBe(2);
		expect(result.skipped).toBe(0);
		expect(existsSync(join(dir, "logo.png"))).toBe(true);
		expect(existsSync(join(dir, "bg.svg"))).toBe(true);
	});

	it("skips when the target already exists (preserves local copy)", () => {
		const existingBytes = Buffer.from("local-version");
		writeFileSync(join(dir, "logo.png"), existingBytes);

		const result = writeBundleAssets(
			[{ relPath: "logo.png", bytes: Buffer.from("bundle-version") }],
			dir,
		);
		expect(result.written).toBe(0);
		expect(result.skipped).toBe(1);
		expect(readFileSync(join(dir, "logo.png"))).toEqual(existingBytes);
	});

	it("rejects unsafe paths (defense in depth past decodeV2)", () => {
		const result = writeBundleAssets(
			[
				{ relPath: "../outside.png", bytes: Buffer.from([0]) },
				{ relPath: "sub/nested.png", bytes: Buffer.from([0]) },
				{ relPath: "", bytes: Buffer.from([0]) },
			],
			dir,
		);
		expect(result.written).toBe(0);
		expect(result.rejected.length).toBe(3);
		expect(existsSync(join(dir, "..", "outside.png"))).toBe(false);
	});

	it("creates the target dir if missing", () => {
		const fresh = join(dir, "not-there-yet");
		const result = writeBundleAssets(
			[{ relPath: "a.png", bytes: Buffer.from([0x89]) }],
			fresh,
		);
		expect(result.written).toBe(1);
		expect(existsSync(join(fresh, "a.png"))).toBe(true);
	});

	it("handles empty input without touching the fs", () => {
		const result = writeBundleAssets([], dir);
		expect(result).toEqual({ written: 0, skipped: 0, rejected: [] });
	});
});
