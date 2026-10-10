/**
 * Document-state values inside presentation attributes. A template may place
 * an escaped `{{ … }}` value in a whitelisted SVG presentation attribute or in
 * a whitelisted `style` property. The rendered attribute must match a strict
 * numeric grammar; anything else fails the render.
 */

export const stateSvgPresentationAttributes = [
	"x",
	"y",
	"width",
	"height",
	"r",
	"rx",
	"ry",
	"cx",
	"cy",
	"x1",
	"y1",
	"x2",
	"y2",
	"points",
	"viewBox",
	"d",
	"transform",
	"opacity",
	"fill-opacity",
	"stroke-width",
	"stroke-dasharray",
	"stroke-dashoffset",
] as const;

export const stateStylePresentationProperties = [
	"width",
	"height",
	"left",
	"top",
	"transform",
	"opacity",
] as const;

export const stateSvgElements = [
	"svg",
	"g",
	"rect",
	"circle",
	"ellipse",
	"line",
	"polyline",
	"polygon",
	"path",
	"text",
	"tspan",
	"use",
	"image",
	"symbol",
	"marker",
	"pattern",
	"mask",
	"clipPath",
	"linearGradient",
	"radialGradient",
	"stop",
	"foreignObject",
] as const;

type Grammar =
	| "length"
	| "opacity"
	| "dasharray"
	| "points"
	| "viewBox"
	| "path"
	| "transform";

const svgAttributeGrammars = new Map<string, Grammar>([
	["x", "length"],
	["y", "length"],
	["width", "length"],
	["height", "length"],
	["r", "length"],
	["rx", "length"],
	["ry", "length"],
	["cx", "length"],
	["cy", "length"],
	["x1", "length"],
	["y1", "length"],
	["x2", "length"],
	["y2", "length"],
	["points", "points"],
	["viewbox", "viewBox"],
	["d", "path"],
	["transform", "transform"],
	["opacity", "opacity"],
	["fill-opacity", "opacity"],
	["stroke-width", "length"],
	["stroke-dasharray", "dasharray"],
	["stroke-dashoffset", "length"],
]);

const stylePropertyGrammars = new Map<string, Grammar>([
	["width", "length"],
	["height", "length"],
	["left", "length"],
	["top", "length"],
	["transform", "transform"],
	["opacity", "opacity"],
]);

const grammarDescriptions: Record<Grammar, string> = {
	length: "a number or a length (number with px, %, em, rem, mm, cm, in, pt…)",
	opacity: "a number or a percentage",
	dasharray: "none or a list of lengths",
	points: "an even list of numbers",
	viewBox: "four numbers",
	path: "path data made of numbers and M L H V C S Q T A Z commands, starting with M",
	transform:
		"transform functions (translate, translateX, translateY, scale, scaleX, scaleY, rotate, skewX, skewY, matrix) with numeric arguments",
};

