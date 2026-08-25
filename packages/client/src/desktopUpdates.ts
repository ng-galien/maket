import type { DesktopUpdateChannel, DesktopUpdateState } from "@maket/shared";
import { useSyncExternalStore } from "react";

// Outside the desktop shell there is no updater at all: report it with the
// translated reason instead of leaking an English message into the UI.
const DEVELOPMENT_STATE: DesktopUpdateState = {
	status: "unavailable",
	channel: "stable",
	currentVersion: "",
	reason: "development-build",
};

let state = DEVELOPMENT_STATE;
let initialized = false;
let removeDesktopListener: (() => void) | null = null;
const listeners = new Set<() => void>();

export function useDesktopUpdates(): DesktopUpdateState {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getDesktopUpdateState(): DesktopUpdateState {
	return state;
}

export function initializeDesktopUpdates(): () => void {
	if (initialized) return () => {};
	initialized = true;
	const updates = window.maketDesktop?.updates;
	if (!updates) {
		return () => {
			initialized = false;
		};
	}
	removeDesktopListener = updates.onState(publish);
	void updates.getState().then(publish).catch(publishError);
	return () => {
		removeDesktopListener?.();
		removeDesktopListener = null;
		initialized = false;
	};
}

export async function selectDesktopUpdateChannel(
	channel: DesktopUpdateChannel,
): Promise<void> {
	if (
		state.status === "checking" ||
		state.status === "downloading" ||
		state.status === "ready"
	) {
		return;
	}
	const updates = window.maketDesktop?.updates;
	if (!updates) {
		publish({ ...DEVELOPMENT_STATE, channel });
		return;
	}
	publish({
		...state,
		channel,
		status: "idle",
		version: undefined,
		progress: undefined,
	});
	try {
		publish(await updates.setChannel(channel));
	} catch (error) {
		publishError(error);
	}
}

export async function checkDesktopUpdates(): Promise<void> {
	const updates = window.maketDesktop?.updates;
	if (!updates) {
		publish({ ...DEVELOPMENT_STATE, channel: state.channel });
		return;
	}
	publish({
		...state,
		status: "checking",
		message: undefined,
		reason: undefined,
	});
	try {
		await updates.check();
	} catch (error) {
		publishError(error);
	}
}

export async function installDesktopUpdate(): Promise<void> {
	try {
		await window.maketDesktop?.updates.install();
	} catch (error) {
		publishError(error);
	}
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function getSnapshot(): DesktopUpdateState {
	return state;
}

function publish(next: DesktopUpdateState): void {
	state = next;
	for (const listener of listeners) listener();
}

function publishError(error: unknown): void {
	publish({
		...state,
		status: "error",
		reason: undefined,
		message: error instanceof Error ? error.message : String(error),
	});
}

export function resetDesktopUpdatesForTests(): void {
	removeDesktopListener?.();
	removeDesktopListener = null;
	initialized = false;
	state = DEVELOPMENT_STATE;
	listeners.clear();
}
