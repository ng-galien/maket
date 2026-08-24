import type {
	ClaudeDesktopConfiguration,
	McpConfigurationFinding,
	SettingsLanguage,
} from "@maket/shared";
import {
	Check,
	Copy,
	LoaderCircle,
	Monitor,
	Moon,
	RefreshCw,
	RotateCcw,
	Sun,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
	acknowledgeDesktopRestarts,
	activateDesktopRuntime,
	installClaudeDesktopBundle,
	refreshDesktopConfiguration,
	useDesktopConfiguration,
} from "../desktopConfiguration";
import {
	checkDesktopUpdates,
	installDesktopUpdate,
	selectDesktopUpdateChannel,
	useDesktopUpdates,
} from "../desktopUpdates";
import { getLang, setLang, useT } from "../i18n/useT";
import type { ThemeMode } from "../lib/colorScheme";
import { useStore } from "../store/useStore";
import { sendSettings } from "../store/ws";
import { copyToClipboard } from "../utils";

const ACCENT_PRESETS = [
	{ name: "Emerald", value: "#10b981" },
	{ name: "Ocean", value: "#0284c7" },
	{ name: "Indigo", value: "#6366f1" },
	{ name: "Violet", value: "#8b5cf6" },
	{ name: "Amber", value: "#d97706" },
] as const;

export function SettingsPage() {
	const t = useT();
	const closeSettings = useStore((state) => state.closeSettings);

	return (
		<main
			data-settings-page
			className="flex h-full min-h-0 flex-col overflow-hidden bg-panel"
		>
			<header
				data-settings-header
				className="shrink-0 border-b border-border bg-panel"
			>
				<div className="mx-auto flex w-full max-w-4xl items-center gap-6 px-8 py-5 max-sm:px-5 max-sm:py-4">
					<div className="min-w-0 flex-1">
						<h1 className="text-xl font-bold tracking-tight text-text-1">
							{t("settings")}
						</h1>
						<p className="mt-1 max-w-2xl text-sm leading-5 text-text-2">
							{t("settings_description")}
						</p>
					</div>
					<button
						type="button"
						onClick={closeSettings}
						aria-label={t("close_settings")}
						title={t("close_settings")}
						className="flex h-9 shrink-0 items-center gap-2 rounded-sm border border-border bg-input px-3 text-sm font-semibold text-text-2 transition-colors hover:border-border-hover hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
					>
						<X size={16} strokeWidth={2.25} />
						<span>{t("close")}</span>
					</button>
				</div>
			</header>

			<div
				data-settings-scroll-region
				className="min-h-0 flex-1 overflow-y-auto bg-panel"
			>
				<div className="mx-auto w-full max-w-4xl px-8 pb-10 max-sm:px-5">
					<AppearanceSettings />
					<WorkspaceSettings />
					<AgentSettings />
					<UpdateSettings />
				</div>
			</div>
		</main>
	);
}

function AgentSettings() {
	const t = useT();
	const desktop = window.maketDesktop;
	const configuration = useDesktopConfiguration();
	const [findings, setFindings] = useState<McpConfigurationFinding[]>([]);
	const [endpoint, setEndpoint] = useState("");
	const [busy, setBusy] = useState<McpConfigurationFinding["client"] | null>(
		null,
	);
	const [error, setError] = useState("");

	useEffect(() => {
		if (!desktop) return;
		if (configuration.plan) {
			setFindings(configuration.plan.findings);
			setEndpoint(configuration.plan.endpoint);
			return;
		}
		void Promise.all([desktop.mcp.diagnose(), desktop.runtime.getState()])
			.then(([nextFindings, runtime]) => {
				setFindings(nextFindings);
				setEndpoint(`${runtime.url.replace(/\/$/, "")}/mcp`);
			})
			.catch((reason: unknown) => {
				setError(reason instanceof Error ? reason.message : String(reason));
			});
	}, [configuration.plan, desktop]);

	if (!desktop) return null;
	const desktopApi = desktop;

	async function apply(
		client: McpConfigurationFinding["client"],
		uninstall: boolean,
	) {
		setBusy(client);
		setError("");
		try {
			setFindings(
				await (uninstall
					? desktopApi.mcp.uninstall(client)
					: desktopApi.mcp.install(client)),
			);
			await refreshDesktopConfiguration();
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(null);
		}
	}

	return (
		<SettingsSection
			title={t("settings_agents")}
			description={t("settings_agents_description")}
		>
			<McpEndpointRow endpoint={endpoint} />
			<RuntimeConfigurationRows configuration={configuration} />
			{findings.map((finding) => (
				<AgentFindingRow
					key={finding.client}
					finding={finding}
					busy={busy}
					apply={apply}
				/>
			))}
			{configuration.plan?.manualClients.map((client) => (
				<ClaudeDesktopAgentRow key={client.client} client={client} />
			))}
			{(error || configuration.error) && (
				<p role="alert" className="pt-3 text-xs text-danger">
					{error || configuration.error}
				</p>
			)}
		</SettingsSection>
	);
}

