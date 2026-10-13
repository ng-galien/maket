import type { ItemSourceError, ItemSourceErrorCode } from "./item-source.js";

export function itemSourceError(
	code: ItemSourceErrorCode,
	message: string,
	details: Pick<ItemSourceError, "retryAfter" | "currentRevision"> = {},
): ItemSourceError {
	return Object.assign(new Error(message), { code, ...details });
}

export function isItemSourceError(error: unknown): error is ItemSourceError {
	return (
		error instanceof Error &&
		typeof (error as Partial<ItemSourceError>).code === "string"
	);
}
