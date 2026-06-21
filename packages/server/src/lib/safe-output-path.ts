/**
 * Confine MCP-tool output paths to a safe writable directory.
 *
 * `maket_doc export output=…` and `maket_preview snapshot path=…` both accept
 * a destination from the agent. Without confinement, a prompt-injected agent
 * can persuade Maket to overwrite arbitrary files the user can write
 * (`~/.ssh/authorized_keys`, dotfiles, etc.). All such writes must land
 * under `EXPORTS_DIR` (or any explicitly-allowed root).
 *
 * Returns the resolved absolute path on success, throws otherwise.
 */

import { isAbsolute, resolve, sep } from "node:path";

export function resolveSafeOutputPath(
	requested: string,
	allowedRoot: string,
): string {
	const root = resolve(allowedRoot);
	const candidate = isAbsolute(requested)
		? resolve(requested)
		: resolve(root, requested);
	if (candidate !== root && !candidate.startsWith(root + sep)) {
		throw new Error(
			`Refusing to write outside ${allowedRoot}: ${requested}. ` +
				"Pass a path under that directory, or relative to it.",
		);
	}
	return candidate;
}
