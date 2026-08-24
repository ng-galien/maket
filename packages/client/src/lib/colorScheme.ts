export type ThemeMode = "system" | "light" | "dark";

export const DEFAULT_ACCENT_COLOR = "#10b981";
export const LIGHT_ACCENT_CONTENT = "#ffffff";
export const DARK_ACCENT_CONTENT = "#000000";

export function applyColorScheme(
	darkMode: boolean,
	root: HTMLElement = document.documentElement,
): void {
	const scheme = darkMode ? "dark" : "light";
	root.style.colorScheme = scheme;
	root.dataset.theme = scheme;
}

export function resolveDarkMode(
	mode: ThemeMode,
	systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches,
): boolean {
	return mode === "system" ? systemDark : mode === "dark";
}

export function normalizeAccentColor(value: string): string {
	return /^#[0-9a-f]{6}$/i.test(value)
		? value.toLowerCase()
		: DEFAULT_ACCENT_COLOR;
}

export function applyAccentColor(
	value: string,
	root: HTMLElement = document.documentElement,
): void {
	const accent = normalizeAccentColor(value);
	root.style.setProperty("--color-accent", accent);
	root.style.setProperty(
		"--color-accent-contrast",
		accentContrastColor(accent),
	);
}

export function accentContrastColor(value: string): string {
	const accent = normalizeAccentColor(value);
	return contrastRatio(accent, LIGHT_ACCENT_CONTENT) >=
		contrastRatio(accent, DARK_ACCENT_CONTENT)
		? LIGHT_ACCENT_CONTENT
		: DARK_ACCENT_CONTENT;
}

function contrastRatio(first: string, second: string): number {
	const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
	const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
	return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
	const [red, green, blue] = [1, 3, 5].map(
		(offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
	);
	return (
		0.2126 * linear(red ?? 0) +
		0.7152 * linear(green ?? 0) +
		0.0722 * linear(blue ?? 0)
	);
}

function linear(channel: number): number {
	return channel <= 0.04045
		? channel / 12.92
		: ((channel + 0.055) / 1.055) ** 2.4;
}
