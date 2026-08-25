// ============================================================
// User settings — the panel preferences, persisted server-side in a single
// user-level JSON file so they survive port changes, workspace switches, and
// the renderer's per-origin localStorage.
//
// Layout and session state (library width, open documents, focused document)
// deliberately stay in localStorage: they describe one window, not the user.
// ============================================================

import type { DesktopUpdateChannel } from "./desktop.js";

export type SettingsThemeMode = "system" | "light" | "dark";
export type SettingsLanguage = "fr" | "en";

export interface Settings {
	language: SettingsLanguage;
	themeMode: SettingsThemeMode;
	accentColor: string;
	autoFocusFit: boolean;
	updateChannel: DesktopUpdateChannel;
}

export const SETTINGS_FILE = "settings.json";

export const DEFAULT_SETTINGS: Settings = {
	language: "en",
	themeMode: "system",
	accentColor: "#10b981",
	autoFocusFit: true,
	updateChannel: "stable",
};

const LANGUAGES: readonly SettingsLanguage[] = ["fr", "en"];
const THEME_MODES = [
	"system",
	"light",
	"dark",
] as const satisfies readonly SettingsThemeMode[];
const UPDATE_CHANNELS: readonly DesktopUpdateChannel[] = [
	"stable",
	"candidate",
];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Accept a six-digit hex accent, lowercased; anything else falls back. */
export function normalizeAccentColor(value: string): string {
	return HEX_COLOR.test(value)
		? value.toLowerCase()
		: DEFAULT_SETTINGS.accentColor;
}

function pick<T extends string>(
	value: unknown,
	allowed: readonly T[],
	fallback: T,
): T {
	return typeof value === "string" &&
		(allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback;
}

/** Coerce anything read from disk or the wire into a complete Settings value.
 *  A malformed field falls back to its default rather than failing the whole read. */
export function normalizeSettings(value: unknown): Settings {
	const input = (
		value && typeof value === "object" && !Array.isArray(value) ? value : {}
	) as Partial<Record<keyof Settings, unknown>>;
	return {
		language: pick(input.language, LANGUAGES, DEFAULT_SETTINGS.language),
		themeMode: pick(input.themeMode, THEME_MODES, DEFAULT_SETTINGS.themeMode),
		accentColor:
			typeof input.accentColor === "string"
				? normalizeAccentColor(input.accentColor)
				: DEFAULT_SETTINGS.accentColor,
		autoFocusFit:
			typeof input.autoFocusFit === "boolean"
				? input.autoFocusFit
				: DEFAULT_SETTINGS.autoFocusFit,
		updateChannel: pick(
			input.updateChannel,
			UPDATE_CHANNELS,
			DEFAULT_SETTINGS.updateChannel,
		),
	};
}
