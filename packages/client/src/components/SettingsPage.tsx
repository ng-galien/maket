import { Check, Monitor, Moon, Sun, X } from "lucide-react";
import type { ReactNode } from "react";
import { getLang, setLang, useT } from "../i18n/useT";
import type { ThemeMode } from "../lib/colorScheme";
import { useStore } from "../store/useStore";

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
	const themeMode = useStore((state) => state.themeMode);
	const setThemeMode = useStore((state) => state.setThemeMode);
	const accentColor = useStore((state) => state.accentColor);
	const setAccentColor = useStore((state) => state.setAccentColor);
	const autoFocusFit = useStore((state) => state.autoFocusFit);
	const toggleAutoFocusFit = useStore((state) => state.toggleAutoFocusFit);
	const language = getLang();

	return (
		<main data-settings-page className="h-full min-h-0 overflow-y-auto bg-app">
			<div className="mx-auto w-full max-w-4xl px-8 py-8 max-sm:px-5 max-sm:py-5">
				<header className="flex items-start gap-6 pb-8">
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
						className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-text-3 transition-colors hover:bg-input hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
					>
						<X size={16} />
					</button>
				</header>

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
								onClick={() => setLang("fr")}
							/>
							<ChoiceButton
								active={language === "en"}
								label="English"
								onClick={() => setLang("en")}
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
						<div className="flex flex-wrap items-center gap-2">
							{ACCENT_PRESETS.map((preset) => {
								const active = accentColor === preset.value;
								return (
									<button
										type="button"
										key={preset.value}
										onClick={() => setAccentColor(preset.value)}
										aria-label={preset.name}
										aria-pressed={active}
										title={preset.name}
										className={`grid h-8 w-8 place-items-center rounded-sm border transition-[border-color,transform] hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${active ? "border-text-1" : "border-border"}`}
										style={{ backgroundColor: preset.value }}
									>
										{active && <Check size={14} className="text-white" />}
									</button>
								);
							})}
							<label className="relative grid h-8 w-8 cursor-pointer place-items-center overflow-hidden rounded-sm border border-border bg-panel focus-within:ring-2 focus-within:ring-accent">
								<span
									className="h-5 w-5 rounded-sm border border-black/10"
									style={{ backgroundColor: accentColor }}
								/>
								<input
									type="color"
									value={accentColor}
									onChange={(event) => setAccentColor(event.target.value)}
									aria-label={t("settings_accent_custom")}
									className="absolute inset-0 cursor-pointer opacity-0"
								/>
							</label>
						</div>
					</SettingRow>
				</SettingsSection>

				<SettingsSection
					title={t("settings_workspace")}
					description={t("settings_workspace_description")}
				>
					<SettingRow
						label={t("settings_auto_focus")}
						description={t("settings_auto_focus_description")}
					>
						<button
							type="button"
							role="switch"
							aria-checked={autoFocusFit}
							onClick={toggleAutoFocusFit}
							className={`relative h-6 w-10 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${autoFocusFit ? "bg-accent" : "bg-border-hover"}`}
						>
							<span
								className={`absolute left-0 top-1 h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${autoFocusFit ? "translate-x-5" : "translate-x-1"}`}
							/>
						</button>
					</SettingRow>
				</SettingsSection>
			</div>
		</main>
	);
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
		<section className="grid grid-cols-[11rem_minmax(0,1fr)] gap-8 border-t border-border py-7 max-md:grid-cols-1 max-md:gap-4">
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
			<div className="shrink-0">{children}</div>
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
			className="flex rounded-md bg-input p-0.5"
		>
			{children}
		</div>
	);
}

function ChoiceButton({
	active,
	label,
	onClick,
	icon,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
	icon?: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={`flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${active ? "bg-panel text-text-1 shadow-xs" : "text-text-2 hover:text-text-1"}`}
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
