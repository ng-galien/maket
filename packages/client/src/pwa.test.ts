import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getPwaInstallStatus,
	initializePwa,
	promptPwaInstall,
	resetPwaForTests,
} from "./pwa";

describe("PWA installation", () => {
	const register = vi.fn(async () => undefined);

	beforeEach(() => {
		delete window.maketDesktop;
		resetPwaForTests();
		register.mockClear();
		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: { register },
		});
	});

	afterEach(() => {
		resetPwaForTests();
		Reflect.deleteProperty(navigator, "serviceWorker");
	});

	it("registers the local web application identity", () => {
		const dispose = initializePwa();

		expect(register).toHaveBeenCalledWith("/service-worker.js", { scope: "/" });
		dispose();
	});

	it("captures and runs Chromium's explicit install prompt", async () => {
		const nativePrompt = vi.fn(async () => undefined);
		const event = new Event("beforeinstallprompt", { cancelable: true });
		Object.defineProperties(event, {
			prompt: { value: nativePrompt },
			userChoice: {
				value: Promise.resolve({ outcome: "accepted", platform: "web" }),
			},
		});
		const dispose = initializePwa();

		window.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		expect(getPwaInstallStatus()).toBe("installable");

		await promptPwaInstall();
		expect(nativePrompt).toHaveBeenCalledOnce();
		expect(getPwaInstallStatus()).toBe("installed");
		dispose();
	});

	it("does not register inside the Electron shell", () => {
		window.maketDesktop = {} as Window["maketDesktop"];

		initializePwa();

		expect(register).not.toHaveBeenCalled();
	});
});
