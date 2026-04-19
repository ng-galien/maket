import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConfig, ensureDirs, loadEnvFile } from "./config.js";

describe("createConfig", () => {
	it("uses MAKET_DATA_DIR when set", () => {
		const cfg = createConfig({
			env: { MAKET_DATA_DIR: "/custom/dir" },
			homedir: () => "/home/u",
		});
		expect(cfg.DATA_DIR).toBe("/custom/dir");
		expect(cfg.ASSETS_DIR).toBe("/custom/dir/assets");
		expect(cfg.DOCS_DIR).toBe("/custom/dir/documents");
		expect(cfg.EXPORTS_DIR).toBe("/custom/dir/exports");
		expect(cfg.DB_PATH).toBe("/custom/dir/documents.db");
	});

	it("falls back to ~/.maket when MAKET_DATA_DIR is absent", () => {
		const cfg = createConfig({
			env: {},
			homedir: () => "/home/u",
		});
		expect(cfg.DATA_DIR).toBe("/home/u/.maket");
	});

	it("respects MAKET_DB override", () => {
		const cfg = createConfig({
			env: { MAKET_DB: "/tmp/custom.db" },
			homedir: () => "/home/u",
		});
		expect(cfg.DB_PATH).toBe("/tmp/custom.db");
	});

	it("APP_TITLE defaults to 'Maket'", () => {
		const cfg = createConfig({ env: {}, homedir: () => "/home/u" });
		expect(cfg.APP_TITLE).toBe("Maket");
	});

	it("APP_TITLE honors MAKET_TITLE", () => {
		const cfg = createConfig({
			env: { MAKET_TITLE: "Custom" },
			homedir: () => "/home/u",
		});
		expect(cfg.APP_TITLE).toBe("Custom");
	});

	it("APP_SUBTITLE defaults to empty string", () => {
		const cfg = createConfig({ env: {}, homedir: () => "/home/u" });
		expect(cfg.APP_SUBTITLE).toBe("");
	});

	it("MAKET_PORT is parsed as number", () => {
		const cfg = createConfig({
			env: { MAKET_PORT: "4000" },
			homedir: () => "/home/u",
		});
		expect(cfg.PORT).toBe(4000);
	});

	it("MAKET_PORT defaults to 24842 when unset", () => {
		const cfg = createConfig({ env: {}, homedir: () => "/home/u" });
		expect(cfg.PORT).toBe(24842);
	});

	it("reads env from process.env by default", () => {
		const prev = process.env.MAKET_TITLE;
		process.env.MAKET_TITLE = "FromProcess";
		try {
			const cfg = createConfig();
			expect(cfg.APP_TITLE).toBe("FromProcess");
		} finally {
			if (prev === undefined) delete process.env.MAKET_TITLE;
			else process.env.MAKET_TITLE = prev;
		}
	});
});

describe("ensureDirs", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "maket-config-"));
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("creates the writable directories if missing", () => {
		const cfg = createConfig({
			env: { MAKET_DATA_DIR: tmp },
			homedir: () => "/nowhere",
		});
		ensureDirs(cfg);
		// Running again is a no-op (no throw)
		ensureDirs(cfg);
	});
});

describe("loadEnvFile", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "maket-env-"));
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("loads a .env from the given project root when present", () => {
		const key = "MAKET_TEST_VAR_FROM_ENV_FILE";
		const prev = process.env[key];
		delete process.env[key];
		writeFileSync(join(tmp, ".env"), `${key}=hello\n`);
		try {
			loadEnvFile(tmp);
			expect(process.env[key]).toBe("hello");
		} finally {
			if (prev === undefined) delete process.env[key];
			else process.env[key] = prev;
		}
	});

	it("is a no-op when .env is absent (no throw)", () => {
		loadEnvFile(tmp);
		// No assertion — just ensure no exception.
	});
});
