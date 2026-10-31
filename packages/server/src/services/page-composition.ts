/**
 * page-composition — owner of document, page, canvas and page-element
 * mutations shared by the WS commands and the MCP tools.
 *
 * Every mutation resolves its target, applies the shared guards (locked
 * document, template-controlled page, generated continuation page),
 * persists, and emits on the bus. Propagation to browsers stays in the bus
 * listeners of `server-events.ts`.
 *
 * Placed elements are ordinary page HTML: a child of the page root
 * (`data-id="page"`) with a stable `data-id` and an inline
 * `position:absolute` box in millimetres. The frame
 * and the image are empty decorations and carry the existing
 * `data-maket-layout="ignore"` so that a text laid over them passes the
 * layout check.
 */

import crypto from "node:crypto";
import {
	BLANK_PAGE_HTML,
	clampPlacedBox,
	type PlacedBox,
	type PlacedElementKind,
	placedBoxFits,
	placedBoxFromStyle,
	placedCompositionFormat,
	placedContainer,
	styleWithPlacedBox,
	validateDocumentStatePageTemplate,
} from "@maket/shared";
import { parseHTML } from "linkedom";
import { stripActiveHtml } from "../lib/strip-active-html.js";
import {
	type Canvas,
	createDocument,
	type DocMeta,
	type Document,
	type Page,
} from "../types.js";
import type { AssetsService } from "./assets.js";
import type { Bus } from "./bus.js";
import type { DocumentRenderer } from "./document-renderer.js";
import { validateStateTemplateUpdate } from "./document-states.js";
import type { Documents } from "./documents.js";
import { flowSourcePageId, isFlowContinuation } from "./page-flow.js";
import type { Store } from "./store.js";
import {
	lockedDocumentMessage,
	templateControlledPageMessage,
} from "./structured-workspace-policy.js";

export const LAYOUT_IGNORE_ATTRIBUTE = "data-maket-layout";
export const LAYOUT_IGNORE_VALUE = "ignore";

export type CompositionRefusalCode =
	| "not_found"
	| "name_taken"
	| "locked"
	| "template_controlled"
	| "continuation_page"
	| "auto_format"
	| "invalid"
	| "element_not_found"
	| "not_placed"
	| "layout_ignored"
	| "asset_missing";

export interface CompositionRefusal {
	code: CompositionRefusalCode;
	message: string;
}

export type CompositionResult<T> =
	| { ok: true; value: T }
	| { ok: false; refusal: CompositionRefusal };

export interface NewDocument {
	name: string;
	category?: string;
	canvas: Canvas;
	meta?: DocMeta;
	/** HTML of the first page; the page has no HTML when omitted. */
	firstPageHtml?: string;
}

export interface NewPage {
	name: string;
	html?: string;
	jsonForms?: Page["jsonForms"];
}

export interface PlacedElementSpec {
	kind: PlacedElementKind;
	box: PlacedBox;
	/** Library image file name, required for `kind: "image"`. */
	asset?: string;
	/** Initial content of `kind: "text"`. */
	text?: string;
}

export interface PageComposition {
	/** Creates, persists and announces a document; refuses a taken name. */
	createDocument(input: NewDocument): CompositionResult<Document>;
	/** Appends a page at the end of a writable document. */
	appendPage(docName: string, input: NewPage): CompositionResult<Page>;
	/** Replaces the canvas of a writable document. */
	setCanvas(docName: string, canvas: Canvas): CompositionResult<Document>;
	/** Places a new element on a page and returns its `data-id`. */
	addElement(
		docName: string,
		pageIndex: number,
		spec: PlacedElementSpec,
	): CompositionResult<string>;
	/** Moves or resizes a placed element. */
	setElementBox(
		docName: string,
		pageIndex: number,
		elementId: string,
		box: PlacedBox,
	): CompositionResult<void>;
	/** Removes a placed element. */
	removeElement(
		docName: string,
		pageIndex: number,
		elementId: string,
	): CompositionResult<void>;
	/** Replaces the inner HTML of an element (in-place text editing). */
	editElementHtml(
		docName: string,
		pageIndex: number,
		elementId: string,
		html: string,
	): CompositionResult<void>;
}

export interface PageCompositionDeps {
	assets: Pick<AssetsService, "exists">;
	bus: Bus;
	documentRenderer: Pick<DocumentRenderer, "render">;
	documents: Documents;
	store: Store;
}

const FRAME_STYLE =
	"box-sizing:border-box;margin:0;padding:0;border:0.5mm solid #334155";
