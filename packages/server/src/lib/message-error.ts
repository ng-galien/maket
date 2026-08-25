/**
 * An error that carries the identifier the browser translates, while its
 * `message` stays the English sentence the AI agent reads in MCP tool output.
 */

import type { LocalizedMessage, MessageKey } from "@maket/shared";

export class MessageError extends Error {
	readonly localized: LocalizedMessage;

	constructor(
		sentence: string,
		key: MessageKey,
		params?: Record<string, string | number>,
	) {
		super(sentence);
		this.name = "MessageError";
		this.localized = params ? { key, params } : { key };
	}
}

/** The identifier to translate, or nothing when the failure has no key yet. */
export function localizedOf(error: unknown): LocalizedMessage | undefined {
	return error instanceof MessageError ? error.localized : undefined;
}
