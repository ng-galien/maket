export type ThemeMode = "system" | "light" | "dark";

export const DEFAULT_ACCENT_COLOR = "#10b981";

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
	root.style.setProperty("--color-accent", normalizeAccentColor(value));
}
