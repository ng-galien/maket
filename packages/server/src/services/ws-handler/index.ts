/**
 * ws-handler — browser WebSocket message processing.
 *
 * Built as a factory so the handler closes over injected services. The
 * returned function is what `index.ts` wires into `ws.on("message", ...)`.
 *
 * WARNING: doc.activePage / doc.currentPage reflects the SERVER's active
 * page, which may differ from what the browser client is viewing
 * (multi-page workspace). Always use msg.pageIndex from the client when
 * targeting a specific page.
 */

import type { WorkspaceCommand, WorkspaceStateSignal } from "@maket/shared";
import { parseHTML } from "linkedom";
import type WebSocket from "ws";
import { composeCharteCss } from "../../lib/charte-css.js";
import {
	createOnboardingDocument,
	localizeOnboardingDocument,
	onboardingDocumentName,
	onboardingLocale,
} from "../../lib/onboarding-document.js";
import { stripActiveHtml } from "../../lib/strip-active-html.js";
import {
	type Charte,
	computeCanvasDims,
	createDocument,
	type Document,
} from "../../types.js";
import { createCollectionCursors } from "../collection-cursor.js";
import { createCollections } from "../collections.js";
import {
	handleCollectionBindPage,
	handleCollectionClearPage,
	handleCollectionCursorSet,
	handleCollectionDelete,
	handleCollectionSave,
} from "./collection-commands.js";
import {
	isPlainObject,
	isStringArray,
	log,
	type WorkspaceCommandHandler,
	type WsHandlerContext,
	type WsHandlerDeps,
} from "./context.js";

export type { WorkspaceCommandHandler, WsHandlerDeps } from "./context.js";

export function createWsHandler(deps: WsHandlerDeps): WorkspaceCommandHandler {
	const { assets, bus, documents, pending, store, wsBridge, wsRegistry } = deps;
	const collections =
		deps.collections ?? createCollections({ bus, documents, store });
	const collectionCursors =
		deps.collectionCursors ??
		createCollectionCursors({ bus, documents, store });
	const ctx: WsHandlerContext = {
		assets,
		bus,
		collections,
		collectionCursors,
		documents,
		pending,
		store,
		wsBridge,
		wsRegistry,
		wsDoc: (msg) => (msg.docName ? documents.resolve(msg.docName) : null),
		broadcastState: (d) => {
			if (!d) return;
			wsRegistry.broadcast({
				type: "state",
				doc: documents.lightView(d),
				docList: documents.list(),
				collections: collections.loadAll(),
				collectionCursors: collectionCursors.snapshot(),
				charteCss: documents.charteCss(d),
			});
		},
	};

	return (msg, ws) => dispatchWorkspaceCommand(ctx, msg, ws);
}

function dispatchWorkspaceCommand(
	ctx: WsHandlerContext,
	msg: WorkspaceCommand,
	ws: WebSocket,
): void {
	switch (msg.type) {
		case "load_document":
			handleLoadDocument(ctx, msg, ws);
			break;
		case "sync_pending":
			ctx.pending.syncFromClient(msg.pending || []);
			break;
		case "workspace_update":
			handleWorkspaceUpdate(ctx, msg);
			break;
		case "layout_report":
			handleLayoutReport(ctx, msg);
			break;
		case "save_document":
			handleSaveDocument(ctx, msg);
			break;
		case "update_canvas":
			handleUpdateCanvas(ctx, msg);
			break;
		case "update_meta":
			handleUpdateMeta(ctx, msg);
			break;
		case "charte_save":
			handleCharteSave(ctx, msg);
			break;
		case "update_charte_meta":
			handleUpdateCharteMeta(ctx, msg);
			break;
		case "collection_save":
			handleCollectionSave(ctx, msg);
			break;
		case "collection_delete":
			handleCollectionDelete(ctx, msg);
			break;
		case "collection_bind_page":
			handleCollectionBindPage(ctx, msg);
			break;
		case "collection_clear_page":
			handleCollectionClearPage(ctx, msg);
			break;
		case "collection_cursor_set":
			handleCollectionCursorSet(ctx, msg);
			break;
		case "delete_asset":
			handleDeleteAsset(ctx, msg);
			break;
		case "update_asset_meta":
			handleUpdateAssetMeta(ctx, msg);
			break;
		case "page_go":
			handlePageGo(ctx, msg);
			break;
		case "clear_canvas":
			handleClearCanvas(ctx, msg);
			break;
		case "delete_document":
			handleDeleteDocument(ctx, msg);
			break;
		case "rename_document":
			handleRenameDocument(ctx, msg);
			break;
		case "duplicate_document":
			handleDuplicateDocument(ctx, msg);
			break;
		case "lock_document":
			handleLockDocument(ctx, msg);
			break;
		case "open_onboarding":
			handleOpenOnboarding(ctx, msg, ws);
			break;
		case "text_edit":
			handleTextEdit(ctx, msg);
			break;
		case "check_layout_response":
			if (msg._reqId) ctx.wsBridge.resolveResponse(msg._reqId, msg);
			break;
	}
}