const IMAGE_STYLE =
	"box-sizing:border-box;margin:0;padding:0;display:block;object-fit:cover";
const TEXT_STYLE =
	"box-sizing:border-box;margin:0;padding:1mm;font-size:12pt;line-height:1.3";

type DomElement = {
	getAttribute(name: string): string | null;
	setAttribute(name: string, value: string): void;
	remove(): void;
	parentNode: unknown;
	innerHTML: string;
};

type DomBody = {
	innerHTML: string;
	children: ArrayLike<unknown>;
	getAttribute(name: string): string | null;
	querySelectorAll(selector: string): Iterable<DomElement>;
	insertAdjacentHTML(position: "beforeend", html: string): void;
};

function refuse<T>(
	code: CompositionRefusalCode,
	message: string,
): CompositionResult<T> {
	return { ok: false, refusal: { code, message } };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** Ordinary HTML of a placed element: `data-id` first, then its inline box;
 * the frame and the image are empty decorations exempt from layout checks. */
function placedElementHtml(
	id: string,
	spec: PlacedElementSpec,
	box: PlacedBox,
): string {
	const base =
		spec.kind === "frame"
			? FRAME_STYLE
			: spec.kind === "image"
				? IMAGE_STYLE
				: TEXT_STYLE;
	const style = escapeHtml(
		styleWithPlacedBox(`position:absolute;${base}`, box),
	);
	const decoration = `data-noedit="" ${LAYOUT_IGNORE_ATTRIBUTE}="${LAYOUT_IGNORE_VALUE}"`;
	if (spec.kind === "text")
		return `<div data-id="${id}" style="${style}">${escapeHtml(spec.text?.trim() || "Text")}</div>`;
	if (spec.kind === "image")
		return `<img data-id="${id}" ${decoration} src="/assets/${escapeHtml(encodeURIComponent(spec.asset ?? ""))}" alt="" style="${style}">`;
	return `<div data-id="${id}" ${decoration} style="${style}"></div>`;
}

function findById(body: DomBody, id: string): DomElement | null {
	for (const element of body.querySelectorAll("[data-id]")) {
		if (element.getAttribute("data-id") === id) return element;
	}
	return null;
}

function newElementId(body: DomBody, kind: PlacedElementKind): string {
	for (;;) {
		const id = `${kind}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
		if (!findById(body, id)) return id;
	}
}

function writableDocument(
	deps: PageCompositionDeps,
	docName: string,
): CompositionResult<Document> {
	const doc = deps.documents.resolveOrLoad(docName);
	if (!doc) return refuse("not_found", `Document "${docName}" not found`);
	const locked = lockedDocumentMessage(doc);
	if (locked) return refuse("locked", locked);
	return { ok: true, value: doc };
}

/** The authored page behind a page index of the rendered document, which
 * differs when a state list flows onto continuation pages; null for a
 * continuation page. */
function authoredPageIndex(
	deps: PageCompositionDeps,
	doc: Document,
	shownIndex: number,
): number | null {
	if (doc.dataModel !== "state") return shownIndex;
	const shown = deps.documentRenderer.render(doc).pages;
	if (shown.length === doc.pages.length) return shownIndex;
	const shownPage = shown[shownIndex];
	if (!shownPage) return shownIndex;
	if (isFlowContinuation(shownPage)) return null;
	const sourceId = flowSourcePageId(shownPage);
	const index = doc.pages.findIndex((page) => page.id === sourceId);
	return index >= 0 ? index : shownIndex;
}

/** A writable authored page of `docName`: not locked, not a generated
 * continuation, not controlled by a Workspace template. */
function writablePage(
	deps: PageCompositionDeps,
	docName: string,
	shownIndex: number,
	requireHtml: boolean,
): CompositionResult<{ doc: Document; page: Page }> {
	const writable = writableDocument(deps, docName);
	if (!writable.ok) return writable;
	const doc = writable.value;
	const index = authoredPageIndex(deps, doc, shownIndex);
	if (index === null)
		return refuse(
			"continuation_page",
			`Page ${shownIndex + 1} of "${doc.name}" is a generated continuation page.`,
		);
	const page = doc.pages[index];
	if (!page)
		return refuse(
			"not_found",
			`Page ${shownIndex + 1} of "${doc.name}" not found`,
		);
	if (requireHtml && !page.html)
		return refuse(
			"element_not_found",
			`Page ${shownIndex + 1} of "${doc.name}" has no HTML`,
		);
	const controlled = templateControlledPageMessage(doc, page);
	if (controlled) return refuse("template_controlled", controlled);
	return { ok: true, value: { doc, page } };
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// The single write path of page HTML: guard, DOM change, sanitizing,
// validation, persistence and bus notification are owned here on purpose.
/** Resolves a writable authored page, lets `mutate` change its DOM, then
 * strips active markup, validates, persists and announces the result. */
function mutatePage<T>(
	deps: PageCompositionDeps,
	target: { docName: string; pageIndex: number; requireHtml?: boolean },
	mutate: (body: DomBody, doc: Document) => CompositionResult<T>,
): CompositionResult<T> {
	const resolved = writablePage(
		deps,
		target.docName,
		target.pageIndex,
		target.requireHtml === true,
	);
	if (!resolved.ok) return resolved;
	const { doc, page } = resolved.value;
	const { document: dom } = parseHTML(
		`<html><body>${page.html ?? ""}</body></html>`,
	);
	const body = dom.body as unknown as DomBody;
	const result = mutate(body, doc);
	if (!result.ok) return result;
	const nextHtml = stripActiveHtml(body.innerHTML);
	try {
		validateDocumentStatePageTemplate({ ...page, html: nextHtml });
		validateStateTemplateUpdate(doc, deps.store, { ...page, html: nextHtml });
	} catch (error) {
		return refuse("invalid", errorMessage(error));
	}
	page.html = nextHtml;
	deps.documents.persist(doc.name);
	deps.bus.emit("document:saved", { docName: doc.name });
	return result;
}

function placedElement(
	body: DomBody,
	elementId: string,
): CompositionResult<DomElement> {
	const element = findById(body, elementId);
	if (!element)
		return refuse("element_not_found", `Element "${elementId}" not found`);
	if (
		element.parentNode !== placedContainer(body) ||
		!placedBoxFromStyle(element.getAttribute("style"))
	)
		return refuse(
			"not_placed",
			`Element "${elementId}" is not a placed element (child of the page root, position:absolute, left/top/width/height in mm).`,
		);
	return { ok: true, value: element };
}

/** Refuses an AUTO document or a box outside the page. */
function placementFits(doc: Document, box: PlacedBox): CompositionResult<void> {
	if (!placedCompositionFormat(doc.canvas.format))
		return refuse(
			"auto_format",
			`Document "${doc.name}" uses the AUTO format; choose a fixed format before placing elements.`,
		);
	if (!placedBoxFits(box, doc.canvas.w, doc.canvas.h))
		return refuse(
			"invalid",
			`Box ${JSON.stringify(box)} does not fit the ${doc.canvas.w}x${doc.canvas.h}mm page.`,
		);
	return { ok: true, value: undefined };
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Document creation coordinates the document factory, the registry,
// persistence and the post-commit bus notifications.
function createDocumentIn(
	deps: PageCompositionDeps,
	input: NewDocument,
): CompositionResult<Document> {
	if (deps.documents.nameTaken(input.name))
		return refuse("name_taken", `Document "${input.name}" already exists`);
	const doc = createDocument({
		name: input.name,
		category: input.category || "general",
		canvas: input.canvas,
		meta: input.meta,
		...(input.firstPageHtml === undefined
			? {}
			: {
					pages: [{ name: "Page 1", elements: [], html: input.firstPageHtml }],
				}),
	});
	deps.documents.all().set(doc.name, doc);
	deps.documents.persist(doc.name);
	deps.bus.emit("document:created", { docName: doc.name });
	deps.bus.emit("toast", {
		key: "toast_document_created",
		params: {
			doc: doc.name,
			format: doc.canvas.format,
			orientation: doc.canvas.orientation,
		},
		level: "success",
	});
	return { ok: true, value: doc };
}

function appendPageTo(
	deps: PageCompositionDeps,
	docName: string,
	input: NewPage,
): CompositionResult<Page> {
	const writable = writableDocument(deps, docName);
	if (!writable.ok) return writable;
	const doc = writable.value;
	const owner = doc.meta.structuredWorkspace;
	const page: Page = {
		id: crypto.randomUUID(),
		name: input.name,
		elements: [],
		html: input.html,
		jsonForms: input.jsonForms,
		provenance: owner
			? { kind: "instance", workspaceId: owner.workspaceId }
			: undefined,
	};
	try {
		if (doc.dataModel === "state") validateDocumentStatePageTemplate(page);
		doc.pages.push(page);
		doc.activePage = doc.pages.length - 1;
		deps.documents.persist(doc.name);
	} catch (error) {
		return refuse("invalid", errorMessage(error));
	}
	deps.bus.emit("document:loaded", { docName: doc.name });
	return { ok: true, value: page };
}

function setCanvasOf(
	deps: PageCompositionDeps,
	docName: string,
	canvas: Canvas,
): CompositionResult<Document> {
	const writable = writableDocument(deps, docName);
	if (!writable.ok) return writable;
	const doc = writable.value;
	doc.canvas = canvas;
	deps.documents.persist(doc.name);
	deps.bus.emit("canvas:changed", { docName: doc.name });
	return { ok: true, value: doc };
}

function addElementTo(
	deps: PageCompositionDeps,
	target: { docName: string; pageIndex: number },
	spec: PlacedElementSpec,
): CompositionResult<string> {
	if (spec.kind === "image" && (!spec.asset || !deps.assets.exists(spec.asset)))
		return refuse(
			"asset_missing",
			`Image "${spec.asset ?? ""}" is not in the image library`,
		);
	return mutatePage(deps, target, (body, doc) => {
		const fits = placementFits(doc, spec.box);
		if (!fits.ok) return fits;
		const box = clampPlacedBox(spec.box, doc.canvas.w, doc.canvas.h);
		const id = newElementId(body, spec.kind);
		if (body.children.length === 0)
			body.insertAdjacentHTML("beforeend", BLANK_PAGE_HTML);
		placedContainer(body).insertAdjacentHTML(
			"beforeend",
			placedElementHtml(id, spec, box),
		);
		return { ok: true, value: id };
	});
}

function setElementBoxOn(
	deps: PageCompositionDeps,
	target: { docName: string; pageIndex: number },
	elementId: string,
	box: PlacedBox,
): CompositionResult<void> {
	return mutatePage(deps, target, (body, doc) => {
		const fits = placementFits(doc, box);
		if (!fits.ok) return fits;
		const placed = placedElement(body, elementId);
		if (!placed.ok) return placed;
		const element = placed.value;
		element.setAttribute(
			"style",
			styleWithPlacedBox(
				element.getAttribute("style") ?? "",
				clampPlacedBox(box, doc.canvas.w, doc.canvas.h),
			),
		);
		return { ok: true, value: undefined };
	});
}

function removeElementFrom(
	deps: PageCompositionDeps,
	target: { docName: string; pageIndex: number },
	elementId: string,
): CompositionResult<void> {
	return mutatePage(deps, target, (body) => {
		const placed = placedElement(body, elementId);
		if (!placed.ok) return placed;
		placed.value.remove();
		return { ok: true, value: undefined };
	});
}

function editElementHtmlOn(
	deps: PageCompositionDeps,
	target: { docName: string; pageIndex: number },
	elementId: string,
	html: string,
): CompositionResult<void> {
	return mutatePage(deps, { ...target, requireHtml: true }, (body) => {
		const element = findById(body, elementId);
		if (!element)
			return refuse("element_not_found", `Element "${elementId}" not found`);
		if (element.getAttribute(LAYOUT_IGNORE_ATTRIBUTE) === LAYOUT_IGNORE_VALUE)
			return refuse(
				"layout_ignored",
				`Content cannot be changed while ${LAYOUT_IGNORE_ATTRIBUTE}="${LAYOUT_IGNORE_VALUE}" is active.`,
			);
		element.innerHTML = html.replace(/<style[\s\S]*?<\/style>/gi, "");
		return { ok: true, value: undefined };
	});
}

export function createPageComposition(
	deps: PageCompositionDeps,
): PageComposition {
	return {
		createDocument: (input) => createDocumentIn(deps, input),
		appendPage: (docName, input) => appendPageTo(deps, docName, input),
		setCanvas: (docName, canvas) => setCanvasOf(deps, docName, canvas),
		addElement: (docName, pageIndex, spec) =>
			addElementTo(deps, { docName, pageIndex }, spec),
		setElementBox: (docName, pageIndex, elementId, box) =>
			setElementBoxOn(deps, { docName, pageIndex }, elementId, box),
		removeElement: (docName, pageIndex, elementId) =>
			removeElementFrom(deps, { docName, pageIndex }, elementId),
		editElementHtml: (docName, pageIndex, elementId, html) =>
			editElementHtmlOn(deps, { docName, pageIndex }, elementId, html),
	};
}