function McpEndpointRow({ endpoint }: { endpoint: string }) {
	const t = useT();
	const [copied, setCopied] = useState(false);
	return (
		<SettingRow
			label={t("settings_mcp_server")}
			description={t("settings_mcp_server_description")}
		>
			<button
				type="button"
				disabled={!endpoint}
				onClick={async () => {
					if (!endpoint || !(await copyToClipboard(endpoint))) return;
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1600);
				}}
				aria-label={copied ? t("settings_mcp_copied") : t("settings_mcp_copy")}
				title={copied ? t("settings_mcp_copied") : t("settings_mcp_copy")}
				className="flex h-8 max-w-full items-center gap-2 rounded-sm border border-border bg-input px-2.5 font-mono text-xs text-text-2 transition-colors hover:border-border-hover hover:text-text-1 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
			>
				<span className="truncate">
					{endpoint || t("settings_mcp_loading")}
				</span>
				{copied ? (
					<Check size={13} className="shrink-0 text-accent" />
				) : (
					<Copy size={13} className="shrink-0" />
				)}
			</button>
		</SettingRow>
	);
}

function RuntimeConfigurationRows({
	configuration,
}: {
	configuration: ReturnType<typeof useDesktopConfiguration>;
}) {
	const t = useT();
	const plan = configuration.plan;
	return (
		<>
			{plan?.runtime.status === "action-required" && (
				<SettingRow
					label={t("agent_setup_runtime_label")}
					description={t("agent_setup_runtime_description", {
						port: plan.runtime.port ?? 24842,
					})}
				>
					<UpdateActionButton
						disabled={configuration.status === "applying"}
						onClick={() => void activateDesktopRuntime()}
					>
						{t("agent_setup_activate_runtime")}
					</UpdateActionButton>
				</SettingRow>
			)}
			{plan && plan.restartClients.length > 0 && (
				<SettingRow
					label={t("agent_setup_restart_title")}
					description={t("agent_setup_restart_clients", {
						clients: plan.restartClients
							.map((client) => agentName(client))
							.join(", "),
					})}
				>
					<UpdateActionButton onClick={() => void acknowledgeDesktopRestarts()}>
						{t("agent_setup_restart_acknowledge")}
					</UpdateActionButton>
				</SettingRow>
			)}
		</>
	);
}

function AgentFindingRow({
	finding,
	busy,
	apply,
}: {
	finding: McpConfigurationFinding;
	busy: McpConfigurationFinding["client"] | null;
	apply: (
		client: McpConfigurationFinding["client"],
		uninstall: boolean,
	) => void;
}) {
	const t = useT();
	return (
		<SettingRow
			label={agentName(finding.client)}
			description={agentStatusText(finding, t)}
		>
			{finding.managed ? (
				<UpdateActionButton
					disabled={busy !== null}
					onClick={() => apply(finding.client, true)}
				>
					{t("settings_agent_uninstall")}
				</UpdateActionButton>
			) : finding.status === "valid" ? (
				<span className="text-xs font-semibold text-accent">
					{t("settings_agent_configured")}
				</span>
			) : (
				<UpdateActionButton
					disabled={busy !== null}
					onClick={() => apply(finding.client, false)}
				>
					{busy === finding.client && (
						<LoaderCircle size={13} className="animate-spin" />
					)}
					{finding.status === "outdated"
						? t("settings_agent_migrate")
						: t("settings_agent_install")}
				</UpdateActionButton>
			)}
		</SettingRow>
	);
}