function handleLoadDocument(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "load_document" }>,
	ws: WebSocket,
): void {
	let requested = ctx.documents.resolve(msg.name);
	if (!requested) {
		const loaded = ctx.store.loadOne(msg.name);
		if (loaded) {
			ctx.documents.all().set(loaded.name, loaded);
			requested = loaded;
		}
	}
	if (!requested) return;
	const state: WorkspaceStateSignal = {
		type: "state",
		doc: ctx.documents.lightView(requested),
		docList: ctx.documents.list(),
		collections: ctx.collections.loadAll(),
		collectionCursors: ctx.collectionCursors.snapshot(),
		charteCss: ctx.documents.charteCss(requested),
		addToWorkspace: true,
		focus: true,
	};
	ws.send(JSON.stringify(state));
}

function handleOpenOnboarding(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "open_onboarding" }>,
	ws: WebSocket,
): void {
	const doc = onboardingDocument(ctx, onboardingLocale(msg.lang));
	const state: WorkspaceStateSignal = {
		type: "state",
		doc: ctx.documents.lightView(doc),
		docList: ctx.documents.list(),
		collections: ctx.collections.loadAll(),
		collectionCursors: ctx.collectionCursors.snapshot(),
		charteCss: ctx.documents.charteCss(doc),
		addToWorkspace: true,
		focus: true,
	};
	ws.send(JSON.stringify(state));
}

function onboardingDocument(
	ctx: WsHandlerContext,
	locale: ReturnType<typeof onboardingLocale>,
): Document {
	const name = onboardingDocumentName();
	const existing = ctx.documents.resolveOrLoad(name);
	if (existing) {
		localizeOnboardingDocument(existing, locale);
		ctx.documents.persist(existing.name);
		return existing;
	}
	const doc = createOnboardingDocument(locale);
	ctx.documents.all().set(doc.name, doc);
	ctx.documents.persist(doc.name);
	return doc;
}

function handleWorkspaceUpdate(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "workspace_update" }>,
): void {
	const displayed = new Set<string>(msg.displayed || []);
	for (const [name, doc] of ctx.documents.all()) {
		doc._displayed = displayed.has(name);
	}
}

function handleLayoutReport(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "layout_report" }>,
): void {
	const d = ctx.wsDoc(msg);
	if (d) {
		d._layout = {
			overflow: msg.overflow ?? false,
			containerHeight: msg.containerHeight ?? 0,
			contentHeight: msg.contentHeight ?? 0,
			overflowBy: msg.overflowBy ?? 0,
			overflowing: msg.overflowing ?? [],
		};
	}
	if (msg.measureId) ctx.wsBridge.resolveResponse(msg.measureId, msg);
}

function handleSaveDocument(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "save_document" }>,
): void {
	const d = ctx.wsDoc(msg);
	if (!d) return;
	ctx.documents.persist(d.name);
	ctx.bus.emit("document:saved", { docName: d.name });
	ctx.bus.emit("toast", {
		text: `Document "${d.name}" saved`,
		level: "success",
	});
	log(`Saved via UI: "${d.name}"`);
}

