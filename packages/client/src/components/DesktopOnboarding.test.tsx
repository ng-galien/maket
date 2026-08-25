import type { DesktopApi, DesktopConfigurationPlan } from "@maket/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	initializeDesktopConfiguration,
	resetDesktopConfigurationForTests,
} from "../desktopConfiguration";
import { setLang } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { DesktopOnboarding } from "./DesktopOnboarding";

const plan: DesktopConfigurationPlan = {
	endpoint: "http://127.0.0.1:24843/mcp",
	onboardingRequired: true,
	awaitingClaudeDesktop: false,
	runtime: { status: "action-required", owner: "legacy", port: 24842 },
	findings: [
		{
			client: "gemini",
			scope: "user",
			path: "/tmp/.gemini/settings.json",
			status: "missing",
			detail: "Not configured",
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
	setLang("en");
	useStore.setState({ settingsOpen: false, libraryOpen: false });
});

afterEach(() => {
	delete window.maketDesktop;
	resetDesktopConfigurationForTests();
	cleanup();
});

describe("DesktopOnboarding", () => {
	it("preselects detected recommendations and applies only the current selection", async () => {
		const user = userEvent.setup();
		const applyOnboarding = vi.fn(async () => ({
			plan,
			results: [
				{ action: "runtime" as const, status: "applied" as const },
				{ action: "gemini" as const, status: "applied" as const },
			],
		}));
		window.maketDesktop = {
			configuration: { getPlan: async () => plan, applyOnboarding },
		} as unknown as DesktopApi;
		initializeDesktopConfiguration();
		render(<DesktopOnboarding />);

		const runtime = await screen.findByRole("checkbox", {
			name: /Use Maket App’s embedded server/,
		});
		const gemini = screen.getByRole("checkbox", { name: /Configure Gemini/ });
		const claude = screen.getByRole("checkbox", {
			name: /Configure Claude Desktop/,
		});
		await waitFor(() => {
			expect(runtime).toBeChecked();
			expect(gemini).toBeChecked();
			expect(claude).toBeChecked();
		});
		expect(runtime).toBeDisabled();

		await user.click(claude);
		await user.click(
			screen.getByRole("button", { name: "Apply selected actions" }),
		);

		expect(applyOnboarding).toHaveBeenCalledWith({
			actions: ["runtime", "gemini"],
		});
	});

	it("keeps Claude Desktop confirmation visible until verification succeeds", async () => {
		const user = userEvent.setup();
		const completed = {
			...plan,
			onboardingRequired: false,
			awaitingClaudeDesktop: false,
		};
		const verifyOnboarding = vi.fn(async () => completed);
		window.maketDesktop = {
			configuration: {
				getPlan: async () => plan,
				applyOnboarding: async () => ({
					plan,
					results: [
						{
							action: "claude-desktop",
							status: "confirmation-required",
						} as const,
					],
				}),
				verifyOnboarding,
			},
		} as unknown as DesktopApi;
		initializeDesktopConfiguration();
		render(<DesktopOnboarding />);

		await screen.findByRole("checkbox", { name: /Configure Claude Desktop/ });
		await user.click(
			screen.getByRole("checkbox", { name: /Configure Gemini/ }),
		);
		await user.click(
			screen.getByRole("button", { name: "Apply selected actions" }),
		);

		expect(await screen.findByText("Confirmation needed")).toBeVisible();
		await user.click(
			screen.getByRole("button", { name: "Check installation" }),
		);
		expect(verifyOnboarding).toHaveBeenCalledOnce();
	});

	it("opens the full settings page through the secondary action", async () => {
		const user = userEvent.setup();
		window.maketDesktop = {
			configuration: { getPlan: async () => plan },
		} as unknown as DesktopApi;
		initializeDesktopConfiguration();
		render(<DesktopOnboarding />);

		await user.click(
			await screen.findByRole("button", { name: "Open Settings" }),
		);
		expect(useStore.getState().settingsOpen).toBe(true);
	});
});
