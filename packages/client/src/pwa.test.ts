import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getPwaInstallStatus,
	initializePwa,
	promptPwaInstall,
	resetPwaForTests,
	verifyPwaInstallation,
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

	it("leaves installation and service worker ownership to a hosting gateway", () => {
		document.head.insertAdjacentHTML(
			"beforeend",
			'<meta name="maket-base-path" content="/mobile/apps/maket" />',
		);
		try {
			initializePwa();
			expect(register).not.toHaveBeenCalled();
		} finally {
			document.querySelector('meta[name="maket-base-path"]')?.remove();
		}
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
		expect(getPwaInstallStatus()).toBe("installing");
		window.dispatchEvent(new Event("appinstalled"));
		expect(getPwaInstallStatus()).toBe("installed");
		dispose();
	});

	it("does not register inside the Electron shell", () => {
		window.maketDesktop = {} as Window["maketDesktop"];

		initializePwa();

		expect(register).not.toHaveBeenCalled();
	});
	it("reports registration failure and retries after resources recover", async () => {
		register.mockRejectedValueOnce(new Error("Service worker HTTP 404"));
		const dispose = initializePwa();
		await Promise.resolve();
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url) =>
				String(url).includes("manifest")
					? new Response(
							JSON.stringify({
								name: "Maket",
								start_url: "/",
								display: "standalone",
								icons: [
									{ src: "/icon-192.png", sizes: "192x192" },
									{ src: "/icon-512.png", sizes: "512x512" },
								],
							}),
						)
					: new Response("icon"),
			),
		);
		try {
			await verifyPwaInstallation();
			expect(register).toHaveBeenCalledTimes(2);
			expect(getPwaInstallStatus()).toBe("browser");
		} finally {
			vi.unstubAllGlobals();
			dispose();
		}
	});

	it("does not conceal a failed installation resource", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("Unavailable", { status: 503 })),
		);
		try {
			await expect(verifyPwaInstallation()).rejects.toThrow(
				"Manifest HTTP 503",
			);
			expect(register).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