const svgElementSet = new Set(
	stateSvgElements.map((name) => name.toLowerCase()),
);
const valueStart = "";
const valueEnd = "";
const number = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const lengthUnits = "px|%|em|rem|ex|ch|vw|vh|vmin|vmax|mm|cm|in|pt|pc|q";
const angleUnits = "deg|rad|grad|turn";
const numberPattern = new RegExp(`^${number}$`);
const lengthPattern = new RegExp(`^${number}(?:${lengthUnits})?$`, "i");
const opacityPattern = new RegExp(`^${number}%?$`);
const transformArgumentPattern = new RegExp(
	`^${number}(?:${lengthUnits}|${angleUnits})?$`,
	"i",
);
const pathTokenPattern = new RegExp(
	String.raw`[\s,]+|[MmLlHhVvCcSsQqTtAaZz]|${number}`,
	"y",
);
const transformFunctionPattern = /\s*([A-Za-z]+)\s*\(([^()]*)\)\s*,?\s*/y;
const transformFunctions = new Set([
	"translate",
	"translatex",
	"translatey",
	"scale",
	"scalex",
	"scaley",
	"rotate",
	"skewx",
	"skewy",
	"matrix",
]);
const activeConstructPattern =
	/url\s*\(|expression\s*\(|image-set\s*\(|javascript:|vbscript:|data:|@import|\\|[<>]/i;
const reservedOnTemplatedTag = [
	"data-maket-bind",
	"data-maket-path",
	"data-maket-type",
	"data-maket-pending",
	"data-maket-error",
	"data-maket-state-bind",
	"data-maket-state-type",
	"data-maket-state-value",
	"data-maket-state-pending",
];

/**
 * Validate a template value placed inside an HTML tag. Only escaped values in
 * a quoted whitelisted attribute (SVG presentation attribute, or a whitelisted
 * `style` property) are accepted, and the static part of that attribute must
 * not contain an active construct.
 */
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Template placement check: reads the tag around a position with the HTML scanning helpers it shares with document-state rendering.
export function assertStateAttributePlacement(
	template: string,
	position: number,
): void {
	const tagStart = template.lastIndexOf("<", position);
	const tagEnd = findTagEnd(template, tagStart);
	const tag = template.slice(tagStart, tagEnd < 0 ? undefined : tagEnd + 1);
	const tagName = /^<\s*([A-Za-z][\w:-]*)/.exec(tag)?.[1];
	if (!tagName || tagEnd < 0) {
		throw new Error(
			"Document state values inside a tag must sit in a quoted presentation attribute of a complete opening tag.",
		);
	}
	const site = attributeAt(tag, position - tagStart);
	if (!site) {
		throw new Error(
			`Document state value in <${tagName}> must sit inside a quoted presentation attribute value.`,
		);
	}
	const attribute = site.name.toLowerCase();
	const label = `<${tagName} ${site.name}>`;
	if (attribute === "style") {
		assertStyleSite(tagName, site.value, position - tagStart - site.start);
	} else if (
		!svgElementSet.has(tagName.toLowerCase()) ||
		!svgAttributeGrammars.has(attribute)
	) {
		throw new Error(
			`Document state value cannot be placed in ${label}. State values are accepted in SVG presentation attributes (${stateSvgPresentationAttributes.join(", ")}) and in the style properties ${stateStylePresentationProperties.join(", ")}.`,
		);
	}
	const staticValue = site.value.replace(/\{\{[^}]*\}\}/g, "0");
	if (activeConstructPattern.test(staticValue)) {
		throw new Error(
			`Document state attribute ${label} contains an active construct (url(), expression(), a script or data URL, an escape or markup).`,
		);
	}
	for (const reserved of reservedOnTemplatedTag) {
		if (attributeAt(tag, -1, reserved)) {
			throw new Error(
				`<${tagName}> cannot combine ${reserved} with state attribute values.`,
			);
		}
	}
}

/** Mark a rendered value placed inside an attribute for render-time checks. */
export function markStateAttributeValue(escaped: string): string {
	const neutral = escaped.replaceAll(valueStart, "�").replaceAll(valueEnd, "�");
	return `${valueStart}${neutral}${valueEnd}`;
}

/**
 * Validate every attribute that received a state value against its grammar
 * and remove the render markers. Throws an error naming the element and
 * attribute when a rendered value does not match.
 */
export function finalizeStateAttributeValues(html: string): string {
	if (!html.includes(valueStart)) return html;
	let output = "";
	let cursor = 0;
	while (cursor < html.length) {
		const marker = html.indexOf(valueStart, cursor);
		if (marker < 0) return output + html.slice(cursor);
		const tagStart = html.lastIndexOf("<", marker);
		const tagEnd = findTagEnd(html, tagStart);
		if (tagStart < cursor || tagEnd < 0) {
			throw new Error(
				"A document state attribute value was rendered outside a complete tag.",
			);
		}
		output += html.slice(cursor, tagStart);
		output += finalizeTag(html.slice(tagStart, tagEnd + 1));
		cursor = tagEnd + 1;
	}
	return output;
}

function finalizeTag(tag: string): string {
	const tagName = /^<\s*([A-Za-z][\w:-]*)/.exec(tag)?.[1] ?? "?";
	for (const site of attributes(tag)) {
		if (!site.value.includes(valueStart)) continue;
		const attribute = site.name.toLowerCase();
		if (attribute === "style") {
			assertRenderedStyle(tagName, site.value);
			continue;
		}
		const grammar = svgAttributeGrammars.get(attribute);
		const value = stripMarkers(site.value);
		if (!grammar || !matchesGrammar(grammar, value)) {
			throw renderedValueError(
				`<${tagName} ${site.name}>`,
				grammar ?? "length",
				value,
			);
		}
	}
	return stripMarkers(tag);
}

function assertRenderedStyle(tagName: string, style: string): void {
	for (const declaration of styleDeclarations(style)) {
		if (!declaration.includes(valueStart)) continue;
		const separator = declaration.indexOf(":");
		const property = declaration.slice(0, separator).trim().toLowerCase();
		const grammar = stylePropertyGrammars.get(property);
		const value = stripMarkers(declaration.slice(separator + 1));
		if (separator < 0 || !grammar || !matchesGrammar(grammar, value)) {
			throw renderedValueError(
				`<${tagName} style ${property || "?"}>`,
				grammar ?? "length",
				value,
			);
		}
	}
}

function assertStyleSite(tagName: string, style: string, offset: number): void {
	let start = 0;
	for (const declaration of style.split(";")) {
		const end = start + declaration.length;
		if (offset >= start && offset < end) {
			const separator = declaration.indexOf(":");
			const property = declaration.slice(0, separator).trim().toLowerCase();
			if (
				separator < 0 ||
				offset - start <= separator ||
				!stylePropertyGrammars.has(property)
			) {
				throw new Error(
					`Document state value cannot set <${tagName} style ${property || "?"}>. State values are accepted only as the value of the style properties ${stateStylePresentationProperties.join(", ")}.`,
				);
			}
			return;
		}
		start = end + 1;
	}
}

function styleDeclarations(style: string): string[] {
	const declarations: string[] = [];
	let current = "";
	let inValue = false;
	for (const character of style) {
		if (character === valueStart) inValue = true;
		if (character === valueEnd) inValue = false;
		if (character === ";" && !inValue) {
			declarations.push(current);
			current = "";
			continue;
		}
		current += character;
	}
	declarations.push(current);
	return declarations;
}

function matchesGrammar(grammar: Grammar, raw: string): boolean {
	const value = raw.trim();
	switch (grammar) {
		case "length":
			return lengthPattern.test(value);
		case "opacity":
			return opacityPattern.test(value);
		case "dasharray":
			return value === "none" || listOf(value).every(isLength);
		case "points": {
			const values = listOf(value);
			return values.length >= 2 && values.length % 2 === 0
				? values.every(isNumber)
				: false;
		}
		case "viewBox": {
			const values = listOf(value);
			return values.length === 4 && values.every(isNumber);
		}
		case "path":
			return isPathData(value);
		case "transform":
			return isTransformList(value);
	}
}

function listOf(value: string): string[] {
	return value ? value.split(/[\s,]+/) : [];
}

function isNumber(value: string): boolean {
	return numberPattern.test(value);
}

function isLength(value: string): boolean {
	return lengthPattern.test(value);
}

function isPathData(value: string): boolean {
	let cursor = 0;
	let first = true;
	while (cursor < value.length) {
		pathTokenPattern.lastIndex = cursor;
		const match = pathTokenPattern.exec(value);
		if (!match) return false;
		const token = match[0];
		cursor += token.length;
		if (/^[\s,]+$/.test(token)) continue;
		if (first && token !== "M" && token !== "m") return false;
		first = false;
	}
	return !first;
}

function isTransformList(value: string): boolean {
	if (value === "none") return true;
	let cursor = 0;
	let count = 0;
	while (cursor < value.length) {
		transformFunctionPattern.lastIndex = cursor;
		const match = transformFunctionPattern.exec(value);
		if (!match) return false;
		const name = (match[1] ?? "").toLowerCase();
		const args = listOf((match[2] ?? "").trim());
		if (!transformFunctions.has(name)) return false;
		if (args.length < 1 || args.length > 6) return false;
		if (!args.every((arg) => transformArgumentPattern.test(arg))) return false;
		cursor += match[0].length;
		count += 1;
	}
	return count > 0;
}

function renderedValueError(
	label: string,
	grammar: Grammar,
	value: string,
): Error {
	return new Error(
		`Document state value in ${label} must render ${grammarDescriptions[grammar]}; got "${value.trim()}".`,
	);
}

function stripMarkers(value: string): string {
	return value.replaceAll(valueStart, "").replaceAll(valueEnd, "");
}

interface AttributeSite {
	name: string;
	value: string;
	/** Offset of the value inside the tag. */
	start: number;
	quoted: boolean;
}

function attributes(tag: string): AttributeSite[] {
	const nameEnd = /^<\s*[A-Za-z][\w:-]*/.exec(tag)?.[0].length ?? 1;
	const pattern =
		/\s([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
	pattern.lastIndex = nameEnd;
	const sites: AttributeSite[] = [];
	for (
		let match = pattern.exec(tag);
		match !== null;
		match = pattern.exec(tag)
	) {
		const quotedValue = match[2] ?? match[3];
		const value = quotedValue ?? match[4] ?? "";
		const end = match.index + match[0].length;
		sites.push({
			name: match[1] ?? "",
			value,
			start:
				quotedValue !== undefined ? end - 1 - value.length : end - value.length,
			quoted: quotedValue !== undefined,
		});
	}
	return sites;
}

function attributeAt(
	tag: string,
	offset: number,
	name?: string,
): AttributeSite | null {
	for (const site of attributes(tag)) {
		if (name !== undefined) {
			if (site.name.toLowerCase() === name) return site;
			continue;
		}
		if (
			site.quoted &&
			offset >= site.start &&
			offset < site.start + site.value.length
		) {
			return site;
		}
	}
	return null;
}

function findTagEnd(html: string, start: number): number {
	if (start < 0) return -1;
	let quote: '"' | "'" | null = null;
	for (let index = start + 1; index < html.length; index += 1) {
		const character = html[index];
		if (quote) {
			if (character === quote) quote = null;
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === ">") return index;
	}
	return -1;
}
