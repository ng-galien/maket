import { spawnSync } from "node:child_process";

/** True if `bin` is on PATH. Uses `which`/`where` so it's cross-platform. */
export function hasBin(bin: string): boolean {
	const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], {
		stdio: "ignore",
	});
	return r.status === 0;
}
