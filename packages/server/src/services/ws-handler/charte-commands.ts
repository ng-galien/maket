/**
 * Charte workspace command handlers.
 */

import type { WorkspaceCommand } from "@maket/shared";
import { composeCharteCss } from "../../lib/charte-css.js";
import type { Charte } from "../../types.js";
import type { WsHandlerContext } from "./context.js";
import { isPlainObject, isStringArray } from "./context.js";

export function handleCharteSave(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "charte_save" }>,
): void {
	const name = String(msg.name || "").trim();
	if (!name) {
		ctx.bus.emit("toast", { text: "Charte name is required", level: "error" });
		return;
	}
	const invalid = validateCharteSavePayload(msg);
	if (invalid) {
		ctx.bus.emit("toast", {
			text: `Charte "${name}" rejected: ${invalid}`,
			level: "error",
		});
		return;
	}
	const charte: Charte = {
		name,
		description: msg.description,
		tokens: (msg.tokens ?? {}) as Charte["tokens"],
	};
	if (msg.voice) charte.voice = msg.voice;
	if (msg.rules) charte.rules = msg.rules;
	ctx.store.saveCharte(charte);
	ctx.bus.emit("charte:updated", { name, css: composeCharteCss(charte) });
	ctx.bus.emit("toast", {
		text: `Charte "${name}" saved`,
		level: "success",
	});
}

export function handleUpdateCharteMeta(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "update_charte_meta" }>,
): void {
	const name = String(msg.name || "").trim();
	if (!name) {
		ctx.bus.emit("toast", { text: "Charte name is required", level: "error" });
		return;
	}
	const existing = ctx.store.loadCharte(name);
	if (!existing) {
		ctx.bus.emit("toast", {
			text: `Charte "${name}" not found`,
			level: "error",
		});
		return;
	}
	const invalid = validateCharteSavePayload(msg);
	if (invalid) {
		ctx.bus.emit("toast", {
			text: `Charte "${name}" rejected: ${invalid}`,
			level: "error",
		});
		return;
	}
	const merged: Charte = { ...existing };
	if (msg.description !== undefined) merged.description = msg.description;
	if (msg.tokens !== undefined) merged.tokens = msg.tokens as Charte["tokens"];
	if (msg.voice !== undefined) merged.voice = msg.voice;
	if (msg.rules !== undefined) merged.rules = msg.rules;
	ctx.store.saveCharte(merged);
	ctx.bus.emit("charte:updated", { name, css: composeCharteCss(merged) });
}

function validateCharteSavePayload(msg: {
	tokens?: unknown;
	voice?: unknown;
	rules?: unknown;
}): string | null {
	if (msg.tokens !== undefined) {
		if (!isPlainObject(msg.tokens)) return "tokens must be an object";
		for (const [group, bucket] of Object.entries(msg.tokens)) {
			if (!isPlainObject(bucket)) return `tokens.${group} must be an object`;
			for (const [k, v] of Object.entries(bucket)) {
				if (typeof v !== "string")
					return `tokens.${group}.${k} must be a string`;
			}
		}
	}
	if (msg.voice !== undefined) {
		if (!isPlainObject(msg.voice)) return "voice must be an object";
		const v = msg.voice;
		for (const key of ["personality", "do", "dont", "vocabulary"] as const) {
			if (v[key] !== undefined && !isStringArray(v[key]))
				return `voice.${key} must be a string[]`;
		}
		if (v.formality !== undefined && typeof v.formality !== "string")
			return "voice.formality must be a string";
	}
	if (msg.rules !== undefined) {
		if (!isPlainObject(msg.rules)) return "rules must be an object";
		for (const [k, val] of Object.entries(msg.rules)) {
			if (typeof val !== "string") return `rules.${k} must be a string`;
		}
	}
	return null;
}

/** Runtime shape check for `update_asset_meta` payloads. Returns an error
 * message when the payload would persist malformed data, `null` when it's
 * safe. Same contract as validateCharteSavePayload. */
