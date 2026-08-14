import type {
	ActivityKey,
	Collection,
	DocumentStateClientView,
	WorkspaceCommand,
	WorkspaceSignal,
} from "@maket/shared";
import en from "../i18n/en.json";

import fr from "../i18n/fr.json";
import { getLang } from "../i18n/useT";
import type { DocSummary, Document } from "./types";
import {
	hasPendingStatePatchForDocument,
	type PendingMessage,
	useStore,
} from "./useStore";
import { requestFit } from "./zoomBridge";

const BUBBLE_LANGS: Record<string, Record<ActivityKey, string>> = { fr, en };

export function translateBubble(
	key: ActivityKey,
	params?: Record<string, string>,
): string {
	const dict = BUBBLE_LANGS[getLang()] ?? BUBBLE_LANGS.en;
	let text = dict[key];
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			text = text.replace(`{${k}}`, v);
		}
	}
	return text;
}

let ws: WebSocket | null = null;
const backgroundLoadDocs = new Set<string>();
const annotationCreateRequests = new Map<
	string,
	{
		resolve: (outcome: AnnotationCreateOutcome) => void;
		timeout: ReturnType<typeof setTimeout>;
	}
>();

export interface AnnotationCreateOutcome {
	ok: boolean;
	error?: string;
}

export function sendTextEdit(
	docName: string,
	pageIndex: number,
	elementId: string,
	html: string,
): void {
	wsSend({ type: "text_edit", docName, pageIndex, elementId, html });
}

export function sendStateValuePatch(
	docName: string,
	pointer: string,
	expectedRevision: number,
	value: null | string | number | boolean,
): string | null {
	if (
		hasPendingStatePatchForDocument(
			useStore.getState().statePatchPending,
			docName,
		)
	) {
		return null;
	}
	const requestId = crypto.randomUUID();
	const sent = wsSend({
		type: "state_patch",
		requestId,
		docName,
		expectedRevision,
		operation: { op: "replace", path: pointer, value },
	});
	if (!sent) {
		useStore.getState().beginStatePatch(docName, pointer, requestId);
		useStore
			.getState()
			.settleStatePatch(requestId, "State update could not be sent.");
		return null;
	}
	useStore.getState().beginStatePatch(docName, pointer, requestId);
	setTimeout(
		() =>
			useStore
				.getState()
				.timeoutStatePatch(requestId, "State update timed out."),
		10_000,
	);
	return requestId;
}

// Lucide icon SVG paths (subset)
const LUCIDE: Record<string, string> = {
	"image-plus":
		'<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/><line x1="16" x2="22" y1="5" y2="5"/><line x1="19" x2="19" y1="2" y2="8"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
	"trash-2":
		'<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
	"file-pen":
		'<path d="M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v10"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10.4 12.6a2 2 0 0 0-3 3L12 20l4 1-1-4Z"/>',
	wrench:
		'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
	"file-plus":
		'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/>',
	save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
	"folder-open":
		'<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
	palette:
		'<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
	download:
		'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
	pin: '<line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>',
	"check-circle":
		'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
	zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
	info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
	scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
	camera:
		'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
	tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
};

function spawnBubble(text: string, icon?: string) {
	if (!text.trim()) return;
	const state = useStore.getState();
	if (state.workspaceView === "reading") return;
	const barPos = state.barPosition;
	const isTop = barPos === "top";
	const bubble = document.createElement("div");
	bubble.dataset.maketActivity = "";
	bubble.setAttribute("role", "status");
	const svgHtml =
		icon && LUCIDE[icon]
			? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">${LUCIDE[icon]}</svg>`
			: "";
	bubble.innerHTML = svgHtml;
	const label = document.createElement("span");
	label.textContent = text;
	bubble.appendChild(label);
	Object.assign(bubble.style, {
		position: "fixed",
		[isTop ? "top" : "bottom"]: "80px",
		right: "24px",
		background: "var(--color-accent, #10B981)",
		color: "white",
		fontSize: "13px",
		fontWeight: "600",
		padding: "10px 18px",
		borderRadius: "24px",
		pointerEvents: "none",
		zIndex: "9999",
		whiteSpace: "nowrap",
		boxShadow: "0 4px 16px rgba(16,185,129,0.35)",
		animation: isTop
			? "bubbleDown 2.5s ease-out forwards"
			: "bubbleUp 2.5s ease-out forwards",
		display: "flex",
		alignItems: "center",
		gap: "8px",
		fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
	});
	document.body.appendChild(bubble);
	setTimeout(() => bubble.remove(), 2500);
}