function ClaudeDesktopAgentRow({
	client,
}: {
	client: ClaudeDesktopConfiguration;
}) {
	const t = useT();
	const [opening, setOpening] = useState(false);
	const [checking, setChecking] = useState(false);
	const [feedback, setFeedback] = useState<
		{ kind: "success" | "error"; message: string } | undefined
	>();
	const actionLabel =
		client.status === "valid"
			? t("agent_setup_reinstall_claude_desktop")
			: client.status === "outdated"
				? t("agent_setup_update_claude_desktop")
				: client.status === "unknown"
					? t("agent_setup_open_claude_desktop_installer")
					: t("agent_setup_install_claude_desktop");
	return (
		<SettingRow
			label={client.name}
			description={claudeDesktopStatusText(client, t)}
		>
			<div className="flex max-w-sm flex-col items-end gap-2 max-sm:items-start">
				<div className="flex flex-wrap justify-end gap-2 max-sm:justify-start">
					<UpdateActionButton
						disabled={!client.detected || opening || checking}
						onClick={() => {
							setOpening(true);
							setFeedback(undefined);
							void installClaudeDesktopBundle()
								.then(() => {
									setFeedback({
										kind: "success",
										message: t("agent_setup_claude_installer_opened"),
									});
								})
								.catch((error: unknown) => {
									setFeedback({
										kind: "error",
										message:
											error instanceof Error ? error.message : String(error),
									});
								})
								.finally(() => setOpening(false));
						}}
					>
						{opening && <LoaderCircle size={13} className="animate-spin" />}
						{actionLabel}
					</UpdateActionButton>
					<UpdateActionButton
						disabled={opening || checking}
						onClick={() => {
							setChecking(true);
							setFeedback(undefined);
							void refreshDesktopConfiguration()
								.then((refreshed) => {
									if (refreshed) {
										setFeedback({
											kind: "success",
											message: t("agent_setup_claude_status_checked"),
										});
									}
								})
								.finally(() => setChecking(false));
						}}
					>
						{checking ? (
							<LoaderCircle size={13} className="animate-spin" />
						) : (
							<RefreshCw size={13} />
						)}
						{t("agent_setup_refresh_claude_desktop")}
					</UpdateActionButton>
				</div>
				{feedback && (
					<p
						role={feedback.kind === "error" ? "alert" : "status"}
						className={`text-right text-xs leading-4 max-sm:text-left ${
							feedback.kind === "error" ? "text-danger" : "text-text-2"
						}`}
					>
						{feedback.message}
					</p>
				)}
			</div>
		</SettingRow>
	);
}

function claudeDesktopStatusText(
	client: ClaudeDesktopConfiguration,
	t: ReturnType<typeof useT>,
): string {
	if (client.status === "not-detected") {
		return t("agent_setup_claude_not_detected");
	}
	if (client.status === "missing") {
		return t("agent_setup_claude_missing", { version: client.bundledVersion });
	}
	if (client.status === "valid") {
		return t("agent_setup_claude_valid", { version: client.bundledVersion });
	}
	if (client.status === "outdated") {
		return t("agent_setup_claude_outdated", {
			installed:
				client.installedVersion ?? t("agent_setup_claude_unknown_version"),
			bundled: client.bundledVersion,
		});
	}
	return t("agent_setup_claude_unknown", { version: client.bundledVersion });
}

function agentName(client: McpConfigurationFinding["client"]): string {
	if (client === "claude") return "Claude Code";
	if (client === "codex") return "Codex";
	return "Gemini";
}

function agentStatusText(
	finding: McpConfigurationFinding,
	t: ReturnType<typeof useT>,
): string {
	const status = t(`settings_agent_status_${finding.status}`);
	const pieces = [
		`${t("settings_agent_mcp")}: ${t(`settings_agent_part_${finding.mcpStatus}`)}`,
		`${t("settings_agent_skill")}: ${t(`settings_agent_part_${finding.skillStatus}`)}`,
	];
	return `${status} · ${pieces.join(" · ")}`;
}

