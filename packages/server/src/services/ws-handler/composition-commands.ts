/**
 * Hand composition handlers: document creation, page addition, canvas
 * format, and placed elements. Each handler checks the message shape and
 * delegates to the page composition service; a refusal becomes a toast and
 * a state broadcast that restores the browser's view.
 */

import {
	BLANK_PAGE_HTML,
	computeCanvasDims,
	FORMATS,
	ORIENTATIONS,
	PLACED_ELEMENT_KINDS,
	type PlacedBox,
	placedCompositionFormat,
	type WorkspaceCommand,
} from "@maket/shared";
import type { CompositionRefusal } from "../page-composition.js";
import type { WsHandlerContext } from "./context.js";
import { log } from "./context.js";

const BLANK_DOCUMENT_FORMAT = "A4";
const BLANK_DOCUMENT_ORIENTATION = "portrait";

function isPlacedBox(value: unknown): value is PlacedBox {
	if (typeof value !== "object" || value === null) return false;
	const box = value as Record<string, unknown>;
	return ["left", "top", "width", "height"].every(
		(key) => typeof box[key] === "number" && Number.isFinite(box[key]),
	);
}

function refused(
	ctx: WsHandlerContext,
	command: string,
	docName: string,
	refusal: CompositionRefusal,
): void {
	log(`[${command}] FAIL: ${refusal.message}`);
	if (refusal.code === "name_taken") {
		ctx.bus.emit("toast", {
			key: "toast_document_name_taken",
			params: { name: docName },
			level: "error",
		});
		return;
	}
	ctx.bus.emit("toast", {
		key:
			refusal.code === "locked"
				? "toast_document_locked_edit"
				: refusal.code === "template_controlled"
					? "toast_page_template_controlled"
					: "toast_page_edit_refused",
		params: { doc: docName },
		level: "error",
	});
	ctx.broadcastState(ctx.documents.resolveOrLoad(docName));
}

export function handleCreateDocument(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "document_create" }>,
): void {
	const name = typeof msg.name === "string" ? msg.name.trim() : "";
	if (!name) return;
	const { w, h } = computeCanvasDims(
		BLANK_DOCUMENT_FORMAT,
		BLANK_DOCUMENT_ORIENTATION,
	);
	const result = ctx.pageComposition.createDocument({
		name,
		category: typeof msg.category === "string" ? msg.category : undefined,
		canvas: {
			format: BLANK_DOCUMENT_FORMAT,
			orientation: BLANK_DOCUMENT_ORIENTATION,
			w,
			h,
			bg: "#ffffff",
		},
		firstPageHtml: BLANK_PAGE_HTML,
	});
	if (!result.ok) refused(ctx, "document_create", name, result.refusal);
}

export function handleAddPage(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "page_add" }>,
): void {
	if (typeof msg.docName !== "string") return;
	const doc = ctx.documents.resolveOrLoad(msg.docName);
	const result = ctx.pageComposition.appendPage(msg.docName, {
		name: `Page ${(doc?.pages.length ?? 0) + 1}`,
		html: BLANK_PAGE_HTML,
	});
	if (!result.ok) refused(ctx, "page_add", msg.docName, result.refusal);
}

export function handleSetCanvasFormat(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "canvas_format_set" }>,
): void {
	if (typeof msg.docName !== "string") return;
	const doc = ctx.documents.resolveOrLoad(msg.docName);
	if (!doc) return;
	if (
		typeof msg.format !== "string" ||
		!Object.hasOwn(FORMATS, msg.format) ||
		!placedCompositionFormat(msg.format) ||
		!(ORIENTATIONS as readonly string[]).includes(msg.orientation)
	) {
		refused(ctx, "canvas_format_set", msg.docName, {
			code: "invalid",
			message: `Format ${String(msg.format)} ${String(msg.orientation)} is not a fixed format`,
		});
		return;
	}
	const { w, h } = computeCanvasDims(msg.format, msg.orientation);
	const result = ctx.pageComposition.setCanvas(msg.docName, {
		...doc.canvas,
		format: msg.format,
		orientation: msg.orientation,
		w,
		h,
	});
	if (!result.ok)
		refused(ctx, "canvas_format_set", msg.docName, result.refusal);
}

export function handleAddPlacedElement(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "element_add" }>,
): void {
	if (typeof msg.docName !== "string" || typeof msg.pageIndex !== "number")
		return;
	if (
		!(PLACED_ELEMENT_KINDS as readonly string[]).includes(msg.kind) ||
		!isPlacedBox(msg.box)
	) {
		refused(ctx, "element_add", msg.docName, {
			code: "invalid",
			message: "element_add needs a known kind and a box in millimetres",
		});
		return;
	}
	const result = ctx.pageComposition.addElement(msg.docName, msg.pageIndex, {
		kind: msg.kind,
		box: msg.box,
		asset: typeof msg.asset === "string" ? msg.asset : undefined,
		text: typeof msg.text === "string" ? msg.text : undefined,
	});
	if (!result.ok) refused(ctx, "element_add", msg.docName, result.refusal);
}

export function handleSetPlacedElementBox(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "element_box_set" }>,
): void {
	if (
		typeof msg.docName !== "string" ||
		typeof msg.pageIndex !== "number" ||
		typeof msg.elementId !== "string"
	)
		return;
	if (!isPlacedBox(msg.box)) {
		refused(ctx, "element_box_set", msg.docName, {
			code: "invalid",
			message: "element_box_set needs a box in millimetres",
		});
		return;
	}
	const result = ctx.pageComposition.setElementBox(
		msg.docName,
		msg.pageIndex,
		msg.elementId,
		msg.box,
	);
	if (!result.ok) refused(ctx, "element_box_set", msg.docName, result.refusal);
}

export function handleRemovePlacedElement(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "element_remove" }>,
): void {
	if (
		typeof msg.docName !== "string" ||
		typeof msg.pageIndex !== "number" ||
		typeof msg.elementId !== "string"
	)
		return;
	const result = ctx.pageComposition.removeElement(
		msg.docName,
		msg.pageIndex,
		msg.elementId,
	);
	if (!result.ok) refused(ctx, "element_remove", msg.docName, result.refusal);
}
