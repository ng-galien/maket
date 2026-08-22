import { useEffect } from "react";
import { AppShell } from "./components/AppShell";
import { ReadingWorkspace } from "./components/ReadingWorkspace";
import { installDesktopCommands } from "./desktopCommands";
import {
	applyAccentColor,
	applyColorScheme,
	resolveDarkMode,
} from "./lib/colorScheme";
import { useStore } from "./store/useStore";
import { initWs } from "./store/ws";

// code-moniker: ignore[smell-feature-envy-local]
// The application root is deliberately the composition boundary for the
// workspace selectors and lifecycle effects it coordinates.
export default function App() {
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

	useEffect(() => {
		initWs();
		return installDesktopCommands();
	}, []);

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
		<div className="h-full w-full">
			{workspaceView === "reading" && hasFocusedDoc ? (
				<ReadingWorkspace />
			) : (
				<AppShell locked={locked} />
			)}
		</div>
	);
}
