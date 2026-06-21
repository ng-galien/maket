export type CharteRules = Record<string, string>;
export type CharteRulesWire = CharteRules | string | null | undefined;

export function parseCharteRules(rules: CharteRulesWire): CharteRules {
	if (!rules) return {};
	if (typeof rules === "string") {
		try {
			return normalizeCharteRules(JSON.parse(rules));
		} catch {
			return {};
		}
	}
	return normalizeCharteRules(rules);
}

function normalizeCharteRules(rules: unknown): CharteRules {
	if (!isPlainRecord(rules)) return {};
	return Object.fromEntries(
		Object.entries(rules).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object") return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
