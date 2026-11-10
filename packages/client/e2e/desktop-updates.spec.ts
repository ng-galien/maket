import type { DesktopApi, DesktopUpdateState } from "@maket/shared";
import { expect, openWorkspace, test } from "./workspace-test";

declare global {
	interface Window {
		updateFixture: {
			publish: (state: DesktopUpdateState) => void;
			finishCheck: () => void;
			calls: () => { checks: number; installs: number };
		};
	}
}

test("keeps check and install distinct and remembers viewed settings notices", async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1300, height: 913 });
	// Exercise the real settings UI at the desktop preload boundary, without a native installer.
	await page.addInitScript(() => {
		let state: DesktopUpdateState = {
			status: "up-to-date",
			channel: "stable",
			currentVersion: "2.3.0",
		};
		let listener: ((state: DesktopUpdateState) => void) | undefined;
		let checks = 0;
		let installs = 0;
		let finishCheck: (() => void) | undefined;
		const publish = (next: DesktopUpdateState) => {
			state = next;
			listener?.(next);
		};
		window.updateFixture = {
			publish,
			calls: () => ({ checks, installs }),
			finishCheck: () => finishCheck?.(),
		};
		window.maketDesktop = {
			version: 1,
			platform: "darwin",
			commands: { onCommand: () => () => {} },
			runtime: {
				getState: async () => ({
					owner: "electron",
					workspace: "/tmp/update-ui-test",
					url: location.origin,
					version: "2.3.0",
				}),
			},
			mcp: { diagnose: async () => [] },
			configuration: {
				getPlan: async () => ({
					endpoint: `${location.origin}/mcp`,
					onboardingRequired: false,
					awaitingClaudeDesktop: false,
					runtime: { status: "ready" },
					findings: [],
					manualClients: [],
					restartClients: ["codex"],
				}),
			},
			updates: {
				getState: async () => state,
				onState: (next: typeof listener) => {
					listener = next;
					return () => {
						listener = undefined;
					};
				},
				check: async () => {
					checks++;
					publish({ ...state, status: "checking" });
					await new Promise<void>((resolve) => {
						finishCheck = resolve;
					});
				},
				install: async () => {
					installs++;
					publish({ ...state, status: "installing" });
				},
			},
		} as unknown as DesktopApi;
	});
	await openWorkspace(page);
	const settings = page.getByRole("button", { name: "Settings", exact: true });
	const notice = settings.locator("[data-settings-notice]");
	await expect(notice).toBeVisible();
	await settings.click();
	await expect(notice).toHaveCount(0);
	await settings.click();
	await expect(settings).not.toHaveAttribute("aria-current", "page");
	await page.reload();
	await expect(settings).toBeVisible();
	await expect(notice).toHaveCount(0);
	await settings.click();
	await expect(
		page.getByText("Restart Codex to load the new configuration"),
	).toBeVisible();
	const check = page.getByRole("button", { name: "Check", exact: true });
	await check.scrollIntoViewIfNeeded();
	await expect(
		page.getByRole("heading", { name: "Maket 2.3.0" }),
	).toBeVisible();
	await check.click();
	await expect(
		page.getByRole("button", { name: "Checking…", exact: true }),
	).toBeDisabled();
	await page.evaluate(() => window.updateFixture.finishCheck());
	await expect(check).toBeEnabled();
	await expect(page.getByRole("status", { name: "Updates" })).toContainText(
		"Checking for updates",
	);
	await check.click();
	await page.evaluate(() => window.updateFixture.finishCheck());
	await page.evaluate(() =>
		window.updateFixture.publish({
			status: "downloading",
			channel: "stable",
			currentVersion: "2.3.0",
			version: "2.4.0",
			progress: 42,
		}),
	);
	await expect(page.getByRole("progressbar")).toHaveAttribute(
		"aria-valuenow",
		"42",
	);
	await expect(page.getByRole("status", { name: "Updates" })).toContainText(
		"2.4.0",
	);
	await expect(check).toBeDisabled();
	await page.screenshot({ path: info.outputPath("settings-downloading.png") });
	const box = await check.boundingBox();
	if (!box) throw new Error("Check button is not visible");
	await page.evaluate(() =>
		window.updateFixture.publish({
			status: "ready",
			channel: "stable",
			currentVersion: "2.3.0",
			version: "2.4.0",
		}),
	);
	await expect(check).toBeDisabled();
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect
		.poll(() => page.evaluate(() => window.updateFixture.calls()))
		.toEqual({ checks: 2, installs: 0 });
	const install = page.getByRole("button", {
		name: "Restart and install",
		exact: true,
	});
	await expect(install).toBeEnabled();
	await page.screenshot({ path: info.outputPath("settings-ready.png") });
	await install.dblclick();
	await expect(
		page.getByRole("button", { name: "Installing…", exact: true }),
	).toBeDisabled();
	await expect
		.poll(() => page.evaluate(() => window.updateFixture.calls().installs))
		.toBe(1);
	await page.evaluate(() =>
		window.updateFixture.publish({
			status: "up-to-date",
			channel: "stable",
			currentVersion: "2.4.0",
		}),
	);
	await expect(
		page.getByRole("heading", { name: "Maket 2.4.0" }),
	).toBeVisible();
	await expect(check).toBeEnabled();
	await expect(install).toHaveCount(0);
	await settings.click();
	await page.evaluate(() =>
		window.updateFixture.publish({
			status: "ready",
			channel: "stable",
			currentVersion: "2.4.0",
			version: "2.5.0",
		}),
	);
	await expect(notice).toBeVisible();
	await settings.click();
	await expect(notice).toHaveCount(0);
	await expect(install).toBeEnabled();
	await page.getByRole("button", { name: "Français", exact: true }).click();
	const frenchInstall = page.getByRole("button", {
		name: "Redémarrer et installer",
		exact: true,
	});
	await frenchInstall.scrollIntoViewIfNeeded();
	await expect(frenchInstall).toBeEnabled();
	await expect(
		page.getByRole("button", { name: "Rechercher", exact: true }),
	).toBeDisabled();
	await page.screenshot({ path: info.outputPath("settings-ready-fr.png") });
});
