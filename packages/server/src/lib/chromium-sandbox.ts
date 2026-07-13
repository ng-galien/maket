/**
 * Decide whether to launch Chromium with `--no-sandbox`.
 *
 * The sandbox is one of Chromium's strongest defences — disabling it turns
 * a renderer-process bug into full host access. We render agent-authored
 * HTML, so disabling the sandbox is exactly the wrong default.
 *
 * However, the sandbox cannot start as root (Linux) and is unavailable in
 * many CI/Docker images. We therefore disable it only when:
 *   - the user explicitly opts in via `MAKET_FORCE_NO_SANDBOX=1`, OR
 *   - we detect a Linux process running as root (sandbox would crash on launch).
 *
 * macOS and Windows always keep the sandbox.
 */

export function shouldDisableSandbox(env = process.env): boolean {
	if (env.MAKET_FORCE_NO_SANDBOX === "1") return true;
	if (process.platform !== "linux") return false;
	if (typeof process.getuid === "function" && process.getuid() === 0) {
		return true;
	}
	return false;
}

/**
 * Headless mode for every Chromium launch.
 *
 * `"shell"` selects chrome-headless-shell, the rasterisation-optimised
 * binary. Unified headless (`headless: true`, Chrome for Testing) hangs on
 * `Page.captureScreenshot` on recent macOS (observed with 146/148 on
 * Darwin 25.2): the CDP call never resolves and the target eventually
 * closes, so every snapshot, thumbnail and layout check stalls. Shell
 * headless does not exhibit the hang and is the puppeteer-recommended
 * mode for screenshot/PDF workloads.
 */
export const CHROMIUM_HEADLESS = "shell" as const;
