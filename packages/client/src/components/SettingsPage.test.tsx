import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n/useT";
import { DEFAULT_ACCENT_COLOR } from "../lib/colorScheme";
import { useStore } from "../store/useStore";
import { SettingsPage } from "./SettingsPage";

beforeEach(() => {
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
	document.documentElement.style.removeProperty("--color-accent");
	cleanup();
});

describe("SettingsPage", () => {
	it("presents appearance and workspace preferences on one full page", () => {
		render(<SettingsPage />);

		expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
		expect(screen.getByRole("heading", { name: "Appearance" })).toBeVisible();
		expect(screen.getByRole("heading", { name: "Workspace" })).toBeVisible();
		expect(screen.queryByText(/print/i)).toBeNull();
	});

	it("applies and persists theme and accent choices immediately", async () => {
		const user = userEvent.setup();
		render(<SettingsPage />);

		await user.click(screen.getByRole("button", { name: "Dark" }));
		expect(useStore.getState()).toMatchObject({
			themeMode: "dark",
			darkMode: true,
		});
		expect(localStorage.getItem("maket-theme-mode")).toBe("dark");
		expect(document.documentElement.dataset.theme).toBe("dark");

		await user.click(screen.getByRole("button", { name: "Ocean" }));
		expect(useStore.getState().accentColor).toBe("#0284c7");
		expect(localStorage.getItem("maket-accent-color")).toBe("#0284c7");
		expect(
			document.documentElement.style.getPropertyValue("--color-accent"),
		).toBe("#0284c7");
	});

	it("moves automatic repositioning into settings and closes cleanly", async () => {
		const user = userEvent.setup();
		render(<SettingsPage />);

		const toggle = screen.getByRole("switch");
		const thumb = toggle.firstElementChild;
		expect(thumb).toHaveClass("left-0", "translate-x-5");
		await user.click(toggle);
		expect(useStore.getState().autoFocusFit).toBe(false);
		expect(localStorage.getItem("maket-auto-focus-fit")).toBe("false");
		expect(thumb).toHaveClass("left-0", "translate-x-1");

		await user.click(screen.getByRole("button", { name: "Close settings" }));
		expect(useStore.getState().settingsOpen).toBe(false);
	});
});
