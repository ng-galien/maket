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
	mcpInstall: "maket:mcp:install",
	mcpUninstall: "maket:mcp:uninstall",
	configurationPlan: "maket:configuration:plan",
	configurationApplyOnboarding: "maket:configuration:apply-onboarding",
	configurationVerifyOnboarding: "maket:configuration:verify-onboarding",
	configurationActivateRuntime: "maket:configuration:activate-runtime",
	configurationInstallClaudeDesktop:
		"maket:configuration:install-claude-desktop",
	configurationAcknowledgeRestarts: "maket:configuration:acknowledge-restarts",
	updateState: "maket:update:state",
	updateCheck: "maket:update:check",
	updateInstall: "maket:update:install",
	updateChannel: "maket:update:channel",
	updateSetChannel: "maket:update:set-channel",
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
	| "unavailable"
	| "error";

export type DesktopUpdateChannel = "stable" | "candidate";
export type DesktopUpdateReason =
	| "development-build"
	| "local-build"
	| "service-unavailable";

export interface DesktopUpdateState {
	status: DesktopUpdateStatus;
	channel: DesktopUpdateChannel;
	currentVersion: string;
	version?: string;
	progress?: number;
	reason?: DesktopUpdateReason;
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
	detected: boolean;
	managed: boolean;
	skillPath: string;
	mcpStatus: "missing" | "valid" | "outdated" | "conflicting";
	skillStatus: "missing" | "valid" | "outdated" | "conflicting";
}

export interface DesktopConfigurationPlan {
	endpoint: string;
	onboardingRequired: boolean;
	awaitingClaudeDesktop: boolean;
	runtime: {
		status: "ready" | "action-required";
		owner?: "headless" | "legacy";
		host?: string;
		port?: number;
	};
	findings: McpConfigurationFinding[];
	manualClients: ClaudeDesktopConfiguration[];
	restartClients: Array<"claude" | "codex" | "gemini">;
}

export type DesktopConfigurationAction =
	| "runtime"
	| McpConfigurationFinding["client"]
	| "claude-desktop";

export interface DesktopOnboardingSelection {
	actions: DesktopConfigurationAction[];
}

export interface DesktopOnboardingActionResult {
	action: DesktopConfigurationAction;
	status: "applied" | "confirmation-required" | "failed";
	detail?: string;
}

export interface DesktopOnboardingResult {
	plan: DesktopConfigurationPlan;
	results: DesktopOnboardingActionResult[];
}

export interface ClaudeDesktopConfiguration {
	client: "claude-desktop";
	name: string;
	detected: boolean;
	status: "not-detected" | "missing" | "valid" | "outdated" | "unknown";
	bundledVersion: string;
	installedVersion?: string;
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
		install(
			client: McpConfigurationFinding["client"],
		): Promise<McpConfigurationFinding[]>;
		uninstall(
			client: McpConfigurationFinding["client"],
		): Promise<McpConfigurationFinding[]>;
	};
	configuration: {
		getPlan(): Promise<DesktopConfigurationPlan>;
		applyOnboarding(
			selection: DesktopOnboardingSelection,
		): Promise<DesktopOnboardingResult>;
		verifyOnboarding(): Promise<DesktopConfigurationPlan>;
		activateRuntime(): Promise<void>;
		installClaudeDesktop(): Promise<void>;
		acknowledgeRestarts(): Promise<DesktopConfigurationPlan>;
	};
	updates: {
		getState(): Promise<DesktopUpdateState>;
		getChannel(): Promise<DesktopUpdateChannel>;
		setChannel(channel: DesktopUpdateChannel): Promise<DesktopUpdateState>;
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
