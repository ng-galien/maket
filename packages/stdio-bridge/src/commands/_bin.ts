import { spawnSync } from "node:child_process";

/** Absolute first match for `bin` on PATH, or null when absent. */
export function binPath(bin: string): string | null {
	const result = spawnSync(
		process.platform === "win32" ? "where" : "which",
		[bin],
		{ encoding: "utf-8" },
	);
	if (result.status !== 0) return null;
	return result.stdout.split(/\r?\n/, 1)[0]?.trim() || null;
}

/** True if `bin` is on PATH. Uses `which`/`where` so it's cross-platform. */
export function hasBin(bin: string): boolean {
	return binPath(bin) !== null;
}
