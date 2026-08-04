/**
 * Text edit, onboarding, layout and workspace display handlers.
 */

import type { WorkspaceCommand, WorkspaceStateSignal } from "@maket/shared";
import { parseHTML } from "linkedom";
import type WebSocket from "ws";
import {
	createOnboardingDocument,
	localizeOnboardingDocument,
	onboardingDocumentName,
	onboardingLocale,
} from "../../lib/onboarding-document.js";
import { stripActiveHtml } from "../../lib/strip-active-html.js";
import type { Document } from "../../types.js";
import type { WsHandlerContext } from "./context.js";
import { log } from "./context.js";

export function handleOpenOnboarding(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "open_onboarding" }>,
	ws: WebSocket,
): void {
	const doc = onboardingDocument(ctx, onboardingLocale(msg.lang));
	const state: WorkspaceStateSignal = {
		type: "state",
		doc: ctx.documents.lightView(ctx.documentRenderer.render(doc)),
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

export function handleWorkspaceUpdate(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "workspace_update" }>,
): void {
	const displayed = new Set<string>(msg.displayed || []);
	for (const [name, doc] of ctx.documents.all()) {
		doc._displayed = displayed.has(name);
	}
}

export function handleLayoutReport(
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

// code-moniker: ignore[smell-feature-envy-local]
// text_edit is a WS adapter workflow: resolve doc/page, patch HTML via
// linkedom, strip active markup, persist, broadcast. Coordinating those
// owners is intentional edge glue, not feature envy of Document alone.
export function handleTextEdit(
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
