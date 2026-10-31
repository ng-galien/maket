/**
 * Text edit, onboarding, layout and workspace display handlers.
 */

import type { WorkspaceCommand, WorkspaceStateSignal } from "@maket/shared";
import type WebSocket from "ws";
import {
	createOnboardingDocument,
	localizeOnboardingDocument,
	onboardingDocumentName,
	onboardingLocale,
} from "../../lib/onboarding-document.js";
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
		documentState: ctx.documentRenderer.stateView(doc),
		docList: ctx.documents.list(),
		collections: ctx.collections.loadAll(),
		collectionCursors: ctx.collectionCursors.snapshot(),
		annotations: ctx.pending.all(),
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
	const doc = ctx.documents.resolveOrLoad(msg.docName);
	const shownIndex =
		typeof msg.pageIndex === "number" ? msg.pageIndex : (doc?.activePage ?? 0);
	const result = ctx.pageComposition.editElementHtml(
		msg.docName,
		shownIndex,
		msg.elementId,
		msg.html,
	);
	if (result.ok) {
		log(`[text_edit] OK: ${msg.docName} → ${msg.elementId}`);
		return;
	}
	log(`[text_edit] FAIL: ${result.refusal.message}`);
	if (
		doc &&
		result.refusal.code !== "not_found" &&
		result.refusal.code !== "element_not_found"
	)
		ctx.broadcastState(doc);
}
