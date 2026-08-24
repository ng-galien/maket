import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { DesktopOnboarding } from "./components/DesktopOnboarding";
import { ReadingWorkspace } from "./components/ReadingWorkspace";
import { installDesktopCommands } from "./desktopCommands";
import {
	initializeDesktopConfiguration,
	refreshDesktopConfiguration,
	useDesktopConfiguration,
} from "./desktopConfiguration";
import { initializeDesktopUpdates } from "./desktopUpdates";
import { useT } from "./i18n/useT";
import {
	applyAccentColor,
	applyColorScheme,
	resolveDarkMode,
} from "./lib/colorScheme";
import { useStore } from "./store/useStore";
import { initWs } from "./store/ws";

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// The application root is deliberately the composition boundary for the
// workspace selectors and lifecycle effects it coordinates.
export default function App() {
	const desktop = window.maketDesktop !== undefined;
	const configuration = useDesktopConfiguration();
	const setupMode =
		desktop && configuration.plan?.runtime.status === "action-required";
	const configurationFailed =
		desktop && configuration.status === "error" && configuration.plan === null;
	const onboardingRequired =
		desktop && configuration.plan?.onboardingRequired === true;
	const configurationRequired = needsConfiguration(
		setupMode,
		onboardingRequired,
	);
	const t = useT();
	const [workspaceRevealed, setWorkspaceRevealed] = useState(!desktop);
	const locked = useStore((s) => s.locked);
	const workspaceView = useStore((s) => s.workspaceView);
	const workspaceDocNames = useStore((s) => s.workspaceDocNames);
	const focusedDocName = useStore((s) => s.focusedDocName);
	const docs = useStore((s) => s.docs);
	const setFocusedDoc = useStore((s) => s.setFocusedDoc);
	const hasFocusedDoc = useStore((s) =>
		s.focusedDocName ? s.docs.has(s.focusedDocName) : false,
	);
	const themeMode = useStore((s) => s.themeMode);
	const accentColor = useStore((s) => s.accentColor);
	const workspaceHydrated = useStore((s) => s.workspaceHydrated);
	const settingsHydrated = useStore((s) => s.settingsHydrated);
	const settingsOpen = useStore((s) => s.settingsOpen);
	const workspaceReady = workspaceHydrated && settingsHydrated;

	useEffect(() => {
		const removeCommands = installDesktopCommands();
		const removeConfiguration = initializeDesktopConfiguration();
		const removeUpdates = initializeDesktopUpdates();
		return () => {
			removeCommands();
			removeConfiguration();
			removeUpdates();
		};
	}, []);

	const runtimeReachable =
		!desktop || (configuration.plan !== null && !configurationRequired);

	useEffect(() => {
		if (!runtimeReachable) return;
		initWs();
	}, [runtimeReachable]);

	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			const darkMode = resolveDarkMode(themeMode, media.matches);
			applyColorScheme(darkMode);
			useStore.setState({ darkMode });
		};
		apply();
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
	}, [themeMode]);

	useEffect(() => applyAccentColor(accentColor), [accentColor]);

	useEffect(() => {
		if (
			!desktop ||
			(!configurationRequired && !configurationFailed && !workspaceReady)
		)
			return;
		let secondFrame = 0;
		const firstFrame = requestAnimationFrame(() => {
			secondFrame = requestAnimationFrame(() => setWorkspaceRevealed(true));
		});
		return () => {
			cancelAnimationFrame(firstFrame);
			cancelAnimationFrame(secondFrame);
		};
	}, [configurationFailed, configurationRequired, desktop, workspaceReady]);

	useEffect(() => {
		if (workspaceDocNames.length === 0) {
			if (focusedDocName) setFocusedDoc(null);
			return;
		}
		if (
			focusedDocName &&
			workspaceDocNames.includes(focusedDocName) &&
			docs.has(focusedDocName)
		) {
			return;
		}
		const loadedDocName = [...workspaceDocNames]
			.reverse()
			.find((name) => docs.has(name));
		setFocusedDoc(
			loadedDocName ?? workspaceDocNames[workspaceDocNames.length - 1] ?? null,
		);
	}, [docs, focusedDocName, setFocusedDoc, workspaceDocNames]);

	return (
		<div className="relative h-full w-full bg-[#111111]">
			{configurationFailed ? (
				<DesktopConfigurationError error={configuration.error} />
			) : configurationRequired && !settingsOpen ? (
				<DesktopOnboarding />
			) : !desktop || configurationRequired || workspaceReady ? (
				workspaceView === "reading" && hasFocusedDoc && !settingsOpen ? (
					<ReadingWorkspace />
				) : (
					<AppShell locked={locked} />
				)
			) : null}
			{desktop && (
				<div
					data-desktop-workspace-loading
					role={workspaceRevealed ? undefined : "status"}
					aria-hidden={workspaceRevealed}
					className={`absolute inset-0 z-[1000] flex items-center justify-center bg-[#111111] transition-opacity duration-150 ${
						workspaceRevealed ? "pointer-events-none opacity-0" : "opacity-100"
					}`}
				>
					<div className="flex items-center gap-2 font-sans text-xs text-zinc-500">
						<span
							aria-hidden="true"
							className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500"
						/>
						<span>{t("loading")}</span>
					</div>
				</div>
			)}
		</div>
	);
}

/** A foreign server owning the workspace blocks hydration whether or not
 *  onboarding was already completed, so the configuration screen must win. */
function needsConfiguration(
	setupMode: boolean,
	onboardingRequired: boolean,
): boolean {
	return setupMode || onboardingRequired;
}

function DesktopConfigurationError({ error }: { error?: string }) {
	const t = useT();
	return (
		<main className="flex h-full items-center justify-center p-6">
			<div
				className="max-w-md text-center font-sans"
				data-desktop-configuration-error
				role="alert"
			>
				<h1 className="text-base font-semibold text-zinc-100">
					{t("desktop_configuration_error_title")}
				</h1>
				<p className="mt-2 text-sm text-zinc-400">
					{error ?? t("desktop_configuration_error_detail")}
				</p>
				<button
					type="button"
					className="mt-4 rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-100"
					onClick={() => void refreshDesktopConfiguration()}
				>
					{t("retry")}
				</button>
			</div>
		</main>
	);
}
