import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url));
const REPO_ROOT = dirname(dirname(dirname(dirname(ENTRY))));

describe("maket CLI global options", () => {
	let dataDir: string;

	beforeEach(() => {
		dataDir = mkdtempSync(join(tmpdir(), "maket-cli-options-"));
	});

	afterEach(() => {
		rmSync(dataDir, { recursive: true, force: true });
	});

	it("honors --port over MAKET_PORT at the executable boundary", () => {
		const result = spawnSync(
			process.execPath,
			[
				"--import",
				"tsx",
				ENTRY,
				"config",
				"--port",
				"25942",
				"--data-dir",
				dataDir,
			],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: { ...process.env, MAKET_PORT: "24842" },
			},
		);

		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/^port\s+25942$/m);
		expect(result.stdout).toMatch(new RegExp(`^dataDir\\s+${dataDir}$`, "m"));
	});

	it("keeps MAKET_PORT when another global option is passed without --port", () => {
		const result = spawnSync(
			process.execPath,
			["--import", "tsx", ENTRY, "config", "--data-dir", dataDir],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: { ...process.env, MAKET_PORT: "25941" },
			},
		);

		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/^port\s+25941$/m);
		expect(result.stdout).toMatch(new RegExp(`^dataDir\\s+${dataDir}$`, "m"));
	});

	it.each(["nope", "0", "-1", "1.5", "65536", "Infinity"])(
		"rejects an unusable --port value before dispatch: %s",
		(port) => {
			const result = spawnSync(
				process.execPath,
				[
					"--import",
					"tsx",
					ENTRY,
					"status",
					`--port=${port}`,
					"--data-dir",
					dataDir,
				],
				{
					cwd: REPO_ROOT,
					encoding: "utf8",
					env: { ...process.env, MAKET_PORT: "24842" },
				},
			);

			expect(result.status).toBe(1);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe(
				"maket: --port must be an integer between 1 and 65535\n",
			);
		},
	);

	it("reports a concise parser error for a separated negative --port", () => {
		const result = spawnSync(
			process.execPath,
			[
				"--import",
				"tsx",
				ENTRY,
				"status",
				"--port",
				"-1",
				"--data-dir",
				dataDir,
			],
			{ cwd: REPO_ROOT, encoding: "utf8" },
		);

		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe("maket: Unknown option `-1`\n");
	});
});
