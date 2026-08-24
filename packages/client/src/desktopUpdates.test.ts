import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkDesktopUpdates,
	getDesktopUpdateState,
	initializeDesktopUpdates,
	resetDesktopUpdatesForTests,
	selectDesktopUpdateChannel,
} from "./desktopUpdates";

beforeEach(() => {
	resetDesktopUpdatesForTests();
	delete window.maketDesktop;
});

afterEach(() => resetDesktopUpdatesForTests());

describe("desktop updates state", () => {
	it("mirrors the state published by the desktop bridge", async () => {
		let publish:
			| ((state: ReturnType<typeof getDesktopUpdateState>) => void)
			| undefined;
		const remove = vi.fn();
		window.maketDesktop = {
			version: 1,
			platform: "darwin",
			runtime: {} as NonNullable<Window["maketDesktop"]>["runtime"],
			commands: {} as NonNullable<Window["maketDesktop"]>["commands"],
			mcp: {} as NonNullable<Window["maketDesktop"]>["mcp"],
			configuration: {} as NonNullable<Window["maketDesktop"]>["configuration"],
			updates: {
				getState: vi.fn(async () => ({
					status: "idle" as const,
					channel: "stable" as const,
					currentVersion: "2.0.0",
				})),
				getChannel: vi.fn(async () => "stable" as const),
				setChannel: vi.fn(),
				check: vi.fn(),
				install: vi.fn(),
				onState: vi.fn((listener) => {
					publish = listener;
					return remove;
				}),
			},
		};

		const dispose = initializeDesktopUpdates();
		await vi.waitFor(() =>
			expect(getDesktopUpdateState().currentVersion).toBe("2.0.0"),
		);
		publish?.({
			status: "ready",
			channel: "stable",
			currentVersion: "2.0.0",
			version: "2.1.0",
		});
		expect(getDesktopUpdateState()).toMatchObject({
			status: "ready",
			version: "2.1.0",
		});

		dispose();
		expect(remove).toHaveBeenCalledOnce();
	});

	it("reports a translatable reason instead of an English message in the web preview", async () => {
		initializeDesktopUpdates();
		await selectDesktopUpdateChannel("candidate");
		expect(getDesktopUpdateState()).toMatchObject({
			channel: "candidate",
			status: "unavailable",
			reason: "development-build",
			currentVersion: "",
		});
		expect(getDesktopUpdateState().message).toBeUndefined();

		await checkDesktopUpdates();
		expect(getDesktopUpdateState()).toMatchObject({
			status: "unavailable",
			reason: "development-build",
			channel: "candidate",
		});
		expect(getDesktopUpdateState().message).toBeUndefined();
	});

	it("keeps a downloaded update ready when a channel change is attempted", async () => {
		let publish:
			| ((state: ReturnType<typeof getDesktopUpdateState>) => void)
			| undefined;
		const setChannel = vi.fn();
		window.maketDesktop = {
			version: 1,
			platform: "darwin",
			runtime: {} as NonNullable<Window["maketDesktop"]>["runtime"],
			commands: {} as NonNullable<Window["maketDesktop"]>["commands"],
			mcp: {} as NonNullable<Window["maketDesktop"]>["mcp"],
			configuration: {} as NonNullable<Window["maketDesktop"]>["configuration"],
			updates: {
				getState: vi.fn(async () => ({
					status: "idle" as const,
					channel: "stable" as const,
					currentVersion: "2.0.0",
				})),
				getChannel: vi.fn(async () => "stable" as const),
				setChannel,
				check: vi.fn(),
				install: vi.fn(),
				onState: vi.fn((listener) => {
					publish = listener;
					return () => undefined;
				}),
			},
		};
		initializeDesktopUpdates();
		await vi.waitFor(() =>
			expect(getDesktopUpdateState()).toMatchObject({
				status: "idle",
				currentVersion: "2.0.0",
			}),
		);
		publish?.({
			status: "ready",
			channel: "stable",
			currentVersion: "2.0.0",
			version: "2.1.0",
		});

		await selectDesktopUpdateChannel("candidate");

		expect(setChannel).not.toHaveBeenCalled();
		expect(getDesktopUpdateState()).toMatchObject({
			status: "ready",
			channel: "stable",
			version: "2.1.0",
		});
	});
});
