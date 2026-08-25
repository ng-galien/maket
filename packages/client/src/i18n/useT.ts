import type { SettingsLanguage } from "@maket/shared";
import { useEffect, useState } from "react";
import en from "./en.json";
import fr from "./fr.json";

const LANGS: Record<SettingsLanguage, Record<string, string>> = { fr, en };

/** The persisted language lives in the settings file; this is only the value
 *  shown until the server's snapshot arrives. */
function detectLang(): SettingsLanguage {
	const nav =
		typeof navigator !== "undefined" ? navigator.language.slice(0, 2) : "en";
	return nav === "fr" ? "fr" : "en";
}

let currentLang = detectLang();
const listeners = new Set<() => void>();

/** Every listener is a forced re-render of a `useT` consumer, so a repeat of
 *  the current language must not reach them. */
export function setLang(lang: SettingsLanguage): void {
	if (lang === currentLang) return;
	currentLang = lang;
	listeners.forEach((fn) => {
		fn();
	});
}

/** Returns the language now in effect so callers can persist it. */
export function toggleLang(): SettingsLanguage {
	setLang(currentLang === "fr" ? "en" : "fr");
	return currentLang;
}

export function getLang(): SettingsLanguage {
	return currentLang;
}

/** Translate outside React — error paths and the store have no hook to call.
 *  Components use `useT` so they re-render when the language changes. */
export type TranslationKey = keyof typeof en;

export function translate(
	key: TranslationKey,
	vars?: Record<string, string | number>,
): string {
	let text = LANGS[currentLang]?.[key] ?? LANGS.en[key] ?? key;
	if (vars) {
		for (const [k, v] of Object.entries(vars)) {
			text = text.replaceAll(`{${k}}`, String(v));
		}
	}
	return text;
}

export function useT() {
	const [, forceUpdate] = useState(0);

	useEffect(() => {
		const fn = () => forceUpdate((n) => n + 1);
		listeners.add(fn);
		return () => {
			listeners.delete(fn);
		};
	}, []);

	return translate;
}
