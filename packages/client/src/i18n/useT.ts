import { useEffect, useState } from "react";
import en from "./en.json";
import fr from "./fr.json";

const LANGS: Record<string, Record<string, string>> = { fr, en };

const STORAGE_KEY = "maket-lang";

function safeGet(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function safeSet(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* noop — test envs, private mode, quota */
	}
}

function detectLang(): string {
	const saved = safeGet(STORAGE_KEY);
	if (saved && LANGS[saved]) return saved;
	const nav =
		typeof navigator !== "undefined" ? navigator.language.slice(0, 2) : "en";
	return LANGS[nav] ? nav : "en";
}

let currentLang = detectLang();
const listeners = new Set<() => void>();

export function setLang(lang: string) {
	if (LANGS[lang]) {
		currentLang = lang;
		safeSet(STORAGE_KEY, lang);
		listeners.forEach((fn) => {
			fn();
		});
	}
}

export function toggleLang(): void {
	setLang(currentLang === "fr" ? "en" : "fr");
}

export function getLang(): string {
	return currentLang;
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

	return (key: string, vars?: Record<string, string | number>): string => {
		let text = LANGS[currentLang]?.[key] ?? LANGS.en[key] ?? key;
		if (vars) {
			for (const [k, v] of Object.entries(vars)) {
				text = text.replace(`{${k}}`, String(v));
			}
		}
		return text;
	};
}
