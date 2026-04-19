import { useEffect, useState } from "react";
import en from "./en.json";
import fr from "./fr.json";

const LANGS: Record<string, Record<string, string>> = { fr, en };

function detectLang(): string {
	const nav = navigator.language.slice(0, 2);
	return LANGS[nav] ? nav : "en";
}

let currentLang = detectLang();
const listeners = new Set<() => void>();

export function setLang(lang: string) {
	if (LANGS[lang]) {
		currentLang = lang;
		listeners.forEach((fn) => {
			fn();
		});
	}
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
