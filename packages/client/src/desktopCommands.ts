import type { DesktopCommand } from "@maket/shared";
import { getLang, toggleLang } from "./i18n/useT";
import { enterReadingSession } from "./store/readingSession";
import { useStore } from "./store/useStore";
import { clearActivityBubbles, sendLockDoc, wsSend } from "./store/ws";
import { fitToView } from "./store/zoomBridge";

export function installDesktopCommands(): () => void {
	return (
		window.maketDesktop?.commands.onCommand(handleDesktopCommand) ?? (() => {})
	);
}

interface DesktopCommandDependencies {
	lockDocument: (name: string, locked: boolean) => void;
}

const desktopCommandDependencies: DesktopCommandDependencies = {
	lockDocument: sendLockDoc,
};

// Native commands are a routing adapter over the same renderer-owned actions.
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
export function handleDesktopCommand(
	command: DesktopCommand,
	dependencies: DesktopCommandDependencies = desktopCommandDependencies,
): void {
	const state = useStore.getState();
	switch (command) {
		case "toggle-library":
			state.toggleLibrary();
			return;
		case "show-documents":
			state.setLibraryView("docs");
			return;
		case "show-chartes":
			state.setLibraryView("chartes");
			return;
		case "show-photos":
			state.setLibraryView("photos");
			return;
		case "show-collections":
			state.setLibraryView("collections");
			return;
		case "toggle-exchanges":
			if (state.libraryOpen && state.libraryView === "exchange") {
				state.toggleLibrary();
			} else {
				state.setLibraryView("exchange");
			}
			return;
		case "reading-view":
			openReadingView();
			return;
		case "fit-view":
			fitToView();
			return;
		case "toggle-document-lock":
			toggleFocusedDocumentLock(dependencies.lockDocument);
			return;
		case "print-document":
			void printFocusedDocument();
			return;
		case "toggle-auto-fit":
			state.toggleAutoFocusFit();
			return;
		case "open-help":
			wsSend({
				type: "open_onboarding",
				lang: getLang() === "en" ? "en" : "fr",
			});
			return;
		case "toggle-language":
			toggleLang();
			return;
		case "toggle-theme":
			state.toggleDarkMode();
	}
}

export function openReadingView(): void {
	if (!enterReadingSession()) return;
	clearActivityBubbles();
}

export function toggleFocusedDocumentLock(
	lockDocument: (name: string, locked: boolean) => void = sendLockDoc,
): void {
	const state = useStore.getState();
	const document = state.focusedDocName
		? state.docs.get(state.focusedDocName)
		: null;
	if (document) lockDocument(document.name, document.meta?.locked !== true);
}

export async function printFocusedDocument(): Promise<void> {
	const document = useStore.getState().focusedDocName;
	if (!document) return;
	if (window.maketDesktop) {
		await window.maketDesktop.runtime.printDocument(document);
		return;
	}
	window.open(
		`/print?${new URLSearchParams({ name: document }).toString()}`,
		"_blank",
		"noopener",
	);
}
