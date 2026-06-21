/**
 * Shared fs-safety helpers for commands that mutate user config files
 * (`install`, `uninstall`). Extracted so both sides write and unwrite
 * through the same guard rails.
 */

import { chmodSync, copyFileSync, existsSync, lstatSync } from "node:fs";

export function backup(path: string): void {
	if (!existsSync(path)) return;
	const dest = `${path}.bak.${Date.now()}`;
	copyFileSync(path, dest);
	try {
		chmodSync(dest, 0o600);
	} catch {}
	process.stdout.write(`maket: backed up ${path} → ${dest}\n`);
}

/**
 * Refuse to operate on a symlink. Without this, a hostile local actor could
 * pre-create `~/.claude.json` as a symlink to `/etc/passwd` (or any file the
 * current user can write) and our `writeFileSync` would follow it.
 */
export function refuseSymlink(path: string): boolean {
	if (!existsSync(path)) return false;
	try {
		if (lstatSync(path).isSymbolicLink()) {
			process.stderr.write(
				`maket: refusing to write — ${path} is a symlink. Resolve it manually first.\n`,
			);
			process.exitCode = 1;
			return true;
		}
	} catch {}
	return false;
}
