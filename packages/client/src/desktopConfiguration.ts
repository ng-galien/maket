import type {
	DesktopConfigurationPlan,
	DesktopOnboardingResult,
	DesktopOnboardingSelection,
	McpConfigurationFinding,
} from "@maket/shared";
import { useSyncExternalStore } from "react";

export interface DesktopConfigurationState {
	status: "idle" | "loading" | "ready" | "applying" | "error";
	plan: DesktopConfigurationPlan | null;
	error?: string;
}

const DEVELOPMENT_STATE: DesktopConfigurationState = {
	status: "idle",
	plan: null,
};
let state = DEVELOPMENT_STATE;
let initialized = false;
const listeners = new Set<() => void>();

export function useDesktopConfiguration(): DesktopConfigurationState {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getDesktopConfigurationState(): DesktopConfigurationState {
	return state;
}

export function initializeDesktopConfiguration(): () => void {
	if (initialized) return () => {};
	initialized = true;
	const configuration = window.maketDesktop?.configuration;
	if (!configuration) {
		publish({ status: "ready", plan: null });
		return resetInitialization;
	}
	publish({ status: "loading", plan: null });
	void configuration.getPlan().then(publishPlan).catch(publishError);
	return resetInitialization;
}

export function configurationActionRequired(
	plan: DesktopConfigurationPlan | null,
): boolean {
	return Boolean(
		plan &&
			(plan.runtime.status === "action-required" ||
				plan.manualClients.some(
					(client) => client.detected && client.status !== "valid",
				) ||
				plan.findings.some(
					(finding) => finding.detected && finding.status !== "valid",
				)),
	);
}

export function configurationNoticeRequired(
	plan: DesktopConfigurationPlan | null,
): boolean {
	return (
		configurationActionRequired(plan) || Boolean(plan?.restartClients.length)
	);
}

export function configurableFindings(
	plan: DesktopConfigurationPlan | null,
): McpConfigurationFinding[] {
	return (
		plan?.findings.filter(
			(finding) => finding.detected && finding.status !== "valid",
		) ?? []
	);
}

export async function applyDesktopOnboarding(
	selection: DesktopOnboardingSelection,
): Promise<DesktopOnboardingResult> {
	const configuration = window.maketDesktop?.configuration;
	if (!configuration)
		throw new Error("Maket Desktop configuration is unavailable");
	publish({ ...state, status: "applying", error: undefined });
	try {
		const result = await configuration.applyOnboarding(selection);
		publishPlan(result.plan);
		return result;
	} catch (error) {
		publishError(error);
		throw error;
	}
}

export async function verifyDesktopOnboarding(): Promise<DesktopConfigurationPlan> {
	const configuration = window.maketDesktop?.configuration;
	if (!configuration)
		throw new Error("Maket Desktop configuration is unavailable");
	publish({ ...state, status: "loading", error: undefined });
	try {
		const plan = await configuration.verifyOnboarding();
		publishPlan(plan);
		return plan;
	} catch (error) {
		publishError(error);
		throw error;
	}
}

export async function activateDesktopRuntime(): Promise<void> {
	const configuration = window.maketDesktop?.configuration;
	if (!configuration) return;
	publish({ ...state, status: "applying", error: undefined });
	try {
		await configuration.activateRuntime();
		await refreshDesktopConfiguration();
	} catch (error) {
		publishError(error);
	}
}

export async function refreshDesktopConfiguration(): Promise<boolean> {
	const configuration = window.maketDesktop?.configuration;
	if (!configuration) return false;
	try {
		publishPlan(await configuration.getPlan());
		return true;
	} catch (error) {
		publishError(error);
		return false;
	}
}

export async function installClaudeDesktopBundle(): Promise<void> {
	const configuration = window.maketDesktop?.configuration;
	if (!configuration)
		throw new Error("Maket Desktop configuration is unavailable");
	await configuration.installClaudeDesktop();
}

export async function acknowledgeDesktopRestarts(): Promise<void> {
	const configuration = window.maketDesktop?.configuration;
	if (!configuration) return;
	try {
		publishPlan(await configuration.acknowledgeRestarts());
	} catch (error) {
		publishError(error);
	}
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function getSnapshot(): DesktopConfigurationState {
	return state;
}

function publishPlan(plan: DesktopConfigurationPlan): void {
	publish({ status: "ready", plan });
}

function publishError(error: unknown): void {
	publish({
		...state,
		status: "error",
		error: error instanceof Error ? error.message : String(error),
	});
}

function publish(next: DesktopConfigurationState): void {
	state = next;
	for (const listener of listeners) listener();
}

function resetInitialization(): void {
	initialized = false;
}

export function resetDesktopConfigurationForTests(): void {
	initialized = false;
	state = DEVELOPMENT_STATE;
	listeners.clear();
}
