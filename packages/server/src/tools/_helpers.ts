/**
 * Shared tool-output helpers.
 *
 * `text()` is the single wrapper around the MCP content envelope. All packs
 * import from here so error conventions and the optional `next:` follow-up
 * hint block stay uniform across the tool surface.
 */

import type { ToolResult } from "../core/container.js";
import type { Document } from "../types.js";

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
export function text(t: string, opts?: boolean | TextOpts): ToolResult {
	const isError = typeof opts === "boolean" ? opts : opts?.isError;
	const next =
		typeof opts === "object" && opts !== null ? opts.next : undefined;
	const body = next?.length
		? `${t}\n\nnext:\n${next.map((n) => `  - ${n}`).join("\n")}`
		: t;
	const base: ToolResult = { content: [{ type: "text", text: body }] };
	return isError ? { ...base, isError: true } : base;
}

/**
 * If the document is locked, return an MCP error result explaining how to
 * unlock it; otherwise return null. Mutation tools call this right after
 * resolving the doc and short-circuit on a non-null return value.
 */
export function lockGuard(d: Document): ToolResult | null {
	if (d.meta?.locked !== true) return null;
	return text(
		`🔒 Document "${d.name}" is locked — edits are refused. Ask the user to unlock it, or call: maket_workspace action=lock doc=${d.name} locked=false`,
		true,
	);
}