function handleUpdateCanvas(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "update_canvas" }>,
): void {
	const d = ctx.wsDoc(msg);
	if (!d) return;
	if (msg.format || msg.orientation != null) {
		const fmt = msg.format || d.canvas.format;
		const orient = msg.orientation ?? d.canvas.orientation ?? "portrait";
		const { w, h } = computeCanvasDims(fmt, orient);
		d.canvas.format = fmt;
		d.canvas.w = w;
		d.canvas.h = h;
		d.canvas.orientation = orient;
	}
	if (msg.bg) d.canvas.bg = msg.bg;
	ctx.bus.emit("canvas:changed", { docName: d.name });
}

function handleUpdateMeta(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "update_meta" }>,
): void {
	const d = ctx.wsDoc(msg);
	if (!d) return;
	if (d.meta?.locked === true) {
		ctx.bus.emit("toast", {
			text: `"${d.name}" is locked — unlock it to edit metadata`,
			level: "info",
		});
		return;
	}
	if (!d.meta) d.meta = {};
	if (msg.designNotes !== undefined) d.meta.designNotes = msg.designNotes;
	if (msg.teamNotes !== undefined) d.meta.teamNotes = msg.teamNotes;
	if (msg.rating !== undefined)
		d.meta.rating = Math.max(0, Math.min(5, Number(msg.rating) || 0));
	if (msg.charte !== undefined) d.meta.charte = msg.charte;
	if (msg.category !== undefined) d.category = msg.category || "general";
	ctx.documents.persist(d.name);
	ctx.bus.emit("meta:updated", { docName: d.name });
}

function handleCharteSave(
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

function handleUpdateCharteMeta(
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

function handleDeleteAsset(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "delete_asset" }>,
): void {
	if (!msg.filename) return;
	const filename = String(msg.filename);
	if (!ctx.assets.exists(filename)) return;
	ctx.assets.remove(filename);
	ctx.store.deleteAsset(filename);
	ctx.bus.emit("assets:changed", {});
}

function handleUpdateAssetMeta(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "update_asset_meta" }>,
): void {
	const filename = String(msg.filename || "");
	if (!filename) return;
	if (!ctx.assets.exists(filename)) {
		ctx.bus.emit("toast", {
			text: `Asset "${filename}" not found`,
			level: "error",
		});
		return;
	}
	const invalid = validateAssetMetaPayload(msg);
	if (invalid) {
		ctx.bus.emit("toast", {
			text: `Asset "${filename}" rejected: ${invalid}`,
			level: "error",
		});
		return;
	}
	ctx.store.saveAsset({
		filename,
		title: msg.title,
		description: msg.description,
		category: msg.category,
		tags: msg.tags,
		credit: msg.credit,
		orientation: msg.orientation,
	});
	ctx.bus.emit("assets:changed", {});
}

function handlePageGo(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "page_go" }>,
): void {
	const d = ctx.wsDoc(msg);
	if (!d || msg.page < 1 || msg.page > d.pages.length) return;
	d.activePage = msg.page - 1;
	ctx.bus.emit("document:loaded", { docName: d.name });
}

function handleClearCanvas(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "clear_canvas" }>,
): void {
	const d = ctx.wsDoc(msg);
	if (!d) return;
	const page = d.pages[d.activePage];
	if (page) page.elements = [];
	d.nextId = 1;
	ctx.bus.emit("elements:cleared", { docName: d.name });
}

function handleDeleteDocument(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "delete_document" }>,
): void {
	const name = msg.name;
	const d = ctx.documents.resolve(name ?? "");
	if (!name || !d || ctx.documents.all().size <= 1) return;
	if (d.meta?.locked === true) {
		ctx.bus.emit("toast", {
			text: `"${name}" is locked — unlock it to delete`,
			level: "info",
		});
		return;
	}
	ctx.documents.delete(name);
	ctx.pending.dropDoc(name);
	ctx.bus.emit("document:deleted", { docName: name });
}

function handleRenameDocument(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "rename_document" }>,
): void {
	const { name, newName } = msg;
	if (!name || !newName || name === newName) return;
	const d = ctx.documents.resolve(name);
	if (!d) return;
	if (d.meta?.locked === true) {
		ctx.bus.emit("toast", {
			text: `"${name}" is locked — unlock it to rename`,
			level: "info",
		});
		return;
	}
	if (ctx.documents.all().has(newName)) {
		ctx.bus.emit("toast", {
			text: `Name "${newName}" already exists`,
			level: "error",
		});
		return;
	}
	ctx.documents.delete(name);
	d.name = newName;
	ctx.documents.all().set(newName, d);
	ctx.documents.persist(newName);
	ctx.wsRegistry.broadcast({ type: "doc_removed", name });
	ctx.bus.emit("document:loaded", { docName: newName });
	ctx.bus.emit("toast", {
		text: `"${name}" → "${newName}"`,
		level: "success",
	});
}

