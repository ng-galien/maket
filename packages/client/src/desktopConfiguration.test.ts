import type { DesktopApi, DesktopConfigurationPlan } from "@maket/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyDesktopOnboarding,
	configurableFindings,
	configurationActionRequired,
	getDesktopConfigurationState,
	initializeDesktopConfiguration,
	resetDesktopConfigurationForTests,
} from "./desktopConfiguration";

const plan: DesktopConfigurationPlan = {
	endpoint: "http://127.0.0.1:24843/mcp",
	onboardingRequired: true,
	awaitingClaudeDesktop: false,
	runtime: {
		status: "action-required",
		owner: "legacy",
		host: "127.0.0.1",
		port: 24842,
	},
	findings: [
		{
			client: "codex",
			scope: "user",
			path: "/tmp/.codex/config.toml",
			status: "missing",
			detail: "Maket MCP is not configured.",
			detected: true,
			managed: false,
			skillPath: "/tmp/.agents/skills/maket/SKILL.md",
			mcpStatus: "missing",
			skillStatus: "missing",
		},
	],
	manualClients: [
		{
			client: "claude-desktop",
			name: "Claude Desktop",
			detected: true,
			status: "missing",
			bundledVersion: "2.0.0",
		},
	],
	restartClients: [],
};

beforeEach(() => {
	resetDesktopConfigurationForTests();
	delete window.maketDesktop;
});

afterEach(() => resetDesktopConfigurationForTests());

describe("desktop configuration state", () => {
	it("diagnoses missing configuration without mutating the machine", async () => {
		const getPlan = vi.fn(async () => plan);
		window.maketDesktop = {
			configuration: { getPlan },
		} as unknown as DesktopApi;

		initializeDesktopConfiguration();
		await vi.waitFor(() =>
			expect(getDesktopConfigurationState().status).toBe("ready"),
		);

		expect(getPlan).toHaveBeenCalledOnce();
		expect(
			configurationActionRequired(getDesktopConfigurationState().plan),
		).toBe(true);
		expect(
			configurableFindings(getDesktopConfigurationState().plan),
		).toHaveLength(1);
	});

	it("applies only the explicitly selected onboarding actions", async () => {
		const completed = {
			...plan,
			onboardingRequired: false,
			runtime: { status: "ready" as const },
			findings: plan.findings.map((finding) => ({
				...finding,
				status: "valid" as const,
				mcpStatus: "valid" as const,
				skillStatus: "valid" as const,
			})),
			manualClients: [
				{
					client: "claude-desktop" as const,
					name: "Claude Desktop",
					detected: true,
					status: "valid" as const,
					bundledVersion: "2.0.0",
					installedVersion: "2.0.0",
				},
			],
		};
		const applyOnboarding = vi.fn(async () => ({
			plan: completed,
			results: [{ action: "codex" as const, status: "applied" as const }],
		}));
		window.maketDesktop = {
			configuration: { getPlan: async () => plan, applyOnboarding },
		} as unknown as DesktopApi;
		initializeDesktopConfiguration();
		await vi.waitFor(() =>
			expect(getDesktopConfigurationState().status).toBe("ready"),
		);

		expect(applyOnboarding).not.toHaveBeenCalled();
		await applyDesktopOnboarding({ actions: ["codex"] });

		expect(applyOnboarding).toHaveBeenCalledWith({ actions: ["codex"] });
		expect(
			configurationActionRequired(getDesktopConfigurationState().plan),
		).toBe(false);
	});
});