function AppearanceSettings() {
	const t = useT();
	const language = getLang();
	const themeMode = useStore((state) => state.themeMode);
	const setThemeMode = useStore((state) => state.setThemeMode);
	const accentColor = useStore((state) => state.accentColor);
	const setAccentColor = useStore((state) => state.setAccentColor);
	return (
		<SettingsSection
			title={t("settings_appearance")}
			description={t("settings_appearance_description")}
		>
			<SettingRow
				label={t("language")}
				description={t("settings_language_description")}
			>
				<ChoiceGroup label={t("language")}>
					<ChoiceButton
						active={language === "fr"}
						label="Français"
						onClick={() => selectLanguage("fr")}
					/>
					<ChoiceButton
						active={language === "en"}
						label="English"
						onClick={() => selectLanguage("en")}
					/>
				</ChoiceGroup>
			</SettingRow>
			<SettingRow
				label={t("settings_theme")}
				description={t("settings_theme_description")}
			>
				<ChoiceGroup label={t("settings_theme")}>
					<ThemeChoice
						mode="system"
						active={themeMode === "system"}
						label={t("settings_theme_system")}
						icon={<Monitor size={14} />}
						onSelect={setThemeMode}
					/>
					<ThemeChoice
						mode="light"
						active={themeMode === "light"}
						label={t("settings_theme_light")}
						icon={<Sun size={14} />}
						onSelect={setThemeMode}
					/>
					<ThemeChoice
						mode="dark"
						active={themeMode === "dark"}
						label={t("settings_theme_dark")}
						icon={<Moon size={14} />}
						onSelect={setThemeMode}
					/>
				</ChoiceGroup>
			</SettingRow>
			<SettingRow
				label={t("settings_accent")}
				description={t("settings_accent_description")}
			>
				<AccentChoices
					value={accentColor}
					onChange={setAccentColor}
					customLabel={t("settings_accent_custom")}
				/>
			</SettingRow>
		</SettingsSection>
	);
}

/** The settings file is the source of truth; setLang paints immediately. */
function selectLanguage(language: SettingsLanguage): void {
	setLang(language);
	sendSettings({ language });
}

function AccentChoices({
	value,
	onChange,
	customLabel,
}: {
	value: string;
	onChange: (value: string) => void;
	customLabel: string;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			{ACCENT_PRESETS.map((preset) => {
				const active = value === preset.value;
				return (
					<button
						type="button"
						key={preset.value}
						onClick={() => onChange(preset.value)}
						aria-label={preset.name}
						aria-pressed={active}
						title={preset.name}
						className={`grid h-8 w-8 place-items-center rounded-sm border transition-[border-color,transform] hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${active ? "border-text-1" : "border-border"}`}
						style={{ backgroundColor: preset.value }}
					>
						{active && <Check size={14} className="text-accent-contrast" />}
					</button>
				);
			})}
			<label className="relative grid h-8 w-8 cursor-pointer place-items-center overflow-hidden rounded-sm border border-border bg-input focus-within:ring-2 focus-within:ring-accent">
				<span
					className="h-5 w-5 rounded-sm border border-black/10"
					style={{ backgroundColor: value }}
				/>
				<input
					type="color"
					value={value}
					onChange={(event) => onChange(event.target.value)}
					aria-label={customLabel}
					className="absolute inset-0 cursor-pointer opacity-0"
				/>
			</label>
		</div>
	);
}

function WorkspaceSettings() {
	const t = useT();
	const autoFocusFit = useStore((state) => state.autoFocusFit);
	const setAutoFocusFit = useStore((state) => state.setAutoFocusFit);
	return (
		<SettingsSection
			title={t("settings_workspace")}
			description={t("settings_workspace_description")}
		>
			<SettingRow
				label={t("settings_auto_focus")}
				description={t("settings_auto_focus_description")}
			>
				<ChoiceGroup label={t("settings_auto_focus")}>
					<ChoiceButton
						active={autoFocusFit}
						label={t("settings_on")}
						onClick={() => setAutoFocusFit(true)}
					/>
					<ChoiceButton
						active={!autoFocusFit}
						label={t("settings_off")}
						onClick={() => setAutoFocusFit(false)}
					/>
				</ChoiceGroup>
			</SettingRow>
		</SettingsSection>
	);
}

function UpdateSettings() {
	const t = useT();
	const update = useDesktopUpdates();
	const busy = update.status === "checking" || update.status === "downloading";
	const channelLocked = busy || update.status === "ready";
	return (
		<SettingsSection
			title={t("settings_updates")}
			description={t("settings_updates_description")}
		>
			<SettingRow
				label={t("settings_update_channel")}
				description={t("settings_update_channel_description")}
			>
				<ChoiceGroup label={t("settings_update_channel")}>
					<ChoiceButton
						active={update.channel === "stable"}
						disabled={channelLocked}
						label={t("settings_update_stable")}
						onClick={() => void selectDesktopUpdateChannel("stable")}
					/>
					<ChoiceButton
						active={update.channel === "candidate"}
						disabled={channelLocked}
						label={t("settings_update_candidate")}
						onClick={() => void selectDesktopUpdateChannel("candidate")}
					/>
				</ChoiceGroup>
			</SettingRow>
			<SettingRow
				label={t("settings_update_status")}
				description={updateStatusText(update, t)}
			>
				<div className="flex items-center gap-3">
					{update.currentVersion ? (
						<span className="text-xs tabular-nums text-text-3">
							v{update.currentVersion}
						</span>
					) : null}
					{update.status === "ready" ? (
						<UpdateActionButton onClick={() => void installDesktopUpdate()}>
							<RotateCcw size={13} />
							{t("settings_update_restart")}
						</UpdateActionButton>
					) : (
						<UpdateActionButton
							disabled={busy}
							onClick={() => void checkDesktopUpdates()}
						>
							{busy ? (
								<LoaderCircle size={13} className="animate-spin" />
							) : (
								<RefreshCw size={13} />
							)}
							{t("settings_update_check")}
						</UpdateActionButton>
					)}
				</div>
				<UpdateProgress state={update} />
			</SettingRow>
		</SettingsSection>
	);
}

