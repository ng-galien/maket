import { describe, expect, it, vi } from "vitest";
import {
	CHROMIUM_HEADLESS,
	decideSandbox,
	launchWithSandboxFallback,
	type SandboxHost,
	shouldDisableSandbox,
} from "./chromium-sandbox.js";

function host(
	overrides: Partial<Omit<SandboxHost, "readFile">> & {
		files?: Record<string, string>;
	} = {},
): SandboxHost {
	const files = overrides.files ?? {};
	return {
		platform: overrides.platform ?? "linux",
		uid: overrides.uid ?? 1000,
		readFile: (path) => files[path] ?? null,
	};
}

describe("CHROMIUM_HEADLESS", () => {
	it("uses chrome-headless-shell for render workloads", () => {
		expect(CHROMIUM_HEADLESS).toBe("shell");
	});
});

describe("shouldDisableSandbox", () => {
	it("honors the explicit opt-out env flag", () => {
		expect(shouldDisableSandbox({ MAKET_FORCE_NO_SANDBOX: "1" })).toBe(true);
	});

	it("keeps the sandbox outside Linux by default", () => {
		const platform = vi
			.spyOn(process, "platform", "get")
			.mockReturnValue("darwin");
		expect(shouldDisableSandbox({})).toBe(false);
		platform.mockRestore();
	});

	it("disables the sandbox on Linux when running as root", () => {
		const platform = vi
			.spyOn(process, "platform", "get")
			.mockReturnValue("linux");
		const getuid = vi.spyOn(process, "getuid").mockReturnValue(0);
		expect(shouldDisableSandbox({})).toBe(true);
		getuid.mockRestore();
		platform.mockRestore();
	});

	it("disables the sandbox on an ephemeral Linux CI worker", () => {
		expect(shouldDisableSandbox({ GITHUB_ACTIONS: "true" }, host())).toBe(true);
		expect(shouldDisableSandbox({ CI: "true" }, host())).toBe(true);
	});

	it("keeps the sandbox on Linux for non-root users with user namespaces", () => {
		expect(
			decideSandbox(
				{},
				host({
					files: {
						"/proc/sys/kernel/unprivileged_userns_clone": "1\n",
						"/proc/sys/user/max_user_namespaces": "63445\n",
						"/proc/sys/kernel/apparmor_restrict_unprivileged_userns": "0\n",
					},
				}),
			),
		).toEqual({ disable: false, reason: null });
	});

	it("keeps the sandbox on Linux when the kernel files are unreadable", () => {
		expect(shouldDisableSandbox({}, host())).toBe(false);
	});

	it("disables the sandbox when unprivileged user namespaces are disabled", () => {
		expect(
			decideSandbox(
				{},
				host({
					files: { "/proc/sys/kernel/unprivileged_userns_clone": "0\n" },
				}),
			),
		).toEqual({
			disable: true,
			reason:
				"unprivileged user namespaces are disabled (kernel.unprivileged_userns_clone=0)",
		});
	});

	it("disables the sandbox when user namespaces are capped at zero", () => {
		expect(
			decideSandbox(
				{},
				host({ files: { "/proc/sys/user/max_user_namespaces": "0\n" } }),
			),
		).toEqual({
			disable: true,
			reason: "user namespaces are disabled (user.max_user_namespaces=0)",
		});
	});

	it("disables the sandbox when AppArmor restricts unprivileged user namespaces", () => {
		expect(
			decideSandbox(
				{},
				host({
					files: {
						"/proc/sys/kernel/apparmor_restrict_unprivileged_userns": "1\n",
					},
				}),
			),
		).toEqual({
			disable: true,
			reason:
				"AppArmor restricts unprivileged user namespaces (kernel.apparmor_restrict_unprivileged_userns=1)",
		});
	});

	it("ignores the Linux kernel files on macOS", () => {
		expect(
			shouldDisableSandbox(
				{},
				host({
					platform: "darwin",
					files: {
						"/proc/sys/kernel/apparmor_restrict_unprivileged_userns": "1",
					},
				}),
			),
		).toBe(false);
	});
});

describe("launchWithSandboxFallback", () => {
	it("launches with the sandbox and logs nothing when the host provides one", async () => {
		const launch = vi.fn(async (args: string[]) => args);
		const log = vi.fn();

		await expect(
			launchWithSandboxFallback(launch, { env: {}, host: host(), log }),
		).resolves.toEqual([]);
		expect(launch).toHaveBeenCalledTimes(1);
		expect(log).not.toHaveBeenCalled();
	});

	it("launches with --no-sandbox and logs the reason when the decision disables it", async () => {
		const launch = vi.fn(async (args: string[]) => args);
		const log = vi.fn();

		await expect(
			launchWithSandboxFallback(launch, {
				env: {},
				host: host({
					files: {
						"/proc/sys/kernel/apparmor_restrict_unprivileged_userns": "1",
					},
				}),
				log,
			}),
		).resolves.toEqual(["--no-sandbox"]);
		expect(launch).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith(
			"[maket] Chromium sandbox disabled: AppArmor restricts unprivileged user namespaces (kernel.apparmor_restrict_unprivileged_userns=1)",
		);
	});

	it("relaunches once with --no-sandbox after a 'No usable sandbox' failure", async () => {
		const launch = vi.fn(async (args: string[]) => {
			if (args.length === 0) {
				throw new Error(
					"Failed to launch the browser process: Code: null\n\nstderr:\n[FATAL:content/browser/zygote_host/zygote_host_impl_linux.cc:128] No usable sandbox!",
				);
			}
			return args;
		});
		const log = vi.fn();

		await expect(
			launchWithSandboxFallback(launch, { env: {}, host: host(), log }),
		).resolves.toEqual(["--no-sandbox"]);
		expect(launch.mock.calls).toEqual([[[]], [["--no-sandbox"]]]);
		expect(log).toHaveBeenCalledTimes(1);
		expect(log.mock.calls[0]?.[0]).toContain("No usable sandbox");
	});

	it("does not relaunch after any other launch failure", async () => {
		const launch = vi.fn(async () => {
			throw new Error("Could not find Chrome");
		});
		const log = vi.fn();

		await expect(
			launchWithSandboxFallback(launch, { env: {}, host: host(), log }),
		).rejects.toThrow("Could not find Chrome");
		expect(launch).toHaveBeenCalledTimes(1);
		expect(log).not.toHaveBeenCalled();
	});

	it("relaunches only once when the unsandboxed launch fails too", async () => {
		const launch = vi.fn(async () => {
			throw new Error("No usable sandbox!");
		});

		await expect(
			launchWithSandboxFallback(launch, {
				env: {},
				host: host(),
				log: () => {},
			}),
		).rejects.toThrow("No usable sandbox");
		expect(launch).toHaveBeenCalledTimes(2);
	});
});
