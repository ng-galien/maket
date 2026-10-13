/**
 * Shared tool-output helpers.
 *
 * `text()` is the single wrapper around the MCP content envelope and `json()`
 * its variant for tools that return a JSON value. A `text()` body that parses
 * as a JSON array or scalar also gets `structuredContent: { text: body }`.
 * All packs import from here so error conventions, the optional `next:`
 * follow-up hint block and the object shape of `structuredContent` stay
 * uniform across the tool surface.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import { templateControlledPageMessage } from "../services/structured-workspace-policy.js";
import type { Document, Page } from "../types.js";

export interface TextOpts {
	/** Tag the result as an error (MCP `isError: true`). */
	isError?: boolean;
	/**
	 * Optional list of follow-up tool calls to suggest to the agent. Rendered
	 * as an esac-style `next:` block appended to the body, one per line.
	 */
	next?: string[];
}

/**
 * Wrap a string in the standard MCP text-content envelope.
 *
 * Two call shapes for convenience:
 *   text("ok")                        // success
 *   text("boom", true)                // error (legacy boolean shorthand)
 *   text("ok", { next: ["maket_charte view"] })
 *   text("boom", { isError: true })
 */
export function text(t: string, opts?: boolean | TextOpts): CallToolResult {
	const isError = typeof opts === "boolean" ? opts : opts?.isError;
	const next =
		typeof opts === "object" && opts !== null ? opts.next : undefined;
	const body = next?.length
		? `${t}\n\nnext:\n${next.map((n) => `  - ${n}`).join("\n")}`
		: t;
	const wrap = nonObjectJson(body);
	const base: CallToolResult = {
		content: [{ type: "text", text: body }],
		...(wrap ? { structuredContent: { text: body } } : {}),
	};
	return isError ? { ...base, isError: true } : base;
}

const JSON_NON_OBJECT_START = /^\s*(?:[[\d"-]|true|false|null)/;

/** True when `body` parses as JSON to an array or a scalar. */
function nonObjectJson(body: string): boolean {
	if (!JSON_NON_OBJECT_START.test(body)) return false;
	try {
		const parsed: unknown = JSON.parse(body);
		return (
			typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
		);
	} catch {
		return false;
	}
}

export interface JsonOpts {
	/** Key that wraps a non-object value in `structuredContent`. */
	key?: string;
	/** Indentation of the text block; compact when omitted. */
	indent?: number;
	/** Text block to send instead of the serialized value. */
	text?: string;
	/** Tag the result as an error (MCP `isError: true`). */
	isError?: boolean;
}

/**
 * Wrap a JSON value in the MCP envelope: the text block carries the value
 * serialized, `structuredContent` carries the same value as an object. An
 * array or a scalar is wrapped under `key`, so `structuredContent` is always
 * an object as `CallToolResult` requires.
 *
 *   json(doc)                                  // { ...doc }
 *   json(list, { key: "messages", indent: 2 }) // { messages: [...] }
 */
export function json(value: unknown, opts: JsonOpts = {}): CallToolResult {
	const serialized = JSON.stringify(value);
	const plain: unknown =
		serialized === undefined ? null : JSON.parse(serialized);
	const structuredContent =
		typeof plain === "object" && plain !== null && !Array.isArray(plain)
			? (plain as Record<string, unknown>)
			: { [opts.key ?? "value"]: plain };
	const body =
		opts.text ??
		(opts.indent ? JSON.stringify(value, null, opts.indent) : serialized);
	const base: CallToolResult = {
		content: [{ type: "text", text: body ?? "null" }],
		structuredContent,
	};
	return opts.isError ? { ...base, isError: true } : base;
}

/**
 * If the document is locked, return an MCP error result explaining how to
 * unlock it; otherwise return null. Mutation tools call this right after
 * resolving the doc and short-circuit on a non-null return value.
 */
export function lockGuard(d: Document): CallToolResult | null {
	if (d.meta?.locked !== true) return null;
	return text(
		`🔒 Document "${d.name}" is locked — edits are refused. Ask the user to unlock it, or call: maket_workspace action=lock doc=${d.name} locked=false`,
		true,
	);
}

export function templatePageGuard(
	document: Document,
	page: Page,
): CallToolResult | null {
	const message = templateControlledPageMessage(document, page);
	return message ? text(message, true) : null;
}
