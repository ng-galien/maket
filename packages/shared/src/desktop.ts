export const DESKTOP_API_VERSION = 1 as const;

export const DESKTOP_CHANNELS = {
	runtimeState: "maket:runtime:state",
	runtimeOpenHome: "maket:runtime:open-home",
	runtimeChooseWorkspace: "maket:runtime:choose-workspace",
	runtimeOpenWorkspace: "maket:runtime:open-workspace",
	runtimeOpenBrowser: "maket:runtime:open-browser",
	runtimeCopyUrl: "maket:runtime:copy-url",
	runtimePrintDocument: "maket:runtime:print-document",
	command: "maket:command",
	mcpDiagnose: "maket:mcp:diagnose",
	updateState: "maket:update:state",
	updateCheck: "maket:update:check",
	updateInstall: "maket:update:install",
	updateStateChanged: "maket:update:state-changed",
} as const;

export type DesktopCommand =
	| "toggle-library"
	| "show-documents"
	| "show-chartes"
	| "show-photos"
	| "show-collections"
	| "toggle-exchanges"
	| "reading-view"
	| "fit-view"
	| "toggle-document-lock"
	| "print-document"
	| "toggle-auto-fit"
	| "open-help"
	| "toggle-language"
	| "toggle-theme";

export type DesktopUpdateStatus =
	| "idle"
	| "checking"
	| "available"
	| "downloading"
	| "ready"
	| "up-to-date"
	| "error";

export interface DesktopUpdateState {
	status: DesktopUpdateStatus;
	version?: string;
	progress?: number;
	message?: string;
}

export interface DesktopRuntimeState {
	owner: "electron";
	workspace: string;
	url: string;
	version: string;
}

export interface McpConfigurationFinding {
	client: "claude" | "codex" | "gemini";
	scope: "user" | "project";
	path: string;
	status: "missing" | "valid" | "outdated" | "conflicting";
	detail: string;
}

export interface DesktopApi {
	readonly version: typeof DESKTOP_API_VERSION;
	readonly platform: "darwin" | "win32" | "linux";
	runtime: {
		getState(): Promise<DesktopRuntimeState>;
		openHome(): Promise<void>;
		chooseWorkspace(): Promise<string | null>;
		openWorkspace(path: string): Promise<void>;
		openInBrowser(): Promise<void>;
		copyServerUrl(): Promise<void>;
		printDocument(name: string): Promise<void>;
	};
	commands: {
		onCommand(listener: (command: DesktopCommand) => void): () => void;
	};
	mcp: {
		diagnose(): Promise<McpConfigurationFinding[]>;
	};
	updates: {
		getState(): Promise<DesktopUpdateState>;
		check(): Promise<void>;
		install(): Promise<void>;
		onState(listener: (state: DesktopUpdateState) => void): () => void;
	};
}

declare global {
	interface Window {
		maketDesktop?: DesktopApi;
	}
}