function spawnToast(text: string, level: string, duration: number): void {
	if (!text.trim()) return;
	let region = document.getElementById("maket-toast-region");
	if (!region) {
		region = document.createElement("div");
		region.id = "maket-toast-region";
		document.body.appendChild(region);
	}
	const isTop = useStore.getState().barPosition === "top";
	Object.assign(region.style, {
		position: "fixed",
		[isTop ? "top" : "bottom"]: "80px",
		[isTop ? "bottom" : "top"]: "auto",
		right: "24px",
		display: "flex",
		flexDirection: "column",
		gap: "8px",
		alignItems: "flex-end",
		pointerEvents: "none",
		zIndex: "var(--z-toast, 9999)",
	});
	const toast = document.createElement("div");
	toast.setAttribute("role", level === "error" ? "alert" : "status");
	toast.textContent = text;
	const backgrounds: Record<string, string> = {
		success: "#047857",
		error: "#b91c1c",
		warning: "#b45309",
		info: "#1f2937",
	};
	Object.assign(toast.style, {
		maxWidth: "360px",
		background: backgrounds[level] ?? backgrounds.info,
		color: "white",
		fontSize: "13px",
		fontWeight: "600",
		padding: "10px 14px",
		borderRadius: "10px",
		boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
		opacity: "1",
		transition: "opacity 180ms ease",
		fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
	});
	region.appendChild(toast);
	setTimeout(
		() => {
			toast.style.opacity = "0";
			setTimeout(() => {
				toast.remove();
				if (region?.childElementCount === 0) region.remove();
			}, 180);
		},
		Math.max(1000, duration || 3000),
	);
}

// Inject the animation keyframes once
if (!document.getElementById("bubble-css")) {
	const style = document.createElement("style");
	style.id = "bubble-css";
	style.textContent = `
    @keyframes bubbleUp {
      0% { opacity: 1; transform: translateY(0) scale(1); }
      60% { opacity: 0.9; transform: translateY(-80px) scale(0.98); }
      100% { opacity: 0; transform: translateY(-150px) scale(0.85); }
    }
    @keyframes bubbleDown {
      0% { opacity: 1; transform: translateY(0) scale(1); }
      60% { opacity: 0.9; transform: translateY(80px) scale(0.98); }
      100% { opacity: 0; transform: translateY(150px) scale(0.85); }
    }
  `;
	document.head.appendChild(style);
}
let pendingLoadDoc: string | null = null;
let initialStateReceived = false;

/**
 * Inject `@import url(...)` lines from a charte's CSS as real <link> tags in
 * document.head. The PageCanvas only reads --charte-* vars inline and drops
 * the @import, so without this the workspace never loads the charte's web
 * fonts — whereas the server-rendered /print route does, causing the two
 * renders to diverge.
 * Dedupes by URL so switching between docs with the same charte is a no-op.
 */
const loadedCharteFontUrls = new Set<string>();
export function ensureCharteFonts(charteCss: string): void {
	if (!charteCss) return;
	const imports = charteCss.matchAll(/@import\s+url\(['"]?([^'")]+)['"]?\)/g);
	for (const m of imports) {
		const url = m[1];
		if (!url || loadedCharteFontUrls.has(url)) continue;
		loadedCharteFontUrls.add(url);
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = url;
		link.setAttribute("data-charte-font", "1");
		document.head.appendChild(link);
	}
}

export function initWs(): void {
	if (ws) return;
	connect();
}

function connect(): void {
	const url = import.meta.env.DEV
		? `ws://${location.host}/ws`
		: `ws://${location.host}`;
	ws = new WebSocket(url);
	ws.onopen = handleWsOpen;
	ws.onclose = handleWsClose;
	ws.onerror = () => {};
	ws.onmessage = handleWsMessage;
}

function handleWsOpen(): void {
	pendingLoadDoc = null;
	initialStateReceived = false;
	useStore.getState().setConnected(true);
	wsSend({
		type: "workspace_update",
		displayed: useStore.getState().workspaceDocNames,
	});
}

function handleWsClose(): void {
	useStore.getState().setConnected(false);
	useStore.getState().clearStatePatches();
	settleAllAnnotationCreates(
		"The connection closed before the note was saved.",
	);
	ws = null;
	setTimeout(connect, 2000);
}