function handleDuplicateDocument(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "duplicate_document" }>,
): void {
	const { name, newName } = msg;
	if (!name || !newName) return;
	const src = ctx.documents.resolve(name);
	if (!src) return;
	if (ctx.documents.all().has(newName)) {
		ctx.bus.emit("toast", {
			text: `Name "${newName}" already exists`,
			level: "error",
		});
		return;
	}
	const cloneData = structuredClone({
		name: newName,
		category: src.category,
		canvas: src.canvas,
		meta: src.meta,
		pages: src.pages,
		activePage: src.activePage,
		nextId: src.nextId,
	});
	if (cloneData.meta) cloneData.meta.locked = false;
	const clone = createDocument(cloneData);
	ctx.documents.all().set(clone.name, clone);
	ctx.documents.persist(clone.name);
	ctx.bus.emit("document:created", { docName: clone.name });
	ctx.bus.emit("toast", {
		text: `"${name}" cloned → "${clone.name}"`,
		level: "success",
	});
}

function handleLockDocument(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "lock_document" }>,
): void {
	const { name, locked } = msg;
	if (!name) return;
	const d = ctx.documents.resolve(name);
	if (!d) return;
	if (!d.meta) d.meta = {};
	d.meta.locked = locked === true;
	ctx.documents.persist(d.name);
	ctx.bus.emit("meta:updated", { docName: d.name });
	ctx.bus.emit("toast", {
		text: locked ? `"${d.name}" locked` : `"${d.name}" unlocked`,
		level: "info",
	});
}

function handleTextEdit(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "text_edit" }>,
): void {
	if (!msg.docName || !msg.elementId || msg.html == null) {
		log(
			`[text_edit] FAIL: missing fields — docName:${msg.docName} elementId:${msg.elementId} html:${msg.html != null}`,
		);
		return;
	}
	const d = ctx.documents.resolve(msg.docName);
	if (!d) {
		log(`[text_edit] FAIL: doc not found: ${msg.docName}`);
		return;
	}
	const pi = typeof msg.pageIndex === "number" ? msg.pageIndex : d.activePage;
	const page = d.pages[pi];
	if (!page?.html) {
		log(`[text_edit] FAIL: no page html for ${msg.docName} page ${pi}`);
		return;
	}
	const { document: dom } = parseHTML(`<html><body>${page.html}</body></html>`);
	const el = dom.body.querySelector(`[data-id="${msg.elementId}"]`);
	if (!el) {
		log(`[text_edit] FAIL: element not found: ${msg.elementId}`);
		return;
	}
	log(
		`[text_edit] OK: ${msg.docName} → ${msg.elementId} (${msg.html.length} chars) activePage:${d.activePage} pages:${d.pages.length} page.html.length:${page.html.length}`,
	);
	el.innerHTML = (msg.html as string).replace(/<style[\s\S]*?<\/style>/gi, "");
	page.html = stripActiveHtml(dom.body.innerHTML);
	log(`[text_edit] updated page.html length: ${page.html.length}`);
	ctx.documents.persist(d.name);
	ctx.broadcastState(d);
}

/** Runtime shape check for `charte_save` payloads. Returns an error message
 * when the payload would persist malformed data, `null` when it's safe. The
 * MCP tool path has zod; this is the WS equivalent. */
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
function validateAssetMetaPayload(msg: {
	title?: unknown;
	description?: unknown;
	category?: unknown;
	tags?: unknown;
	credit?: unknown;
	orientation?: unknown;
}): string | null {
	for (const key of [
		"title",
		"description",
		"category",
		"credit",
		"orientation",
	] as const) {
		const v = msg[key];
		if (v !== undefined && typeof v !== "string")
			return `${key} must be a string`;
	}
	if (msg.tags !== undefined && !isStringArray(msg.tags))
		return "tags must be a string[]";
	return null;
}
