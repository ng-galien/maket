import type { Charte } from "../types.js";

export const MERMAID_COLOR_ROLES = [
	"bg",
	"fg",
	"line",
	"accent",
	"muted",
	"surface",
	"border",
] as const;

export const MERMAID_DENSITY_ROLES = [
	"padding",
	"nodeSpacing",
	"layerSpacing",
] as const;

export const MERMAID_TOKEN_ROLES = [
	...MERMAID_COLOR_ROLES,
	"font",
	...MERMAID_DENSITY_ROLES,
	"transparent",
] as const;

export type MermaidColorRole = (typeof MERMAID_COLOR_ROLES)[number];
export type MermaidDensityRole = (typeof MERMAID_DENSITY_ROLES)[number];
export type MermaidTokenRole = (typeof MERMAID_TOKEN_ROLES)[number];
export type MermaidTokenRefs = Partial<Record<MermaidTokenRole, string>>;

export interface MermaidRenderingInput {
	theme?: string;
	tokenRefs?: MermaidTokenRefs;
	bg?: string;
	fg?: string;
	line?: string;
	accent?: string;
	muted?: string;
	surface?: string;
	border?: string;
	font?: string;
	padding?: number;
	nodeSpacing?: number;
	layerSpacing?: number;
	transparent?: boolean;
}

export type MermaidRenderOptions = Record<string, string | number | boolean>;

const TOKEN_REF = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SAFE_COLOR_FUNCTION =
	/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\([0-9.%+\-,/\sdegturnrad]+\)$/i;
const SAFE_COLOR_KEYWORD = /^[A-Za-z]+$/;
const SAFE_FONT_FAMILY = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;
const PIXEL_VALUE = /^(\d+(?:\.\d+)?)(?:px)?$/;

const AUTOMATIC_TOKEN_REFS: Record<MermaidTokenRole, readonly string[]> = {
	bg: ["diagram.bg", "color.background", "color.bg"],
	fg: ["diagram.fg", "color.text", "color.foreground"],
	line: ["diagram.line", "color.line"],
	accent: ["diagram.accent", "color.accent", "color.primary"],
	muted: ["diagram.muted", "color.muted"],
	surface: ["diagram.surface", "color.surface"],
	border: ["diagram.border", "color.border"],
	font: ["diagram.font", "font.body"],
	padding: ["diagram.padding"],
	nodeSpacing: ["diagram.nodeSpacing"],
	layerSpacing: ["diagram.layerSpacing"],
	transparent: ["diagram.transparent"],
};

export class MermaidRenderingError extends Error {}

/**
 * Resolve the renderer contract in one deterministic order:
 * neutral renderer defaults → document charte → built-in diagram profile →
 * explicit token references → explicit literal overrides.
 */
export function buildMermaidRenderOptions(
	input: MermaidRenderingInput,
	themes: Record<string, Record<string, string>>,
	charte: Charte | null,
): MermaidRenderOptions | undefined {
	const options: MermaidRenderOptions = {};

	if (charte) applyAutomaticCharte(options, charte);

	if (input.theme) {
		const theme = themes[input.theme];
		if (theme) Object.assign(options, theme);
	}

	if (input.tokenRefs) {
		if (!charte) {
			throw new MermaidRenderingError(
				"Diagram token references require a charte attached to the document.",
			);
		}
		for (const role of MERMAID_TOKEN_ROLES) {
			const ref = input.tokenRefs[role];
			if (ref) options[role] = resolveTokenValue(charte, ref, role);
		}
	}

	for (const role of MERMAID_COLOR_ROLES) {
		const value = input[role];
		if (value !== undefined) options[role] = validateColor(value, role);
	}
	if (input.font !== undefined) options.font = validateFont(input.font, "font");
	for (const role of MERMAID_DENSITY_ROLES) {
		const value = input[role];
		if (value !== undefined) options[role] = validateDensity(value, role);
	}
	if (input.transparent !== undefined) options.transparent = input.transparent;

	return Object.keys(options).length > 0 ? options : undefined;
}

function applyAutomaticCharte(
	options: MermaidRenderOptions,
	charte: Charte,
): void {
	for (const role of MERMAID_TOKEN_ROLES) {
		for (const ref of AUTOMATIC_TOKEN_REFS[role]) {
			if (!hasToken(charte, ref)) continue;
			try {
				options[role] = resolveTokenValue(charte, ref, role);
				break;
			} catch (error) {
				if (!(error instanceof MermaidRenderingError)) throw error;
			}
		}
	}
}

function hasToken(charte: Charte, ref: string): boolean {
	const match = ref.match(TOKEN_REF);
	if (!match) return false;
	const [, group = "", key = ""] = match;
	return charte.tokens[group]?.[key] !== undefined;
}

function resolveTokenValue(
	charte: Charte,
	ref: string,
	role: MermaidTokenRole,
): string | number | boolean {
	const match = ref.match(TOKEN_REF);
	if (!match) {
		throw new MermaidRenderingError(
			`Invalid charte token reference "${ref}". Expected "group.key".`,
		);
	}
	const [, group = "", key = ""] = match;
	const value = charte.tokens[group]?.[key];
	if (value === undefined) {
		throw new MermaidRenderingError(
			`Charte token "${ref}" does not exist in "${charte.name}".`,
		);
	}

	if (isColorRole(role)) {
		return validateColor(value, ref);
	}
	if (role === "font") return validateFont(value, ref);
	if (role === "transparent") return validateBoolean(value, ref);
	return validateDensity(value, ref);
}

