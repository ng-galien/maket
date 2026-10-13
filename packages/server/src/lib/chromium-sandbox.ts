/**
 * Decide whether to launch Chromium with `--no-sandbox`.
 *
 * The sandbox is one of Chromium's strongest defences — disabling it turns
 * a renderer-process bug into full host access. We render agent-authored
 * HTML, so disabling the sandbox is exactly the wrong default.
 *
 * However, the sandbox cannot start as root (Linux), is unavailable in
 * many CI/Docker images, and needs unprivileged user namespaces on Linux.
 * We therefore disable it only when:
 *   - the user explicitly opts in via `MAKET_FORCE_NO_SANDBOX=1`, OR
 *   - Chromium runs on an ephemeral Linux CI worker, OR
 *   - we detect a Linux process running as root (sandbox would crash on launch), OR
 *   - the Linux kernel disables or restricts unprivileged user namespaces, OR
 *   - a first launch fails with "No usable sandbox" (`launchWithSandboxFallback`).
 *
 * macOS and Windows always keep the sandbox unless explicitly opted out.
 */

import { readFileSync } from "node:fs";

export interface SandboxHost {
	platform: NodeJS.Platform;
	uid: number | null;
	/** Contents of a kernel file, or null when it cannot be read. */
	readFile(path: string): string | null;
}

export interface SandboxDecision {
	disable: boolean;
	reason: string | null;
}

export const NO_USABLE_SANDBOX_MESSAGE = "No usable sandbox";

const USER_NAMESPACE_BLOCKERS: ReadonlyArray<{
	path: string;
	blockedWhen: string;
	reason: string;
}> = [
	{
		path: "/proc/sys/kernel/unprivileged_userns_clone",
		blockedWhen: "0",
		reason:
			"unprivileged user namespaces are disabled (kernel.unprivileged_userns_clone=0)",
	},
	{
		path: "/proc/sys/user/max_user_namespaces",
		blockedWhen: "0",
		reason: "user namespaces are disabled (user.max_user_namespaces=0)",
	},
	{
		path: "/proc/sys/kernel/apparmor_restrict_unprivileged_userns",
		blockedWhen: "1",
		reason:
			"AppArmor restricts unprivileged user namespaces (kernel.apparmor_restrict_unprivileged_userns=1)",
	},
];

export function processSandboxHost(): SandboxHost {
	return {
		platform: process.platform,
		uid: typeof process.getuid === "function" ? process.getuid() : null,
		readFile: (path) => {
			try {
				return readFileSync(path, "utf8");
			} catch {
				return null;
			}
		},
	};
}

export function decideSandbox(
	env: NodeJS.ProcessEnv = process.env,
	host: SandboxHost = processSandboxHost(),
): SandboxDecision {
	if (env.MAKET_FORCE_NO_SANDBOX === "1") {
		return { disable: true, reason: "MAKET_FORCE_NO_SANDBOX=1" };
	}
	if (host.platform !== "linux") return { disable: false, reason: null };
	if (env.GITHUB_ACTIONS === "true" || env.CI === "true" || env.CI === "1") {
		return { disable: true, reason: "Linux CI worker" };
	}
	if (host.uid === 0) return { disable: true, reason: "running as root" };
	for (const blocker of USER_NAMESPACE_BLOCKERS) {
		if (host.readFile(blocker.path)?.trim() === blocker.blockedWhen) {
			return { disable: true, reason: blocker.reason };
		}
	}
	return { disable: false, reason: null };
}

export function shouldDisableSandbox(
	env: NodeJS.ProcessEnv = process.env,
	host: SandboxHost = processSandboxHost(),
): boolean {
	return decideSandbox(env, host).disable;
}

function isNoUsableSandboxError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes(NO_USABLE_SANDBOX_MESSAGE);
}

export interface SandboxLaunchOptions {
	env?: NodeJS.ProcessEnv;
	host?: SandboxHost;
	log?: (line: string) => void;
}

/**
 * Launch Chromium with the sandbox unless `decideSandbox` disables it; when
 * the sandboxed launch fails with "No usable sandbox", relaunch once with
 * `--no-sandbox`. Each disabled launch logs one line with the reason.
 */
export async function launchWithSandboxFallback<T>(
	launch: (args: string[]) => Promise<T>,
	options: SandboxLaunchOptions = {},
): Promise<T> {
	const log = options.log ?? ((line: string) => console.warn(line));
	const decision = decideSandbox(options.env, options.host);
	if (decision.disable) {
		log(`[maket] Chromium sandbox disabled: ${decision.reason}`);
		return launch(["--no-sandbox"]);
	}
	try {
		return await launch([]);
	} catch (error) {
		if (!isNoUsableSandboxError(error)) throw error;
		log(
			`[maket] Chromium sandbox disabled: the sandboxed launch failed with "${NO_USABLE_SANDBOX_MESSAGE}", relaunching once with --no-sandbox`,
		);
		return launch(["--no-sandbox"]);
	}
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
