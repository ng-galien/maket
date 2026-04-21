/**
 * `maket open` — open the Maket UI in the system browser.
 */

import { spawn } from "node:child_process";
import { platform } from "node:os";
import { readEnv } from "./_env.ts";

export function runOpen(): void {
	const env = readEnv();
	const url = env.url;
	const opener =
		platform() === "darwin"
			? ["open", url]
			: platform() === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	const [bin, ...args] = opener;
	if (!bin) return;
	spawn(bin, args, { stdio: "ignore", detached: true }).unref();
	process.stdout.write(`maket: opened ${url}\n`);
}
