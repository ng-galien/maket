/**
 * `maket restart` — stop (tolerant of no-op) then start.
 *
 * `runStop` leaves `process.exitCode` untouched when nothing was running,
 * and sets it to 1 for real failures (invalid PID file, kill failed, port
 * still busy, orphan server with no PID file). We short-circuit on those
 * so `restart` never silently masks a broken stop.
 */

import type { MaketEnvOverrides } from "./_env.ts";
import { runStart } from "./start.ts";
import { runStop } from "./stop.ts";

export async function runRestart(
	overrides: MaketEnvOverrides = {},
): Promise<void> {
	await runStop(overrides);
	if (process.exitCode) return;
	await runStart(overrides);
}