function handleWsMessage(e: MessageEvent): void {
	let msg: WorkspaceSignal;
	try {
		msg = JSON.parse(e.data) as WorkspaceSignal;
	} catch {
		return;
	}
	applyWorkspaceSignal(msg);
}

function applyWorkspaceSignal(msg: WorkspaceSignal): void {
	switch (msg.type) {
		case "state":
			applyStateMessage(msg);
			break;
		case "state_pages":
			useStore
				.getState()
				.applyStatePages(
					msg.docName,
					msg.pages,
					msg.documentState,
					(msg.docList ?? []) as DocSummary[],
				);
			break;
		case "state_patch_result":
			useStore
				.getState()
				.settleStatePatch(
					msg.requestId,
					msg.ok ? undefined : (msg.error ?? "State update failed."),
				);
			if (!msg.ok) {
				spawnToast(msg.error ?? "State update failed.", "error", 4000);
			}
			break;
		case "toast":
			spawnToast(msg.text, msg.level, msg.duration);
			break;
		case "charte_updated":
			applyCharteUpdated(msg.name, msg.css);
			break;
		case "reload":
			location.reload();
			break;
		case "doc_removed":
			console.log("[ws] doc_removed:", msg.name);
			useStore.getState().removeDocFromWorkspace(msg.name);
			break;
		case "doc_renamed":
			applyRenamedDocument(msg);
			break;
		case "charte_removed":
			applyCharteUpdated(msg.name, "");
			break;
		case "assets_changed":
			window.dispatchEvent(new Event("assets-changed"));
			break;
		case "collections_changed":
			useStore
				.getState()
				.setCollections((msg.collections ?? []) as Collection[]);
			break;
		case "collection_cursors":
			useStore.getState().setCollectionCursors(msg.cursors ?? []);
			break;
		case "fit_view":
			if (useStore.getState().workspaceView === "canvas") requestFit();
			break;
		case "activity":
			spawnBubble(translateBubble(msg.key, msg.params), msg.icon);
			break;
		case "ack_messages":
			applyAckMessages(msg.ids as string[]);
			break;
		case "annotations_changed":
			useStore.setState({ pending: msg.annotations as PendingMessage[] });
			break;
		case "annotation_create_result":
			settleAnnotationCreate(msg.requestId, {
				ok: msg.ok,
				...(msg.error ? { error: msg.error } : {}),
			});
			break;
		default:
			reportUnhandledSignal(msg);
	}
}

function reportUnhandledSignal(msg: never): void {
	console.error("[ws] unhandled server signal", msg);
}

function applyStateMessage(
	msg: Extract<WorkspaceSignal, { type: "state" }>,
): void {
	const doc = msg.doc as Document | null;
	const docList = (msg.docList ?? []) as DocSummary[];
	if (msg.annotations !== undefined) {
		useStore.setState({ pending: msg.annotations as PendingMessage[] });
	}
	if (msg.collections !== undefined) {
		useStore.getState().setCollections(msg.collections as Collection[]);
	}
	if (msg.collectionCursors !== undefined) {
		useStore.getState().setCollectionCursors(msg.collectionCursors);
	}
	if (msg.charteCss) ensureCharteFonts(msg.charteCss);
	if (!doc) {
		initialStateReceived = true;
		useStore.setState({ docList });
		return;
	}
	if (msg.documentState !== undefined) {
		useStore
			.getState()
			.setDocumentState(
				doc.name,
				(msg.documentState as DocumentStateClientView | null) ?? null,
			);
	}
	if (!initialStateReceived)
		applyInitialState(doc, docList, msg.charteCss || "");
	else {
		const explicitFocus = pendingLoadDoc === doc.name;
		const backgroundLoad = backgroundLoadDocs.delete(doc.name);
		useStore
			.getState()
			.upsertDoc(
				doc,
				docList,
				msg.charteCss || "",
				msg.addToWorkspace ?? true,
				backgroundLoad && !explicitFocus ? false : (msg.focus ?? false),
				explicitFocus,
			);
	}
	if (pendingLoadDoc === doc.name) pendingLoadDoc = null;
}