function isColorRole(role: MermaidTokenRole): role is MermaidColorRole {
	return (MERMAID_COLOR_ROLES as readonly string[]).includes(role);
}

function validateColor(value: string, label: string): string {
	const trimmed = value.trim();
	if (
		HEX_COLOR.test(trimmed) ||
		SAFE_COLOR_FUNCTION.test(trimmed) ||
		SAFE_COLOR_KEYWORD.test(trimmed) ||
		trimmed === "transparent"
	) {
		return trimmed;
	}
	throw new MermaidRenderingError(
		`Diagram colour "${label}" must be a safe colour value or charte token.`,
	);
}

// String normalization belongs to the diagram-token validation boundary even though it is method-call heavy.
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
function validateFont(value: string, label: string): string {
	const [first = ""] = value.split(",");
	const trimmed = first.trim();
	const unquoted =
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
			? trimmed.slice(1, -1).trim()
			: trimmed;
	if (unquoted.length <= 200 && SAFE_FONT_FAMILY.test(unquoted))
		return unquoted;
	throw new MermaidRenderingError(
		`Diagram font "${label}" contains unsupported CSS syntax.`,
	);
}

export function validateMermaidSourcePolicy(source: string): void {
	for (const segment of source.split(/[\n;]/)) {
		const statement = segment.trim();
		if (
			/^(?:classDef|class\s+\S+\s+\S+|style\s+|linkStyle\s+|%%\{init:)/i.test(
				statement,
			)
		) {
			throw new MermaidRenderingError(
				"Mermaid styling directives are not supported. Use charte tokens, tokenRefs, or safe diagram options instead.",
			);
		}
	}
}

export function validateMermaidDensitySupport(
	source: string,
	input: MermaidRenderingInput,
): void {
	const hasDensity = MERMAID_DENSITY_ROLES.some(
		(role) =>
			input[role] !== undefined || input.tokenRefs?.[role] !== undefined,
	);
	if (!hasDensity) return;
	if (!supportsMermaidDensity(source)) {
		throw new MermaidRenderingError(
			"Diagram density controls are supported only for flowchart and state diagrams by the current renderer.",
		);
	}
}

export function supportsMermaidDensity(source: string): boolean {
	const header = source.trimStart().split(/[\n;]/, 1)[0]?.trim() ?? "";
	return /^(?:graph|flowchart|stateDiagram(?:-v2)?)\b/i.test(header);
}

function validateDensity(value: string | number, label: string): number {
	const raw = typeof value === "number" ? String(value) : value.trim();
	const match = raw.match(PIXEL_VALUE);
	const parsed = match ? Number(match[1]) : Number.NaN;
	if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1000) return parsed;
	throw new MermaidRenderingError(
		`Diagram spacing "${label}" must be between 0 and 1000px.`,
	);
}

function validateBoolean(value: string, label: string): boolean {
	if (value === "true") return true;
	if (value === "false") return false;
	throw new MermaidRenderingError(
		`Diagram boolean "${label}" must be "true" or "false".`,
	);
}

/**
 * beautiful-mermaid 1.1.3 greedily reads the dashes in a compact valid edge
 * such as `A-->B` as part of the bare source id (`A--`). Add only the missing
 * separator before supported operators; labelled/bracketed nodes are kept.
 */
export function normalizeMermaidSource(source: string): string {
	const header = source.trimStart().split(/[\n;]/, 1)[0]?.trim() ?? "";
	if (!/^(?:graph|flowchart)\b/i.test(header)) return source;

	const operators = [
		"<-.->",
		"<-->",
		"<==>",
		"-.->",
		"-->",
		"---",
		"-.-",
		"==>",
		"===",
	];
	const closingFor: Record<string, string> = { "[": "]", "(": ")", "{": "}" };
	const brackets: string[] = [];
	let quote: '"' | "'" | null = null;
	let comment = false;
	let result = "";

	for (let index = 0; index < source.length; index++) {
		const char = source[index] ?? "";
		const next = source[index + 1] ?? "";
		if (comment) {
			result += char;
			if (char === "\n") comment = false;
			continue;
		}
		if (!quote && brackets.length === 0 && char === "%" && next === "%") {
			comment = true;
			result += char;
			continue;
		}
		if (quote) {
			result += char;
			if (char === quote && source[index - 1] !== "\\") quote = null;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			result += char;
			continue;
		}
		if (closingFor[char]) {
			brackets.push(closingFor[char]);
			result += char;
			continue;
		}
		if (brackets.at(-1) === char) {
			brackets.pop();
			result += char;
			continue;
		}

		if (brackets.length === 0) {
			const operator = operators.find((candidate) =>
				source.startsWith(candidate, index),
			);
			const previous = result.at(-1) ?? "";
			if (operator && /[\w)\]}]/.test(previous)) result += " ";
		}
		result += char;
	}

	return result;
}
