/**
 * `maket restart` — stop (if running) then start. A no-op stop (nothing
 * running) is not an error, so we clear `exitCode` before running start.
 */

import type { MaketEnvOverrides } from "./_env.ts";
import { runStart } from "./start.ts";
import { runStop } from "./stop.ts";

export async function runRestart(
	overrides: MaketEnvOverrides = {},
): Promise<void> {
	await runStop(overrides);
	process.exitCode = 0;
	await runStart(overrides);
}
