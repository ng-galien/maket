import type { DesktopCommand } from "@maket/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	handleDesktopCommand,
	installDesktopCommands,
	printFocusedDocument,
} from "./desktopCommands";
import { getLang, setLang } from "./i18n/useT";
import { useStore } from "./store/useStore";
import { registerFitToView } from "./store/zoomBridge";

beforeEach(() => {
	setLang("en");
	useStore.setState({
		docs: new Map(),
		focusedDocName: null,
		libraryOpen: false,
		libraryView: "docs",
		workspaceView: "canvas",
		darkMode: false,
	});
	delete window.maketDesktop;
});

describe("desktop command parity", () => {
	it("routes native library and utility commands through the shared store", () => {
		handleDesktopCommand("show-photos");
		expect(useStore.getState()).toMatchObject({
			libraryOpen: true,
			libraryView: "photos",
		});
		handleDesktopCommand("toggle-exchanges");
		expect(useStore.getState()).toMatchObject({
			libraryOpen: true,
			libraryView: "exchange",
		});
		handleDesktopCommand("toggle-exchanges");
		expect(useStore.getState().libraryOpen).toBe(false);
		handleDesktopCommand("toggle-theme");
		expect(useStore.getState().darkMode).toBe(true);
	});

	it("uses the same focused document lock command as the web header", () => {
		const sendLock = vi.fn();
		const document = {
			id: "doc-1",
			name: "Native menu document",
			category: "test",
			canvas: { w: 210, h: 297, background: "#fff" },
			pages: [{ id: "p1", name: "Page 1", elements: [] }],
			activePage: 0,
		};
		useStore.setState({
			docs: new Map([[document.name, document]]),
			focusedDocName: document.name,
		});

		handleDesktopCommand("toggle-document-lock", {
			lockDocument: sendLock,
		});
		expect(sendLock).toHaveBeenCalledWith(document.name, true);
	});

	it("subscribes once to the preload command stream", () => {
		let listener: (command: DesktopCommand) => void = () => {
			throw new Error("Desktop command listener was not registered");
		};
		const dispose = vi.fn();
		window.maketDesktop = {
			version: 1,
			platform: "darwin",
			runtime: {} as Window["maketDesktop"] extends { runtime: infer R }
				? R
				: never,
			commands: {
				onCommand: (next) => {
					listener = next;
					return dispose;
				},
			},
			mcp: {} as never,
			updates: {} as never,
		};
		const cleanup = installDesktopCommands();
		listener("show-collections");
		expect(useStore.getState().libraryView).toBe("collections");
		cleanup();
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("routes every document and preference command through existing actions", () => {
		const fit = vi.fn();
		registerFitToView(fit);
		const document = {
			id: "doc-commands",
			name: "Command document",
			category: "test",
			canvas: { w: 210, h: 297, background: "#fff" },
			pages: [{ id: "p1", name: "Page 1", elements: [] }],
			activePage: 0,
		};
		useStore.setState({
			docs: new Map([[document.name, document]]),
			focusedDocName: document.name,
			focusedCollectionName: "clients",
			selectedIds: ["title"],
			editingElementId: "title",
			showPopover: true,
			autoFocusFit: true,
		});

		handleDesktopCommand("toggle-library");
		handleDesktopCommand("show-documents");
		handleDesktopCommand("show-chartes");
		handleDesktopCommand("show-collections");
		expect(useStore.getState().libraryView).toBe("collections");
		handleDesktopCommand("fit-view");
		expect(fit).toHaveBeenCalledOnce();
		handleDesktopCommand("toggle-auto-fit");
		expect(useStore.getState().autoFocusFit).toBe(false);
		handleDesktopCommand("toggle-language");
		expect(getLang()).toBe("fr");
		handleDesktopCommand("open-help");
		handleDesktopCommand("reading-view");
		expect(useStore.getState()).toMatchObject({
			workspaceView: "reading",
			focusedCollectionName: null,
			selectedIds: [],
			editingElementId: null,
			showPopover: false,
		});
	});

	it("prints through the browser or the narrow preload bridge", async () => {
		const document = {
			id: "doc-print",
			name: "Print été",
			category: "test",
			canvas: { w: 210, h: 297, background: "#fff" },
			pages: [{ id: "p1", name: "Page 1", elements: [] }],
			activePage: 0,
		};
		useStore.setState({
			docs: new Map([[document.name, document]]),
			focusedDocName: document.name,
		});
		const open = vi.spyOn(window, "open").mockImplementation(() => null);
		await printFocusedDocument();
		expect(open).toHaveBeenCalledWith(
			"/print?name=Print+%C3%A9t%C3%A9",
			"_blank",
			"noopener",
		);

		const printDocument = vi.fn(async () => undefined);
		window.maketDesktop = {
			version: 1,
			platform: "darwin",
			runtime: { printDocument } as never,
			commands: {} as never,
			mcp: {} as never,
			updates: {} as never,
		};
		await printFocusedDocument();
		expect(printDocument).toHaveBeenCalledWith(document.name);

		useStore.setState({ focusedDocName: null });
		await printFocusedDocument();
		handleDesktopCommand("reading-view");
		handleDesktopCommand("toggle-document-lock", {
			lockDocument: vi.fn(),
		});
	});
});
