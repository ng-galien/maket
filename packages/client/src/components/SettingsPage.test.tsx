import type {
	DesktopApi,
	DesktopConfigurationPlan,
	McpConfigurationFinding,
} from "@maket/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	initializeDesktopConfiguration,
	resetDesktopConfigurationForTests,
} from "../desktopConfiguration";
import {
	initializeDesktopUpdates,
	resetDesktopUpdatesForTests,
} from "../desktopUpdates";
import { setLang } from "../i18n/useT";
import { DEFAULT_ACCENT_COLOR } from "../lib/colorScheme";
import { useStore } from "../store/useStore";
import { SettingsPage } from "./SettingsPage";

beforeEach(() => {
	resetDesktopUpdatesForTests();
	resetDesktopConfigurationForTests();
	setLang("en");
	useStore.setState({
		settingsOpen: true,
		libraryOpen: false,
		themeMode: "system",
		darkMode: false,
		accentColor: DEFAULT_ACCENT_COLOR,
		autoFocusFit: true,
	});
});

afterEach(() => {
	delete window.maketDesktop;
	resetDesktopConfigurationForTests();
	document.documentElement.style.removeProperty("--color-accent");
	cleanup();
});

describe("SettingsPage", () => {
	it("presents appearance, workspace, and update preferences on one full page", () => {
		render(<SettingsPage />);

		expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
		expect(screen.getByRole("heading", { name: "Appearance" })).toBeVisible();
		expect(screen.getByRole("heading", { name: "Workspace" })).toBeVisible();
		expect(screen.getByRole("heading", { name: "Updates" })).toBeVisible();
		expect(screen.getByRole("button", { name: "Stable" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.queryByText(/print/i)).toBeNull();
	});

	it("locks channel selection once an update is ready to install", async () => {
		window.maketDesktop = {
			runtime: {
				getState: async () => ({
					owner: "electron",
					workspace: "/tmp/.maket",
					url: "http://127.0.0.1:24843",
					version: "2.0.0-rc.1",
				}),
			},
			mcp: {
				diagnose: async () => [],
			},
			updates: {
				getState: async () => ({
					status: "ready",
					channel: "candidate",
					currentVersion: "2.0.0-rc.1",
					version: "2.0.0-rc.2",
				}),
				onState: () => () => undefined,
			},
		} as unknown as DesktopApi;
		const dispose = initializeDesktopUpdates();
		render(<SettingsPage />);

		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Candidates" })).toBeDisabled(),
		);
		expect(screen.getByRole("button", { name: "Stable" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Restart" })).toBeVisible();
		dispose();
	});

	it("keeps a legible close action outside the scrolling settings content", () => {
		render(<SettingsPage />);

		const page = document.querySelector("[data-settings-page]");
		const header = document.querySelector("[data-settings-header]");
		const scrollRegion = document.querySelector(
			"[data-settings-scroll-region]",
		);
		const close = screen.getByRole("button", { name: "Close settings" });

		expect(page).toHaveClass("overflow-hidden", "bg-panel");
		expect(header).toHaveClass("shrink-0", "bg-panel");
		expect(scrollRegion).toHaveClass("overflow-y-auto");
		expect(scrollRegion).not.toContainElement(close);
		expect(close).toHaveClass("border", "bg-input", "text-text-2");
		expect(close).toHaveTextContent("Close");
	});

	it("applies theme and accent choices immediately", async () => {
		const user = userEvent.setup();
		render(<SettingsPage />);

		await user.click(screen.getByRole("button", { name: "Dark" }));
		expect(useStore.getState()).toMatchObject({
			themeMode: "dark",
			darkMode: true,
		});
		expect(document.documentElement.dataset.theme).toBe("dark");

		await user.click(screen.getByRole("button", { name: "Ocean" }));
		expect(useStore.getState().accentColor).toBe("#0284c7");
		expect(
			document.documentElement.style.getPropertyValue("--color-accent"),
		).toBe("#0284c7");
	});

	it("moves automatic repositioning into settings and closes cleanly", async () => {
		const user = userEvent.setup();
		render(<SettingsPage />);

		const on = screen.getByRole("button", { name: "On" });
		const off = screen.getByRole("button", { name: "Off" });
		expect(on).toHaveAttribute("aria-pressed", "true");
		expect(off).toHaveAttribute("aria-pressed", "false");

		await user.click(off);
		expect(useStore.getState().autoFocusFit).toBe(false);
		expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		await user.click(screen.getByRole("button", { name: "Close settings" }));
		expect(useStore.getState().settingsOpen).toBe(false);
	});

	it("offers migration and symmetric uninstall for desktop agent configuration", async () => {
		const user = userEvent.setup();
		const outdated: McpConfigurationFinding = {
			client: "codex",
			scope: "user",
			path: "/tmp/.codex/config.toml",
			status: "outdated",
			detail: "Legacy entry",
			detected: true,
			managed: false,
			skillPath: "/tmp/.agents/skills/maket/SKILL.md",
			mcpStatus: "outdated",
			skillStatus: "missing",
		};
		const installed = {
			...outdated,
			status: "valid",
			managed: true,
			mcpStatus: "valid",
			skillStatus: "valid",
		} satisfies McpConfigurationFinding;
		window.maketDesktop = {
			runtime: {
				getState: async () => ({
					owner: "electron",
					workspace: "/tmp/.maket",
					url: "http://127.0.0.1:24843",
					version: "2.0.0",
				}),
			},
			mcp: {
				diagnose: async () => [outdated],
				install: async () => [installed],
				uninstall: async () => [outdated],
			},
		} as unknown as DesktopApi;

		render(<SettingsPage />);
		expect(
			await screen.findByRole("heading", { name: "Agents" }),
		).toBeVisible();
		expect(screen.getByText("http://127.0.0.1:24843/mcp")).toBeVisible();
		await user.click(
			screen.getByRole("button", { name: "Copy MCP server address" }),
		);
		expect(
			screen.getByRole("button", { name: "MCP server address copied" }),
		).toBeVisible();
		await user.click(await screen.findByRole("button", { name: "Migrate" }));
		expect(
			await screen.findByRole("button", { name: "Uninstall" }),
		).toBeVisible();
	});

	it("drives every explicit onboarding action from the agent settings checklist", async () => {
		const user = userEvent.setup();
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
			findings: [],
			manualClients: [
				{
					client: "claude-desktop",
					name: "Claude Desktop",
					detected: true,
					status: "missing",
					bundledVersion: "2.0.0",
				},
			],
			restartClients: ["codex"],
		};
		const activateRuntime = vi.fn().mockResolvedValue(undefined);
		const installClaudeDesktop = vi.fn().mockResolvedValue(undefined);
		const acknowledgeRestarts = vi.fn().mockResolvedValue(plan);
		window.maketDesktop = {
			runtime: {
				getState: vi.fn().mockResolvedValue({
					owner: "legacy",
					workspace: "/tmp/.maket",
					url: "http://127.0.0.1:24842",
					version: "2.0.0",
				}),
			},
			mcp: { diagnose: vi.fn().mockResolvedValue([]) },
			configuration: {
				getPlan: vi.fn().mockResolvedValue(plan),
				applyOnboarding: vi.fn().mockResolvedValue({ plan, results: [] }),
				activateRuntime,
				installClaudeDesktop,
				acknowledgeRestarts,
			},
		} as unknown as DesktopApi;
		initializeDesktopConfiguration();

		render(<SettingsPage />);
		await user.click(
			await screen.findByRole("button", {
				name: "Stop it and activate Maket App",
			}),
		);
		await waitFor(() => expect(activateRuntime).toHaveBeenCalledOnce());
		await user.click(screen.getByRole("button", { name: "Got it" }));
		await waitFor(() => expect(acknowledgeRestarts).toHaveBeenCalledOnce());
		await user.click(
			screen.getByRole("button", { name: "Install in Claude Desktop" }),
		);

		expect(installClaudeDesktop).toHaveBeenCalledOnce();
		expect(screen.getByRole("status")).toHaveTextContent(
			"Claude Desktop is open on the Maket details. Click Uninstall if needed, then Install, and check again here.",
		);
		expect(
			screen.getByText(/Maket 2\.0\.0 connector is not installed/),
		).toBeVisible();
	});

	it("keeps Claude Desktop visible and offers reinstall when its MCPB is aligned", async () => {
		const plan: DesktopConfigurationPlan = {
			endpoint: "http://127.0.0.1:24843/mcp",
			onboardingRequired: false,
			awaitingClaudeDesktop: false,
			runtime: { status: "ready" },
			findings: [],
			manualClients: [
				{
					client: "claude-desktop",
					name: "Claude Desktop",
					detected: true,
					status: "valid",
					bundledVersion: "2.0.0",
					installedVersion: "2.0.0",
				},
			],
			restartClients: [],
		};
		window.maketDesktop = {
			runtime: {
				getState: vi.fn().mockResolvedValue({
					owner: "electron",
					workspace: "/tmp/.maket",
					url: "http://127.0.0.1:24843",
					version: "2.0.0",
				}),
			},
			mcp: { diagnose: vi.fn().mockResolvedValue([]) },
			configuration: {
				getPlan: vi.fn().mockResolvedValue(plan),
				installClaudeDesktop: vi.fn().mockResolvedValue(undefined),
			},
		} as unknown as DesktopApi;
		initializeDesktopConfiguration();

		render(<SettingsPage />);

		expect(
			await screen.findByRole("button", {
				name: "Reinstall in Claude Desktop",
			}),
		).toBeVisible();
		expect(screen.getByText(/installed and up to date/)).toBeVisible();
	});
});
