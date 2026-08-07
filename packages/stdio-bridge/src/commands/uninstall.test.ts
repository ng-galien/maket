import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stripMaketSection } from "./_codex-toml.ts";

describe("stripMaketSection", () => {
	it("removes a plain maket block", () => {
		const toml = [
			"[mcp_servers.foo]",
			'command = "x"',
			"",
			"[mcp_servers.maket]",
			'command = "maket"',
			"args = []",
			"",
			"[mcp_servers.bar]",
			'command = "y"',
		].join("\n");
		const out = stripMaketSection(toml);
		expect(out).not.toContain("[mcp_servers.maket]");
		expect(out).toContain("[mcp_servers.foo]");
		expect(out).toContain("[mcp_servers.bar]");
	});

	it("is idempotent when the section is missing", () => {
		const toml = '[mcp_servers.foo]\ncommand = "x"\n';
		expect(stripMaketSection(toml)).toBe(toml);
	});
});

describe("uninstall codex file edit", () => {
	// We don't invoke runUninstall directly (it writes to ~/.codex) but mirror
	// its codex-path logic against stripMaketSection + a temp TOML to prove the
	// shape of the rewrite. Without this, regressions in whitespace handling
	// would accumulate silently across repeat install/uninstall cycles.
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "maket-uninstall-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("normalizes trailing blank lines after strip", () => {
		const src =
			'[foo]\nv = 1\n\n[mcp_servers.maket]\ncommand = "npx"\n\n\n[bar]\nv = 2\n';
		const toml = join(dir, "config.toml");
		writeFileSync(toml, src);

		const stripped = stripMaketSection(readFileSync(toml, "utf-8"));
		const normalized = `${stripped.replace(/\n{3,}$/, "\n\n").replace(/\n+$/, "")}\n`;
		expect(normalized).toMatch(/\n\[bar\]\nv = 2\n$/);
		expect(normalized.endsWith("\n\n\n")).toBe(false);
	});
});
