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
import { computeCanvasDims, type Document } from "../types.js";
import type { Bus } from "./bus.js";
import type { Config } from "./config.js";
import type { Documents } from "./documents.js";
import type { Store } from "./store.js";
import type { WsBridge } from "./ws-bridge.js";
import type { WsRegistry } from "./ws-registry.js";

export type WsMessage = WsClientMessage;

export type WsMessageHandler = (msg: WsMessage, ws: WebSocket) => void;

export interface WsHandlerDeps {
	bus: Bus;
	config: Config;
	documents: Documents;
	store: Store;
	wsRegistry: WsRegistry;
	wsBridge: WsBridge;
}

const log = (...a: unknown[]) =>
	process.stderr.write(`${a.map(String).join(" ")}\n`);

export function createWsHandler(deps: WsHandlerDeps): WsMessageHandler {
	const { bus, config, documents, store, wsRegistry, wsBridge } = deps;
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
				// Client holds pending at workspace level (each entry carries its
				// own docName); server stores per-doc. Bucket by docName then
				// replace on every loaded doc — docs absent from the client's
				// list get their `_pending` cleared so the sync is authoritative.
				const byDoc = new Map<string, NonNullable<Document["_pending"]>>();
				for (const p of msg.pending || []) {
					if (!p.docName) continue;
					const arr = byDoc.get(p.docName) ?? [];
					arr.push(p);
					byDoc.set(p.docName, arr);
				}
				for (const doc of documents.all().values()) {
					doc._pending = byDoc.get(doc.name) ?? [];
				}
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
				if (!d.meta) d.meta = {};
				if (msg.designNotes != null) d.meta.designNotes = msg.designNotes;
				if (msg.teamNotes != null) d.meta.teamNotes = msg.teamNotes;
				if (msg.rating != null)
					d.meta.rating = Math.max(0, Math.min(5, Number(msg.rating) || 0));
				if (msg.charte != null) d.meta.charte = msg.charte;
				bus.emit("meta:updated", { docName: d.name });
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
				if (!name || !documents.all().has(name)) break;
				if (documents.all().size <= 1) break;
				documents.delete(name);
				bus.emit("document:deleted", { docName: name });
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
				el.innerHTML = (msg.html as string)
					.replace(/<script[\s\S]*?<\/script>/gi, "")
					.replace(/<style[\s\S]*?<\/style>/gi, "");
				page.html = dom.body.innerHTML;
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
