import {
	type DocumentStateData,
	type DocumentStateSchema,
	documentStateFormatValues,
	mermaidStateFormat,
	readJsonPointer,
	stripActiveIn,
} from "@maket/shared";
import { parseHTML } from "linkedom";
import type { Charte } from "../types.js";
import {
	createMermaidDiagramSpec,
	renderMermaidDiagram,
} from "./mermaid-document.js";
import { MessageError } from "./message-error.js";

/** The SVG of a Mermaid source held by the state, drawn with the charte,
 * stripped of active content like any rendered output, and written back with
 * every attribute value and text node escaped, so no label can close the
 * element that holds the slot. */
export function renderStateMermaid(
	source: string,
	charte: Charte | null,
): string {
	const svg = renderMermaidDiagram(
		createMermaidDiagramSpec(source, {}),
		charte,
	);
	const { document } = parseHTML(`<html><body>${svg}</body></html>`);
	stripActiveIn(document.body);
	return [...document.body.childNodes].map(escapedMarkup).join("");
}

interface MarkupNode {
	nodeType: number;
	nodeName: string;
	textContent: string | null;
	childNodes: ArrayLike<MarkupNode>;
	attributes?: ArrayLike<{ name: string; value: string }>;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function escapedMarkup(node: MarkupNode): string {
	if (node.nodeType === TEXT_NODE) return escapeMarkup(node.textContent ?? "");
	if (node.nodeType !== ELEMENT_NODE) return "";
	const name = node.nodeName.toLowerCase();
	const attributes = Array.from(node.attributes ?? [])
		.map(
			({ name: attribute, value }) => ` ${attribute}="${escapeMarkup(value)}"`,
		)
		.join("");
	const children =
		name === "style"
			? (node.textContent ?? "").replaceAll("<", "\\3c ")
			: Array.from(node.childNodes).map(escapedMarkup).join("");
	return `<${name}${attributes}>${children}</${name}>`;
}

function escapeMarkup(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

/** Why a Mermaid source cannot be drawn, or null when it can. */
export function stateMermaidError(source: string): string | null {
	try {
		renderStateMermaid(source, null);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

/**
 * One sentence per non-empty `maket-mermaid` value of `data` that fails the
 * source policy or a trial render, naming its path and the Mermaid error.
 * A value equal to the one `previous` holds at the same path is not drawn
 * again.
 */
export function stateMermaidIssues(
	schema: DocumentStateSchema,
	data: DocumentStateData,
	previous?: DocumentStateData,
): string[] {
	return documentStateFormatValues(schema, data, mermaidStateFormat).flatMap(
		({ pointer, value }) => {
			if (!value.trim() || unchanged(previous, pointer, value)) return [];
			const error = stateMermaidError(value);
			return error
				? [
						`State value ${pointer} (format ${mermaidStateFormat}) is not a Mermaid diagram Maket can draw: ${error.replace(/\.?$/, ".")} Fix: write a Mermaid source that starts with a diagram header such as "flowchart TD", without classDef, class, style, linkStyle or %%{init} directives, or leave the value empty.`,
					]
				: [];
		},
	);
}

/** Refuse a state whose Mermaid sources cannot be drawn; nothing is
 * written by the caller when this throws. */
export function assertStateMermaidSources(
	schema: DocumentStateSchema,
	data: DocumentStateData,
	previous?: DocumentStateData,
): void {
	const issues = stateMermaidIssues(schema, data, previous);
	if (issues.length > 0) {
		throw new MessageError(issues.join("\n"), "msg_state_invalid");
	}
}

function unchanged(
	previous: DocumentStateData | undefined,
	pointer: string,
	value: string,
): boolean {
	if (!previous) return false;
	try {
		return readJsonPointer(previous, pointer) === value;
	} catch {
		return false;
	}
}
