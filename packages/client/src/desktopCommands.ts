import type { DesktopCommand } from "@maket/shared";
import { exportDocumentPdf, printDocument } from "./documentOutput";
import { getLang, toggleLang } from "./i18n/useT";
import { enterReadingSession } from "./store/readingSession";
import { useStore } from "./store/useStore";
import {
	clearActivityBubbles,
	sendLockDoc,
	sendSettings,
	wsSend,
} from "./store/ws";
import { fitToDoc, fitToView } from "./store/zoomBridge";

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
		case "export-pdf":
			if (state.focusedDocName) void exportDocumentPdf(state.focusedDocName);
			return;
		case "print-document":
			if (state.focusedDocName) void printDocument(state.focusedDocName);
			return;
		case "toggle-auto-fit":
			state.setAutoFocusFit(!state.autoFocusFit);
			return;
		case "open-help":
			wsSend({ type: "open_onboarding", lang: getLang() });
			return;
		case "toggle-language":
			sendSettings({ language: toggleLang() });
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

/** Choosing a placement tool reveals its page only when it is outside the working surface. */
export function revealComposerPage(): void {
	const state = useStore.getState();
	if (!state.focusedDocName) return;
	const page = document.querySelector<HTMLElement>(
		`[data-doc="${CSS.escape(state.focusedDocName)}"] .page-canvas[data-page="${state.focusedPageIndex}"]`,
	);
	const surface = document.querySelector<HTMLElement>(
		"[data-canvas-workspace]",
	);
	if (!page || !surface) return;
	const box = page.getBoundingClientRect();
	const viewport = surface.getBoundingClientRect();
	if (
		box.right <= viewport.left ||
		box.left >= viewport.right ||
		box.bottom <= viewport.top ||
		box.top >= viewport.bottom
	)
		fitToDoc(state.focusedDocName, state.focusedPageIndex);
}

/** Follow the exact page confirmed by an explicit Composer command. */
export function focusComposerPage(docName: string, pageId: string): void {
	const navigate = () => {
		const state = useStore.getState();
		if (state.focusedDocName !== docName || state.composerDocName !== docName)
			return true;
		const index =
			state.docs.get(docName)?.pages.findIndex((page) => page.id === pageId) ??
			-1;
		if (index < 0) return false;
		state.setFocusedPage(docName, index);
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				const current = useStore.getState();
				if (
					current.focusedDocName === docName &&
					current.focusedPageIndex === index
				)
					fitToDoc(docName, index);
			}),
		);
		return true;
	};
	if (navigate()) return;
	const stop = useStore.subscribe((state) => {
		if (
			state.focusedDocName !== docName ||
			state.composerDocName !== docName ||
			state.docs.get(docName)?.pages.some((page) => page.id === pageId)
		) {
			stop();
			clearTimeout(timeout);
			navigate();
		}
	});
	const timeout = setTimeout(stop, 10_000);
}