function UpdateActionButton({
	children,
	onClick,
	disabled = false,
}: {
	children: ReactNode;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className="flex h-8 items-center gap-1.5 rounded-sm border border-border bg-input px-2.5 text-xs font-semibold text-text-2 transition-colors hover:border-border-hover hover:text-text-1 disabled:cursor-default disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
		>
			{children}
		</button>
	);
}

function UpdateProgress({
	state,
}: {
	state: ReturnType<typeof useDesktopUpdates>;
}) {
	if (state.status !== "checking" && state.status !== "downloading")
		return null;
	const determinate = state.progress != null;
	return (
		<div
			className="mt-2 h-0.5 w-full overflow-hidden bg-border"
			aria-hidden="true"
		>
			<span
				className={`block h-full bg-accent ${determinate ? "" : "w-2/3 animate-pulse"}`}
				style={
					determinate
						? { width: `${Math.max(0, Math.min(100, state.progress ?? 0))}%` }
						: undefined
				}
			/>
		</div>
	);
}

function updateStatusText(
	state: ReturnType<typeof useDesktopUpdates>,
	t: ReturnType<typeof useT>,
): string {
	const version = state.version ? ` · v${state.version}` : "";
	const reason = state.reason
		? ` · ${t(`settings_update_reason_${state.reason}`)}`
		: "";
	const message = state.message ? ` · ${state.message}` : "";
	return `${t(`settings_update_status_${state.status}`)}${version}${reason}${message}`;
}

function SettingsSection({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<section className="grid grid-cols-[11rem_minmax(0,1fr)] gap-8 border-t border-border py-7 first:border-t-0 max-md:grid-cols-1 max-md:gap-4">
			<div>
				<h2 className="text-base font-bold text-text-1">{title}</h2>
				<p className="mt-1 text-xs leading-4 text-text-2">{description}</p>
			</div>
			<div className="min-w-0 divide-y divide-border">{children}</div>
		</section>
	);
}

function SettingRow({
	label,
	description,
	children,
}: {
	label: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<div className="flex min-w-0 items-center gap-6 py-4 first:pt-0 last:pb-0 max-sm:items-start max-sm:flex-col max-sm:gap-3">
			<div className="min-w-0 flex-1">
				<h3 className="text-sm font-semibold text-text-1">{label}</h3>
				<p className="mt-0.5 text-xs leading-4 text-text-2">{description}</p>
			</div>
			<div className="shrink-0 max-sm:w-full">{children}</div>
		</div>
	);
}

function ChoiceGroup({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div
			role="group"
			aria-label={label}
			className="flex rounded-sm border border-border bg-input p-0.5"
		>
			{children}
		</div>
	);
}

function ChoiceButton({
	active,
	disabled = false,
	label,
	onClick,
	icon,
}: {
	active: boolean;
	disabled?: boolean;
	label: string;
	onClick: () => void;
	icon?: ReactNode;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			aria-pressed={active}
			className={`flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-semibold transition-colors disabled:cursor-default disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${active ? "bg-panel text-text-1 shadow-xs" : "text-text-2 hover:text-text-1"}`}
		>
			{icon}
			{label}
		</button>
	);
}

function ThemeChoice({
	mode,
	active,
	label,
	icon,
	onSelect,
}: {
	mode: ThemeMode;
	active: boolean;
	label: string;
	icon: ReactNode;
	onSelect: (mode: ThemeMode) => void;
}) {
	return (
		<ChoiceButton
			active={active}
			label={label}
			icon={icon}
			onClick={() => onSelect(mode)}
		/>
	);
}
