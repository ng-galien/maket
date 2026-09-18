import { useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	readonly userChoice: Promise<{
		outcome: "accepted" | "dismissed";
		platform: string;
	}>;
}

export type PwaInstallStatus = "browser" | "installable" | "installed";

let installPrompt: BeforeInstallPromptEvent | null = null;
let status: PwaInstallStatus = detectInstalled() ? "installed" : "browser";
let initialized = false;
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

/** Capture the browser-owned install prompt and register Maket's web-app
 * identity. Native Electron builds already own their application lifecycle. */
export function initializePwa(): () => void {
	if (
		initialized ||
		window.maketDesktop ||
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
			.catch(() => undefined);
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
	await prompt.prompt();
	const choice = await prompt.userChoice;
	installPrompt = null;
	publish(choice.outcome === "accepted" ? "installed" : "browser");
}

export function resetPwaForTests(): void {
	installPrompt = null;
	status = detectInstalled() ? "installed" : "browser";
	initialized = false;
	listeners.clear();
}
