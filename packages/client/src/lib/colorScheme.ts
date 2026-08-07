export function applyColorScheme(
	darkMode: boolean,
	root: HTMLElement = document.documentElement,
): void {
	const scheme = darkMode ? "dark" : "light";
	root.style.colorScheme = scheme;
	root.dataset.theme = scheme;
}
