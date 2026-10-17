import { useSyncExternalStore } from "react";
import { browserBasePath } from "./lib/browserBasePath";

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	readonly userChoice: Promise<{
		outcome: "accepted" | "dismissed";
		platform: string;
	}>;
}

export type PwaInstallStatus =
	| "browser"
	| "installable"
	| "installing"
	| "installed";

let installPrompt: BeforeInstallPromptEvent | null = null;
let status: PwaInstallStatus = detectInstalled() ? "installed" : "browser";
let initialized = false;
let registrationError: string | null = null;
const listeners = new Set<() => void>();

function detectInstalled(): boolean {
	if (typeof window === "undefined") return false;
	const iosNavigator = navigator as Navigator & { standalone?: boolean };
	return (
		window.matchMedia("(display-mode: standalone)").matches ||
		iosNavigator.standalone === true
	);
}

function publish(nextStatus: PwaInstallStatus): void {
	if (status === nextStatus) return;
	status = nextStatus;
	listeners.forEach((listener) => {
		listener();
	});
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getPwaInstallStatus(): PwaInstallStatus {
	return status;
}

export function usePwaInstallStatus(): PwaInstallStatus {
	return useSyncExternalStore(
		subscribe,
		getPwaInstallStatus,
		getPwaInstallStatus,
	);
}

export function usePwaRegistrationError(): string | null {
	return useSyncExternalStore(
		subscribe,
		() => registrationError,
		() => registrationError,
	);
}

function reportRegistrationError(error: unknown): void {
	registrationError = error instanceof Error ? error.message : String(error);
	listeners.forEach((listener) => {
		listener();
	});
}

/** Re-check the actual served installation resources and retry registration.
 * Passing these checks is not permission to invoke Chrome's install dialog. */
export async function verifyPwaInstallation(): Promise<void> {
	if (window.isSecureContext === false) throw new Error("HTTPS is required.");
	if (!("serviceWorker" in navigator))
		throw new Error("Service workers are unavailable in this browser.");
	if (browserBasePath() !== "")
		throw new Error("The hosting gateway owns installation for this path.");
	const response = await fetch("/manifest.webmanifest", { cache: "no-store" });
	if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
	const manifest = await response.json();
	if (
		!(manifest.name || manifest.short_name) ||
		!manifest.start_url ||
		![
			"standalone",
			"fullscreen",
			"minimal-ui",
			"window-controls-overlay",
		].includes(manifest.display) ||
		manifest.prefer_related_applications === true
	)
		throw new Error(
			"The manifest does not declare an installable web application.",
		);
	for (const size of [192, 512]) {
		const icon = manifest.icons?.find(
			(entry: { sizes?: string; src?: string }) =>
				entry.sizes?.split(/\s+/).includes(`${size}x${size}`),
		);
		if (!icon?.src) throw new Error(`Missing ${size}px installation icon.`);
		const image = await fetch(
			new URL(icon.src, response.url || location.href),
			{ cache: "no-store" },
		);
		if (!image.ok) throw new Error(`Installation icon HTTP ${image.status}`);
	}
	try {
		const registration = await navigator.serviceWorker.register(
			"/service-worker.js",
			{ scope: "/" },
		);
		await registration?.update?.();
		registrationError = null;
		listeners.forEach((listener) => {
			listener();
		});
	} catch (error) {
		reportRegistrationError(error);
		throw error;
	}
}

/** Capture the browser-owned install prompt and register Maket's web-app
 * identity. Native Electron builds already own their application lifecycle. */
export function initializePwa(): () => void {
	if (
		initialized ||
		window.maketDesktop ||
		browserBasePath() !== "" ||
		!new Set(["http:", "https:"]).has(window.location.protocol)
	) {
		return () => undefined;
	}
	initialized = true;

	const beforeInstall = (event: Event) => {
		event.preventDefault();
		installPrompt = event as BeforeInstallPromptEvent;
		publish("installable");
	};
	const installed = () => {
		installPrompt = null;
		publish("installed");
	};
	window.addEventListener("beforeinstallprompt", beforeInstall);
	window.addEventListener("appinstalled", installed);

	if ("serviceWorker" in navigator) {
		void navigator.serviceWorker
			.register("/service-worker.js", { scope: "/" })
			.catch(reportRegistrationError);
	}

	return () => {
		window.removeEventListener("beforeinstallprompt", beforeInstall);
		window.removeEventListener("appinstalled", installed);
		initialized = false;
	};
}

export async function promptPwaInstall(): Promise<void> {
	const prompt = installPrompt;
	if (!prompt) return;
	try {
		await prompt.prompt();
	} catch (error) {
		installPrompt = null;
		publish("browser");
		throw error;
	}
	const choice = await prompt.userChoice;
	installPrompt = null;
	if (status !== "installed")
		publish(choice.outcome === "accepted" ? "installing" : "browser");
}

export function resetPwaForTests(): void {
	registrationError = null;
	installPrompt = null;
	status = detectInstalled() ? "installed" : "browser";
	initialized = false;
	listeners.clear();
}