function applyRenamedDocument(
	msg: Extract<WorkspaceSignal, { type: "doc_renamed" }>,
): void {
	const doc = msg.doc as Document;
	const docList = (msg.docList ?? []) as DocSummary[];
	if (msg.annotations !== undefined) {
		useStore.setState({ pending: msg.annotations as PendingMessage[] });
	}
	if (msg.collections !== undefined) {
		useStore.getState().setCollections(msg.collections as Collection[]);
	}
	if (msg.collectionCursors !== undefined) {
		useStore.getState().setCollectionCursors(msg.collectionCursors);
	}
	if (msg.charteCss) ensureCharteFonts(msg.charteCss);
	useStore
		.getState()
		.replaceRenamedDoc(
			msg.oldName,
			doc,
			docList,
			msg.charteCss || "",
			msg.documentState,
		);
}

function applyInitialState(
	doc: Document,
	docList: DocSummary[],
	charteCss: string,
): void {
	initialStateReceived = true;
	useStore.getState().upsertDoc(doc, docList, charteCss, false, false);
	for (const name of useStore.getState().workspaceDocNames) {
		if (name !== doc.name) sendBackgroundLoadDoc(name);
		else useStore.getState().upsertDoc(doc, docList, charteCss, true, true);
	}
}

function sendBackgroundLoadDoc(name: string): void {
	backgroundLoadDocs.add(name);
	wsSend({ type: "load_document", name });
}

function applyCharteUpdated(name: string, css: string): void {
	ensureCharteFonts(css);
	const s = useStore.getState();
	const chartesCss = new Map(s.chartesCss);
	for (const [docName, doc] of s.docs) {
		if (doc.meta?.charte === name) chartesCss.set(docName, css);
	}
	useStore.setState({
		chartesCss,
		chartesVersion: s.chartesVersion + 1,
	});
}

function applyAckMessages(idsList: string[]): void {
	const ids = new Set(idsList);
	const s = useStore.getState();
	console.log(
		"[ws] ack_messages received:",
		idsList,
		"pending before:",
		s.pending.length,
		"pending ids:",
		s.pending.map((m) => m.id),
	);
	const filtered = s.pending.filter((m) => !ids.has(m.id));
	if (filtered.length !== s.pending.length) {
		useStore.setState({ pending: filtered });
		console.log("[ws] pending after:", filtered.length);
	} else {
		console.log("[ws] no matching pending found for ack ids");
	}
}

export function wsSend(msg: WorkspaceCommand): boolean {
	if (ws && ws.readyState === 1) {
		ws.send(JSON.stringify(msg));
		return true;
	}
	return false;
}

export function sendAnnotationCreate(
	annotation: Extract<
		WorkspaceCommand,
		{ type: "annotation_create" }
	>["annotation"],
): Promise<AnnotationCreateOutcome> {
	const requestId = crypto.randomUUID();
	return new Promise((resolve) => {
		const timeout = setTimeout(
			() =>
				settleAnnotationCreate(requestId, {
					ok: false,
					error: "The note could not be confirmed by the server.",
				}),
			10_000,
		);
		annotationCreateRequests.set(requestId, { resolve, timeout });
		if (wsSend({ type: "annotation_create", requestId, annotation })) return;
		settleAnnotationCreate(requestId, {
			ok: false,
			error: "The note could not be sent.",
		});
	});
}

function settleAnnotationCreate(
	requestId: string,
	outcome: AnnotationCreateOutcome,
): void {
	const pending = annotationCreateRequests.get(requestId);
	if (!pending) return;
	clearTimeout(pending.timeout);
	annotationCreateRequests.delete(requestId);
	pending.resolve(outcome);
}

function settleAllAnnotationCreates(error: string): void {
	for (const requestId of annotationCreateRequests.keys()) {
		settleAnnotationCreate(requestId, { ok: false, error });
	}
}

export function sendLoadDoc(name: string): boolean {
	backgroundLoadDocs.delete(name);
	pendingLoadDoc = name;
	const sent = wsSend({ type: "load_document", name });
	if (!sent) pendingLoadDoc = null;
	return sent;
}

export function clearActivityBubbles(): void {
	for (const bubble of document.querySelectorAll("[data-maket-activity]")) {
		bubble.remove();
	}
}

export function sendDeleteDoc(name: string): void {
	wsSend({ type: "delete_document", name });
}

export function sendRenameDoc(name: string, newName: string): void {
	wsSend({ type: "rename_document", name, newName });
}

export function sendDuplicateDoc(name: string, newName: string): void {
	wsSend({ type: "duplicate_document", name, newName });
}

export function sendLockDoc(name: string, locked: boolean): void {
	wsSend({ type: "lock_document", name, locked });
}
