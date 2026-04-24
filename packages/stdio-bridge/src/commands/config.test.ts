import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runConfig } from "./config.ts";

describe("runConfig", () => {
	let dir: string;
	let stdout: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "maket-config-"));
		stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	});

	afterEach(() => {
		stdout.mockRestore();
		rmSync(dir, { recursive: true, force: true });
	});

	function captured(): string {
		return stdout.mock.calls.map((c: unknown[]) => String(c[0])).join("");
	}

	it("prints aligned key/value pairs and resolves dataDir from overrides", () => {
		runConfig({ dataDir: dir, port: 12345, host: "0.0.0.0" });
		const out = captured();
		expect(out).toMatch(/^version\s+\S+/m);
		expect(out).toMatch(/^node\s+\S+/m);
		expect(out).toMatch(new RegExp(`^dataDir\\s+${dir}$`, "m"));
		expect(out).toMatch(/^host\s+0\.0\.0\.0$/m);
		expect(out).toMatch(/^port\s+12345$/m);
	});

	it("reports gmail state based on files under dataDir", () => {
		writeFileSync(join(dir, "google-credentials.json"), "{}");
		writeFileSync(
			join(dir, "google-token.json"),
			JSON.stringify({ with_read: true }),
		);
		runConfig({ dataDir: dir });
		expect(captured()).toMatch(/^gmail\s+configured \(read: yes\)$/m);
	});

	it("marks gmail as not configured when files are missing", () => {
		runConfig({ dataDir: dir });
		expect(captured()).toMatch(/^gmail\s+not configured$/m);
	});
});
