import { describe, expect, it } from "vitest";
import { resolveMaketRuntime } from "./_runtime-command.ts";

describe("resolveMaketRuntime", () => {
	it("uses absolute Node and package entry paths for an installed bundle", () => {
		const entry = "/prefix/bin/maket-server";
		const realEntry =
			"/prefix/lib/node_modules/@ng-galien/maket-server/index.js";
		const present = new Set([
			realEntry,
			"/prefix/lib/node_modules/@ng-galien/maket-server/server.js",
		]);

		expect(
			resolveMaketRuntime({
				commandPath: "/stable/node",
				entryPath: entry,
				realpath: () => realEntry,
				exists: (path) => present.has(path),
			}),
		).toEqual({ command: "/stable/node", args: [realEntry] });
	});

	it("falls back to PATH for source-tree execution", () => {
		expect(
			resolveMaketRuntime({
				execPath: "/absolute/node",
				entryPath: "/repo/packages/stdio-bridge/src/index.ts",
				realpath: (path) => path,
				exists: (path) => path.endsWith("index.ts"),
			}),
		).toEqual({ command: "maket-server", args: [] });
	});
});
