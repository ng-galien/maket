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
	// On Linux, the namespace sandbox refuses to start as uid 0. There is no
	// general way to make it work — running as root is itself a smell, but if
	// the user is doing it (typical Docker), fall back to no-sandbox so the
	// service boots at all. Non-root Linux keeps the sandbox.
	if (typeof process.getuid === "function" && process.getuid() === 0) {
		return true;
	}
	return false;
}
