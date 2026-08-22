import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { binPath } from "./_bin.ts";

export interface McpRuntimeCommand {
	command: string;
	args: string[];
}

export interface RuntimeCommandOptions {
	execPath?: string;
	commandPath?: string;
	entryPath?: string;
	exists?: (path: string) => boolean;
	realpath?: (path: string) => string;
}

/**
 * Resolve a GUI-safe command for the currently installed Maket package.
 * Packaged installs have `index.js` and `server.js` side by side; source-tree
 * execution deliberately falls back to `maket` because raw TypeScript cannot
 * be launched by Node without the development runtime.
 */
export function resolveMaketRuntime(
	opts: RuntimeCommandOptions = {},
): McpRuntimeCommand {
	const exists = opts.exists ?? existsSync;
	const realpath = opts.realpath ?? realpathSync;
	const rawEntry = opts.entryPath ?? process.argv[1];
	if (!rawEntry) return { command: "maket-server", args: [] };

	try {
		const entry = realpath(resolve(rawEntry));
		if (exists(entry) && exists(join(dirname(entry), "server.js"))) {
			return {
				command:
					opts.commandPath ??
					binPath("node") ??
					opts.execPath ??
					process.execPath,
				args: [entry],
			};
		}
	} catch {}
	return { command: "maket-server", args: [] };
}
