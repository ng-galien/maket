import type {
	DesktopConfigurationPlan,
	DesktopUpdateState,
} from "@maket/shared";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { DesktopConfigurationState } from "./desktopConfiguration";
import { useSettingsNotices } from "./settingsNotices";

afterEach(cleanup);

const plan: DesktopConfigurationPlan = {
	endpoint: "http://localhost/mcp",
	onboardingRequired: false,
	awaitingClaudeDesktop: false,
	runtime: { status: "ready" },
	findings: [],
	manualClients: [],
	restartClients: ["codex", "gemini"],
};
const configuration: DesktopConfigurationState = { status: "ready", plan };
const update: DesktopUpdateState = {
	status: "up-to-date",
	channel: "stable",
	currentVersion: "2.3.0",
};

it("remembers consultation across remounts and loading, and signals only new configuration actions", () => {
	const initial = { open: false, configuration };
	const callback = (props: typeof initial) =>
		useSettingsNotices(props.open, update, props.configuration);
	const first = renderHook(callback, { initialProps: initial });
	expect(first.result.current.configuration).toBe(true);
	first.rerender({ ...initial, open: true });
	expect(first.result.current.configuration).toBe(false);
	first.unmount();
	const next = renderHook(callback, { initialProps: initial });
	expect(next.result.current.configuration).toBe(false);
	next.rerender({
		open: false,
		configuration: { status: "loading", plan: null },
	});
	next.rerender(initial);
	expect(next.result.current.configuration).toBe(false);
	const remaining: DesktopConfigurationState = {
		status: "ready",
		plan: { ...plan, restartClients: ["codex"] },
	};
	next.rerender({ open: false, configuration: remaining });
	expect(next.result.current.configuration).toBe(false);
	next.rerender(initial);
	expect(next.result.current.configuration).toBe(true);
	next.rerender({ ...initial, open: true });
	expect(plan.restartClients).toEqual(["codex", "gemini"]);
	next.rerender({
		open: false,
		configuration: { status: "ready", plan: { ...plan, restartClients: [] } },
	});
	next.rerender(initial);
	expect(next.result.current.configuration).toBe(true);
});

it("keeps a viewed update quiet through checks and signals a new version or a new error after recovery", () => {
	const ready: DesktopUpdateState = {
		...update,
		status: "ready",
		version: "2.4.0",
	};
	const initial = { open: false, update: ready };
	const { result, rerender } = renderHook(
		(props: typeof initial) =>
			useSettingsNotices(props.open, props.update, configuration),
		{ initialProps: initial },
	);
	expect(result.current.update).toBe(true);
	rerender({ ...initial, open: true });
	rerender({ ...initial, update: { ...update, status: "checking" } });
	rerender(initial);
	expect(result.current.update).toBe(false);
	rerender({ ...initial, update: { ...ready, version: "2.5.0" } });
	expect(result.current.update).toBe(true);
	const error: DesktopUpdateState = {
		...update,
		status: "error",
		message: "Connection failed",
	};
	rerender({ open: true, update: error });
	rerender({ open: false, update: error });
	expect(result.current.update).toBe(false);
	rerender({ open: false, update });
	rerender({ open: false, update: error });
	expect(result.current.update).toBe(true);
});
