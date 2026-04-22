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

import { existsSync, unlinkSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { WsClientMessage, WsStateMessage } from "@maket/shared";
import { parseHTML } from "linkedom";
import type WebSocket from "ws";
import { composeCharteCss } from "../lib/charte-css.js";
import { stripActiveHtml } from "../lib/strip-active-html.js";
import {
	type Charte,
	computeCanvasDims,
	createDocument,
	type Document,
} from "../types.js";
import type { Bus } from "./bus.js";
import type { Config } from "./config.js";
import type { Documents } from "./documents.js";
import type { Pending } from "./pending.js";
import type { Store } from "./store.js";
import type { WsBridge } from "./ws-bridge.js";
import type { WsRegistry } from "./ws-registry.js";

export type WsMessage = WsClientMessage;

export type WsMessageHandler = (msg: WsMessage, ws: WebSocket) => void;

export interface WsHandlerDeps {
	bus: Bus;
	config: Config;
	documents: Documents;
	pending: Pending;
	store: Store;
	wsRegistry: WsRegistry;
	wsBridge: WsBridge;
}

const log = (...a: unknown[]) =>
	process.stderr.write(`${a.map(String).join(" ")}\n`);

export function createWsHandler(deps: WsHandlerDeps): WsMessageHandler {
	const { bus, config, documents, pending, store, wsRegistry, wsBridge } = deps;
	const assetsDir = config.ASSETS_DIR;

	function wsDoc(msg: { docName?: string }): Document | null {
		return msg.docName ? documents.resolve(msg.docName) : null;
	}

	function broadcastState(d: Document | null): void {
		if (!d) return;
		wsRegistry.broadcast({
			type: "state",
			doc: documents.lightView(d),
			docList: documents.list(),
			charteCss: documents.charteCss(d),
		});
	}

	return (msg, ws) => {
		switch (msg.type) {
			case "load_document": {
				let requested = documents.resolve(msg.name);
				if (!requested) {
					const loaded = store.loadOne(msg.name);
					if (loaded) {
						documents.all().set(loaded.name, loaded);
						requested = loaded;
					}
				}
				if (requested) {
					const state: WsStateMessage = {
						type: "state",
						doc: documents.lightView(requested),
						docList: documents.list(),
						charteCss: documents.charteCss(requested),
						addToWorkspace: true,
						focus: true,
					};
					ws.send(JSON.stringify(state));
				}
				break;
			}

			case "sync_pending": {
				// Client is authoritative — it holds the whole queue and pushes
				// the snapshot on every mutation (and on ws.onopen to survive a
				// server restart). The service buckets by docName and routes
				// entries without one to its workspace bucket.
				pending.syncFromClient(msg.pending || []);
				break;
			}

			case "workspace_update": {
				const displayed = new Set<string>(msg.displayed || []);
				for (const [name, doc] of documents.all()) {
					doc._displayed = displayed.has(name);
				}
				break;
			}

			case "layout_report": {
				const d = wsDoc(msg);
				if (d) {
					d._layout = {
						overflow: msg.overflow ?? false,
						containerHeight: msg.containerHeight ?? 0,
						contentHeight: msg.contentHeight ?? 0,
						overflowBy: msg.overflowBy ?? 0,
						overflowing: msg.overflowing ?? [],
					};
				}
				if (msg.measureId) wsBridge.resolveResponse(msg.measureId, msg);
				break;
			}

			case "save_document": {
				const d = wsDoc(msg);
				if (d) {
					documents.persist(d.name);
					bus.emit("document:saved", { docName: d.name });
					bus.emit("toast", {
						text: `Document "${d.name}" saved`,
						level: "success",
					});
					log(`Saved via UI: "${d.name}"`);
				}
				break;
			}

			case "update_canvas": {
				const d = wsDoc(msg);
				if (!d) break;
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
				bus.emit("canvas:changed", { docName: d.name });
				break;
			}

			case "update_meta": {
				const d = wsDoc(msg);
				if (!d) break;
				if (d.meta?.locked === true) {
					bus.emit("toast", {
						text: `"${d.name}" is locked — unlock it to edit metadata`,
						level: "info",
					});
					break;
				}
				if (!d.meta) d.meta = {};
				if (msg.designNotes != null) d.meta.designNotes = msg.designNotes;
				if (msg.teamNotes != null) d.meta.teamNotes = msg.teamNotes;
				if (msg.rating != null)
					d.meta.rating = Math.max(0, Math.min(5, Number(msg.rating) || 0));
				if (msg.charte != null) d.meta.charte = msg.charte;
				if (msg.category != null) d.category = msg.category || "general";
				documents.persist(d.name);
				bus.emit("meta:updated", { docName: d.name });
				break;
			}

			case "charte_save": {
				const name = String(msg.name || "").trim();
				if (!name) {
					bus.emit("toast", {
						text: "Charte name is required",
						level: "error",
					});
					break;
				}
				// Runtime shape check — the MCP tool path is zod-validated; this
				// WS path was not, so a malformed client message could persist
				// `tokens: "oops"` and break everything that reads the charte.
				const invalid = validateCharteSavePayload(msg);
				if (invalid) {
					bus.emit("toast", {
						text: `Charte "${name}" rejected: ${invalid}`,
						level: "error",
					});
					break;
				}
				const charte: Charte = {
					name,
					description: msg.description,
					tokens: (msg.tokens ?? {}) as Charte["tokens"],
				};
				if (msg.voice) charte.voice = msg.voice;
				if (msg.rules) charte.rules = msg.rules;
				store.saveCharte(charte);
				bus.emit("charte:updated", { name, css: composeCharteCss(charte) });
				bus.emit("toast", {
					text: `Charte "${name}" saved`,
					level: "success",
				});
				break;
			}

			case "delete_asset": {
				if (!msg.filename) break;
				const filename = String(msg.filename);
				const abs = resolve(join(assetsDir, filename));
				if (!abs.startsWith(resolve(assetsDir) + sep)) break;
				if (!existsSync(abs)) break;
				unlinkSync(abs);
				const thumb = join(assetsDir, "thumbs", filename);
				if (existsSync(thumb)) unlinkSync(thumb);
				store.deleteAsset(filename);
				bus.emit("assets:changed", {});
				break;
			}

			case "page_go": {
				const d = wsDoc(msg);
				if (
					d &&
					typeof msg.page === "number" &&
					msg.page >= 1 &&
					msg.page <= d.pages.length
				) {
					d.activePage = msg.page - 1;
					bus.emit("document:loaded", { docName: d.name });
				}
				break;
			}

			case "clear_canvas": {
				const d = wsDoc(msg);
				if (d) {
					const page = d.pages[d.activePage];
					if (page) page.elements = [];
					d.nextId = 1;
					bus.emit("elements:cleared", { docName: d.name });
				}
				break;
			}

			case "delete_document": {
				const name = msg.name;
				const d = documents.resolve(name ?? "");
				if (!name || !d) break;
				if (documents.all().size <= 1) break;
				if (d.meta?.locked === true) {
					bus.emit("toast", {
						text: `"${name}" is locked — unlock it to delete`,
						level: "info",
					});
					break;
				}
				documents.delete(name);
				pending.dropDoc(name);
				bus.emit("document:deleted", { docName: name });
				break;
			}

			case "rename_document": {
				const { name, newName } = msg;
				if (!name || !newName || name === newName) break;
				const d = documents.resolve(name);
				if (!d) break;
				if (d.meta?.locked === true) {
					bus.emit("toast", {
						text: `"${name}" is locked — unlock it to rename`,
						level: "info",
					});
					break;
				}
				if (documents.all().has(newName)) {
					bus.emit("toast", {
						text: `Name "${newName}" already exists`,
						level: "error",
					});
					break;
				}
				// Rename path: the cache key moves, so we delete the old record from
				// the store + cache, mutate d.name, and re-insert. A subsequent
				// `document:loaded` broadcasts the new state; `remove_doc` for the
				// old name clears it from every connected client.
				documents.delete(name);
				d.name = newName;
				documents.all().set(newName, d);
				documents.persist(newName);
				wsRegistry.broadcast({ type: "remove_doc", name });
				bus.emit("document:loaded", { docName: newName });
				bus.emit("toast", {
					text: `"${name}" → "${newName}"`,
					level: "success",
				});
				break;
			}

			case "duplicate_document": {
				const { name, newName } = msg;
				if (!name || !newName) break;
				const src = documents.resolve(name);
				if (!src) break;
				if (documents.all().has(newName)) {
					bus.emit("toast", {
						text: `Name "${newName}" already exists`,
						level: "error",
					});
					break;
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
				documents.all().set(clone.name, clone);
				documents.persist(clone.name);
				bus.emit("document:created", { docName: clone.name });
				bus.emit("toast", {
					text: `"${name}" cloned → "${clone.name}"`,
					level: "success",
				});
				break;
			}

			case "lock_document": {
				const { name, locked } = msg;
				if (!name) break;
				const d = documents.resolve(name);
				if (!d) break;
				if (!d.meta) d.meta = {};
				d.meta.locked = locked === true;
				documents.persist(d.name);
				bus.emit("meta:updated", { docName: d.name });
				bus.emit("toast", {
					text: locked ? `"${d.name}" locked` : `"${d.name}" unlocked`,
					level: "info",
				});
				break;
			}

			case "text_edit": {
				if (!msg.docName || !msg.elementId || msg.html == null) {
					log(
						`[text_edit] FAIL: missing fields — docName:${msg.docName} elementId:${msg.elementId} html:${msg.html != null}`,
					);
					break;
				}
				const d = documents.resolve(msg.docName);
				if (!d) {
					log(`[text_edit] FAIL: doc not found: ${msg.docName}`);
					break;
				}
				const pi =
					typeof msg.pageIndex === "number" ? msg.pageIndex : d.activePage;
				const page = d.pages[pi];
				if (!page?.html) {
					log(`[text_edit] FAIL: no page html for ${msg.docName} page ${pi}`);
					break;
				}
				const { document: dom } = parseHTML(
					`<html><body>${page.html}</body></html>`,
				);
				const el = dom.body.querySelector(`[data-id="${msg.elementId}"]`);
				if (!el) {
					log(`[text_edit] FAIL: element not found: ${msg.elementId}`);
					break;
				}
				log(
					`[text_edit] OK: ${msg.docName} → ${msg.elementId} (${msg.html.length} chars) activePage:${d.activePage} pages:${d.pages.length} page.html.length:${page.html.length}`,
				);
				// Strip <style> first (stripActiveHtml doesn't touch styles —
				// they are not executable), then run the centralised active-html
				// scrub on the result. The two-step keeps the existing UX of
				// rejecting <style> in inline edits while sharing the
				// script/iframe/on*/javascript: filter with every other write.
				el.innerHTML = (msg.html as string).replace(
					/<style[\s\S]*?<\/style>/gi,
					"",
				);
				page.html = stripActiveHtml(dom.body.innerHTML);
				log(`[text_edit] updated page.html length: ${page.html.length}`);
				documents.persist(d.name);
				broadcastState(d);
				break;
			}

			case "check_layout_response":
				if (msg._reqId) wsBridge.resolveResponse(msg._reqId, msg);
				break;
		}
	};
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((s) => typeof s === "string");
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
