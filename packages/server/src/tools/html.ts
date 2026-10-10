/**
 * html pack — maket_html (compound).
 *
 * Compound dispatch: set, patch, get, check.
 *
 * Charte compliance is a business-rule invariant:
 *   - set   — rejects the whole HTML when any violation is found, and requires
 *             a valid context_token from maket_charte view.
 *   - patch — rolls back each violating op individually, keeping the rest.
 *
 * Layout is measured on the page as readers see it: a state-backed page is
 * hydrated with the current document state, a collection page with the
 * member its preview cursor shows (the first member otherwise). Other pages
 * are measured as authored.
 *
 * Deps: `documents`, `store` (charte reads), `layout` (WS broadcast +
 * measurement), `assets` (charteToken / validateCharteToken),
 * `documentRenderer` + `collectionCursors` (the rendered page to measure).
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import { asFunction } from "awilix";
import { parseHTML } from "linkedom";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import { checkCharteCompliance } from "../lib/charte-check.js";
import { cursorRenderOptions } from "../lib/collection-render.js";
import {
	brokenPageLinks,
	formatPageLinkIssues,
	templatedPageLinkError,
} from "../lib/page-links.js";
import { stripActiveHtml } from "../lib/strip-active-html.js";
import type { AssetsService } from "../services/assets.js";
import { validateCharteToken } from "../services/assets.js";
import type { CollectionCursors } from "../services/collection-cursor.js";
import type { DocumentRenderer } from "../services/document-renderer.js";
import { validateStateTemplateUpdate } from "../services/document-states.js";
import type { Documents } from "../services/documents.js";
import type { LayoutResult, LayoutService } from "../services/layout.js";
import { flowSourcePageId } from "../services/page-flow.js";
import type { Store } from "../services/store.js";
import type { Charte, Document, Page } from "../types.js";
import { lockGuard, templatePageGuard, text } from "./_helpers.js";

export interface HtmlDeps {
	documents: Documents;
	store: Store;
	layout: LayoutService;
	assets: AssetsService;
	documentRenderer: Pick<
		DocumentRenderer,
		"render" | "renderSettled" | "stateView"
	>;
	collectionCursors: Pick<CollectionCursors, "resolve">;
}

// ============================================================
// Exported HTML utilities (used by other packs — mermaid, pages)
// ============================================================

export function normalizeImageSrc(html: string): string {
	return html.replace(
		/src=["'](?!\/|https?:\/\/|data:)([\w.\-()% ]+\.(?:jpe?g|png|webp|svg|gif))["']/gi,
		'src="/assets/$1"',
	);
}

export function cssEscape(s: string): string {
	return s.replace(/["\\]/g, "\\$&");
}

// ============================================================
// Internal helpers
// ============================================================

function camelToKebab(s: string): string {
	return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

const LAYOUT_CONTROL_ATTRIBUTE = "data-maket-layout";
const LAYOUT_IGNORE_VALUE = "ignore";
const LAYOUT_IGNORE_PATCH_GUIDANCE =
	'Add data-maket-layout="ignore" only with maket_html action=patch using attr on an existing data-id.';
const LAYOUT_INTERACTIVE_TAGS = new Set([
	"a",
	"audio",
	"button",
	"details",
	"iframe",
	"input",
	"label",
	"option",
	"select",
	"summary",
	"textarea",
	"video",
]);
const LAYOUT_INTERACTIVE_ATTRIBUTES = new Set([
	"contenteditable",
	"data-maket-bind",
	"href",
	"role",
	"tabindex",
]);

function containsLayoutControlAttribute(html: string): boolean {
	const { document } = parseHTML(`<html><body>${html}</body></html>`);
	return document.body.querySelector(`[${LAYOUT_CONTROL_ATTRIBUTE}]`) !== null;
}

function hasLayoutControlAttr(op: PatchOp): boolean {
	return Object.keys(op.attr ?? {}).some(
		(name) => name.toLowerCase() === LAYOUT_CONTROL_ATTRIBUTE,
	);
}

function isInteractiveLayoutTarget(el: DomEl): boolean {
	const tag = String(el.tagName || "").toLowerCase();
	if (LAYOUT_INTERACTIVE_TAGS.has(tag)) return true;
	return [...LAYOUT_INTERACTIVE_ATTRIBUTES].some((name) =>
		el.hasAttribute(name),
	);
}

function layoutControlOpError(op: PatchOp, el: DomEl | null): string | null {
	for (const html of [op.insert, op.replace, op.content]) {
		if (html && containsLayoutControlAttribute(html)) {
			return `${LAYOUT_CONTROL_ATTRIBUTE} is not allowed inside patch HTML. ${LAYOUT_IGNORE_PATCH_GUIDANCE}`;
		}
	}
	const attrEntries = Object.entries(op.attr ?? {});
	const layoutEntry = attrEntries.find(
		([name]) => name.toLowerCase() === LAYOUT_CONTROL_ATTRIBUTE,
	);
	if (layoutEntry) {
		const [name, value] = layoutEntry;
		if (name !== LAYOUT_CONTROL_ATTRIBUTE || value !== LAYOUT_IGNORE_VALUE) {
			return `${LAYOUT_CONTROL_ATTRIBUTE} only accepts the value "${LAYOUT_IGNORE_VALUE}".`;
		}
		const operationKeys = Object.keys(op).filter(
			(key) => key !== "id" && key !== "attr",
		);
		if (attrEntries.length !== 1 || operationKeys.length !== 0) {
			return `${LAYOUT_IGNORE_PATCH_GUIDANCE} The enabling op must contain only id and that single attr.`;
		}
		if (
			el &&
			(el.children?.length > 0 ||
				Boolean(el.textContent?.trim()) ||
				isInteractiveLayoutTarget(el))
		) {
			return `${LAYOUT_CONTROL_ATTRIBUTE}="${LAYOUT_IGNORE_VALUE}" is allowed only on a non-interactive leaf decoration with no child elements or text content.`;
		}
	}
	if (el?.getAttribute(LAYOUT_CONTROL_ATTRIBUTE) === LAYOUT_IGNORE_VALUE) {
		if (op.content !== undefined) {
			return `Content cannot be changed while ${LAYOUT_CONTROL_ATTRIBUTE}="${LAYOUT_IGNORE_VALUE}" is active.`;
		}
		if (
			op.insert &&
			(!op.position ||
				op.position === "afterbegin" ||
				op.position === "beforeend")
		) {
			return `Content cannot be inserted inside a block while ${LAYOUT_CONTROL_ATTRIBUTE}="${LAYOUT_IGNORE_VALUE}" is active.`;
		}
		if (
			Object.keys(op.attr ?? {}).some((name) =>
				LAYOUT_INTERACTIVE_ATTRIBUTES.has(name.toLowerCase()),
			)
		) {
			return `Interactive attributes cannot be added while ${LAYOUT_CONTROL_ATTRIBUTE}="${LAYOUT_IGNORE_VALUE}" is active.`;
		}
	}
	return null;
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP tool action `mergeStyles`: edge adapter over services/store/bus, not domain ownership.
function mergeStyles(existing: string, newStyles: string): string {
	const map = new Map<string, string>();
	for (const part of existing.split(";")) {
		const [k, ...v] = part.split(":");
		if (k?.trim()) map.set(k.trim(), v.join(":").trim());
	}
	for (const part of newStyles.split(";")) {
		const [k, ...v] = part.split(":");
		if (k?.trim()) map.set(k.trim(), v.join(":").trim());
	}
	return [...map.entries()].map(([k, v]) => `${k}:${v}`).join(";");
}

interface IdTreeNode {
	getAttribute?: (name: string) => string | null;
	children?: IdTreeNode[];
}

function buildIdTree(source: string | IdTreeNode): string {
	const root: IdTreeNode =
		typeof source === "string"
			? (parseHTML(`<html><body>${source}</body></html>`).document
					.body as unknown as IdTreeNode)
			: source;
	const lines: string[] = [];
	function walk(el: IdTreeNode, depth: number) {
		const id = el.getAttribute?.("data-id");
		if (id) lines.push(`${"  ".repeat(depth)}${id}`);
		for (const child of el.children || []) walk(child, id ? depth + 1 : depth);
	}
	walk(root, 0);
	return lines.join("\n");
}

function formatViolations(
	violations: {
		elementId: string;
		property: string;
		value: string;
		suggestion: string;
	}[],
): string {
	const lines = [
		`⛔ Charte violation — ${violations.length} issue(s). HTML rejected.`,
		"",
		...violations.map(
			(v) =>
				`  [${v.elementId}] ${v.property}: ${v.value}\n    → ${v.suggestion}`,
		),
		"",
		"Fix: use var(--charte-*) tokens instead of hardcoded values.",
	];
	return lines.join("\n");
}

function resolveDocPage(
	documents: Documents,
	docName: string,
	page1based: number,
): { doc: Document; page: Page; pageIdx: number } | string {
	const doc = documents.resolve(docName);
	if (!doc) return `Document "${docName}" not found`;
	const pageIdx = page1based - 1;
	const page = doc.pages[pageIdx];
	if (!page) return `Page ${page1based} not found (${doc.pages.length} pages)`;
	return { doc, page, pageIdx };
}

function layoutNextHints(
	result: LayoutResult,
	docName: string,
	page: number,
): string[] | undefined {
	if (result.status === "ok") return undefined;
	if (result.status === "unchecked") return undefined;
	const targets = [
		...new Set([
			...result.overflowIds,
			...result.overlapIds,
			...(result.tightIds ?? []),
		]),
	].filter(Boolean);
	const target =
		targets.length > 0
			? `  # target: ${targets.join(", ")}`
			: "  # reduce paddings/margins to add clearance inside the safe zone";
	return [
		`maket_preview action=snapshot doc=${docName} page=${page}`,
		`maket_html action=patch doc=${docName} page=${page} ops=[...]${target}`,
	];
}

// ============================================================
// Patch op schema (used by action=patch)
// ============================================================

const PatchOpSchema = z
	.object({
		id: z.string(),
		style: z.record(z.string(), z.string()).optional(),
		remove: z.boolean().optional(),
		insert: z.string().optional(),
		position: z
			.enum(["beforebegin", "afterbegin", "beforeend", "afterend"])
			.optional(),
		replace: z.string().optional(),
		content: z.string().optional(),
		attr: z.record(z.string(), z.string()).optional(),
		clone: z.string().optional(),
		moveTo: z.string().optional(),
	})
	.passthrough();

type PatchOp = z.infer<typeof PatchOpSchema>;

type DomEl = any;

function charteCheckEl(
	charte: Charte | null,
	el: DomEl,
	savedOuterHtml: string,
	opId: string,
	results: string[],
): boolean {
	if (!charte) return false;
	const violations = checkCharteCompliance(el.outerHTML, charte);
	if (violations.length === 0) return false;
	el.outerHTML = savedOuterHtml;
	results.push(
		`⛔ ${opId} rejected: ${violations.map((v) => `${v.property}: ${v.value} → ${v.suggestion}`).join("; ")}`,
	);
	return true;
}

function charteCheckHtml(
	charte: Charte | null,
	html: string,
	opId: string,
	savedOuterHtml: string | null,
	root: DomEl,
	results: string[],
): boolean {
	if (!charte) return false;
	const violations = checkCharteCompliance(html, charte);
	if (violations.length === 0) return false;
	if (savedOuterHtml) {
		const target = root.querySelector(`[data-id="${cssEscape(opId)}"]`);
		if (target) target.outerHTML = savedOuterHtml;
	}
	results.push(
		`⛔ ${opId} rejected: ${violations.map((v) => `${v.property}: ${v.value} → ${v.suggestion}`).join("; ")}`,
	);
	return true;
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP tool action `applyOp`: edge adapter over services/store/bus, not domain ownership.
function applyOp(op: PatchOp, root: DomEl, charte: Charte | null): string {
	const el = root.querySelector(`[data-id="${cssEscape(op.id)}"]`);
	const layoutControlError = layoutControlOpError(op, el);
	if (layoutControlError) return `⛔ ${op.id} rejected: ${layoutControlError}`;

	if (op.remove) {
		if (!el) return `${op.id} not found`;
		el.remove();
		return `removed ${op.id}`;
	}
	if (op.replace) {
		if (!el) return `${op.id} not found`;
		const saved = el.outerHTML;
		el.outerHTML = op.replace;
		const results: string[] = [];
		if (charteCheckHtml(charte, op.replace, op.id, saved, root, results))
			return results[0] ?? "";
		const replaced = root.querySelector(`[data-id="${cssEscape(op.id)}"]`);
		return `replaced ${op.id}${replaced ? ` → ${replaced.outerHTML}` : ""}`;
	}
	if (op.clone) {
		if (!el) return `${op.id} not found`;
		const clone = el.cloneNode(true);
		clone.removeAttribute(LAYOUT_CONTROL_ATTRIBUTE);
		for (const child of clone.querySelectorAll(
			`[${LAYOUT_CONTROL_ATTRIBUTE}]`,
		)) {
			child.removeAttribute(LAYOUT_CONTROL_ATTRIBUTE);
		}
		clone.setAttribute("data-id", op.clone);
		for (const child of clone.querySelectorAll("[data-id]")) {
			const childId = child.getAttribute("data-id");
			child.setAttribute("data-id", `${op.clone}-${childId}`);
		}
		el.insertAdjacentElement(op.position || "afterend", clone);
		return `cloned ${op.id} → ${op.clone}`;
	}
	if (op.moveTo) {
		const target = root.querySelector(`[data-id="${cssEscape(op.moveTo)}"]`);
		if (!el || !target) return `${!el ? op.id : op.moveTo} not found`;
		el.remove();
		target.insertAdjacentElement(op.position || "afterend", el);
		return `moved ${op.id} → ${op.position || "afterend"} ${op.moveTo}`;
	}
	if (op.insert) {
		const results: string[] = [];
		if (el) {
			const pos = op.position || "beforeend";
			el.insertAdjacentHTML(pos, op.insert);
			if (charteCheckHtml(charte, op.insert, op.id, null, root, results))
				return results[0] ?? "";
			return `inserted ${pos} ${op.id}`;
		}
		root.insertAdjacentHTML("beforeend", op.insert);
		if (charteCheckHtml(charte, op.insert, "root", null, root, results))
			return results[0] ?? "";
		return "inserted at page root";
	}
	if (op.style || op.content !== undefined || op.attr) {
		if (!el) return `${op.id} not found`;
		const saved = el.outerHTML;
		if (op.style) {
			const existing = el.getAttribute("style") || "";
			const styleStr = Object.entries(op.style)
				.map(([k, v]) => `${k.includes("-") ? k : camelToKebab(k)}:${v}`)
				.join(";");
			el.setAttribute("style", mergeStyles(existing, styleStr));
		}
		if (op.attr) {
			for (const [k, v] of Object.entries(op.attr))
				el.setAttribute(k, String(v));
		}
		if (op.content !== undefined) el.innerHTML = op.content;
		const results: string[] = [];
		if (charteCheckEl(charte, el, saved, op.id, results))
			return results[0] ?? "";
		return `updated ${op.id} → ${el.outerHTML}`;
	}
	return `${op.id}: nothing to do`;
}

// ============================================================
// Schema + tool
// ============================================================

const ActionSchema = z.enum(["set", "patch", "get", "check"]);

const MaketHtmlSchema = z.object({
	action: ActionSchema.describe(
		"Operation to run. See the tool description for the action table.",
	),
	doc: z.string().describe("Document name (always required)."),
	page: z.coerce.number().describe("Page number, 1-based (always required)."),
	html: z
		.string()
		.optional()
		.describe(
			'For set: full page HTML. Every visible element MUST carry a data-id. Use flex/grid with mm units; images use relative filenames (src="photo.jpg"); colours/fonts come from var(--charte-*). Example: <div data-id="page" style="width:210mm;height:297mm;display:flex;flex-direction:column;padding:15mm"><h1 data-id="title">Hello</h1></div>.',
		),
	context_token: z
		.string()
		.optional()
		.describe(
			"For set: charte context token from maket_charte view. REQUIRED when the document has a charte — proof the brand guidelines were read first.",
		),
	ops: z
		.array(PatchOpSchema)
		.optional()
		.describe(
			'For patch: list of surgical ops by data-id. Each op has `id` plus one of: style (object), content (string), attr (object), insert (html) + optional position, replace (outerHTML), remove (true), clone (newId), moveTo (targetId) + optional position. To exclude one intentional non-interactive leaf decoration with no child elements or text from layout validation, patch that existing element with attr: {"data-maket-layout":"ignore"}; controls, links, data-maket-bind and focusable/ARIA elements are ineligible. This override is rejected in set/insert/replace/content HTML, and its enabling op must be the only op in the patch request.',
		),
	format: z
		.enum(["html", "text"])
		.optional()
		.describe(
			"For get: 'html' (default, full markup) or 'text' (tags stripped).",
		),
	id: z
		.string()
		.optional()
		.describe(
			"For get: data-id of a single element to return; omit to fetch the whole page.",
		),
});

const DESCRIPTION = [
	"When to use: read and write page HTML. Pick set for the initial skeleton, patch for iterative edits, get to read, check to measure overflow without writing.",
	"",
	"Every visible element MUST have a data-id. Use flex/grid with mm units. When a charte is loaded, prefer var(--charte-*) tokens. The compliance check is narrow: it rejects (1) hardcoded colour literals that duplicate an existing charte token value (e.g. #2563EB when primary=#2563EB), (2) any hardcoded font-family when the charte defines fonts, (3) any hardcoded box-shadow when the charte defines shadows. Fresh colours that don't duplicate a token pass untouched.",
	'Layout override: data-maket-layout="ignore" excludes exactly one marked non-interactive leaf block from overflow, overlap, clipping, and margin checks. The block must have no child elements or text; controls, links, data-maket-bind and focusable/ARIA elements are ineligible. Reserve it for intentional non-content decoration after visual review. Add it only with maket_html action=patch using attr on an existing data-id; the enabling op must be the only op in that patch request. Set, insert, replace, and content HTML cannot introduce it.',
	'For a state-backed document, Mustache is display-only. The document must author editable controls and all their CSS explicitly: data-maket-bind supports <input type="checkbox"> for booleans, <input type="text"> and <textarea> for strings, <select> for string enums (or for a string whose options come from a state list with data-maket-options="state.list"), and <button type="button"> for the single-value editor; a bound button with data-maket-value="<value>" (optionally data-maket-action="set") writes that value on click instead. Use state.foo at the root and relative foo inside state sections; never persist data-maket-path or other runtime attributes.',
	"  set   — REPLACE the full page HTML. Rejects the whole payload on any violation. Requires context_token when the doc has a charte.",
	"  patch — apply ops by data-id: style/content/attr/insert/replace/remove/clone/moveTo. Violating ops roll back individually, the rest still apply.",
	"  get   — return current HTML; pass id=<data-id> for a single element, format=text to strip tags.",
	"  check — measure layout against the canvas + declared `canvas.margins`, and report page links that target a missing page; no side effects. The page is measured as readers see it: a state-backed page hydrated with the current document state (a JSON Forms page on its rendered form), a collection page with the member its preview cursor shows (first member otherwise), a Structured Workspace collection document with its items; a list that flows onto continuation pages is measured page by page; other pages as authored. The report's first line names what was measured. set and patch measure the same way. Returns a Markdown measurement report with physical canvas and content extents, root geometry, problematic addressable blocks, parent/canvas excess per side, clipping, and overlap pairs. Status: ✓ OK, ⚠ tight (block crosses a declared margin band — tighten or move into the safe zone before shipping), ⛔ overflow (block escapes the canvas, not shippable; pairwise overlaps between `[data-id]` blocks are reported under this same status), or ⛔ unchecked when headless validation could not run. On tight/overflow, the `next:` block points to a snapshot + targeted patch; unchecked is diagnostic-only to avoid blind retry loops.",
	'Page links: <a href="#page=3"> (canonical, 1-based page number) or <a href="#page:Exact page name"> navigates to that page of the same document in Canvas, Reader and viewer, and becomes an internal link in print and PDF. In the authoring Canvas a plain click selects the link for editing; ⌘-click (Ctrl-click elsewhere) follows it. The href is a literal: set and patch refuse Mustache in a page link.',
].join("\n");

export function createMaketHtmlTool(deps: HtmlDeps): ToolHandler {
	const {
		documents,
		store,
		layout,
		assets,
		documentRenderer,
		collectionCursors,
	} = deps;
	return {
		metadata: {
			name: "maket_html",
			description: DESCRIPTION,
			schema: MaketHtmlSchema,
		},
		handler: (rawArgs) =>
			handleMaketHtmlTool(rawArgs, {
				documents,
				store,
				layout,
				assets,
				rendering: { documentRenderer, collectionCursors },
			}),
	};
}

type Args = z.infer<typeof MaketHtmlSchema>;

type PageRendering = Pick<HtmlDeps, "documentRenderer" | "collectionCursors">;

interface MaketHtmlToolDeps {
	documents: Documents;
	store: Store;
	layout: LayoutService;
	assets: AssetsService;
	rendering: PageRendering;
}

interface MeasuredPage {
	html: string;
	/** Names the data the page was rendered with; absent for an authored page. */
	note?: string;
}

interface MeasuredLayout {
	report: string;
	/** The first result that is not ok, or the only one. */
	result: LayoutResult;
}

/**
 * The page HTML a reader sees: hydrated with the document state, or with the
 * collection member shown by the page's preview cursor (first member when the
 * cursor shows the template or every member). Other pages stay as authored.
 * A state page whose list flows yields every page it renders to.
 */
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Measurement adapter: selects the rendered page through the renderer and cursor services that own rendering.
async function measuredPages(
	doc: Document,
	page: Page,
	rendering: PageRendering,
): Promise<MeasuredPage[]> {
	const authored = {
		html: page.html ?? "",
		note: "Measured the authored HTML: the page has no document state or collection.",
	};
	try {
		const ownership = doc.meta.structuredWorkspace;
		if (ownership?.role === "collection") {
			return flowedMeasuredPages(
				page,
				await rendering.documentRenderer.renderSettled(doc),
				`Measured with the items of Structured Workspace collection "${ownership.collectionId}".`,
			);
		}
		if (doc.dataModel === "state") {
			const revision = rendering.documentRenderer.stateView(doc)?.revision;
			return flowedMeasuredPages(
				page,
				await rendering.documentRenderer.renderSettled(doc),
				`Measured with document state revision ${revision ?? "?"}${page.jsonForms ? ", JSON Forms rendered" : ""}.`,
			);
		}
		const collection = page.collection?.name;
		if (!collection) return [authored];
		return [collectionMeasuredPage(doc, page, collection, rendering)];
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return [
			{
				html: authored.html,
				note: `Measured the authored template: rendering failed (${message}).`,
			},
		];
	}
}

/** The rendered pages of one authored page, several when a list flows. */
function flowedMeasuredPages(
	page: Page,
	rendered: Document,
	note: string,
): MeasuredPage[] {
	const pages = rendered.pages.filter(
		(candidate) => flowSourcePageId(candidate) === page.id,
	);
	if (pages.length <= 1) {
		return [{ html: pages[0]?.html ?? page.html ?? "", note }];
	}
	return pages.map((candidate, index) => ({
		html: candidate.html ?? "",
		note: `${index === 0 ? `${note} A list flows onto ${pages.length} pages.\n` : ""}Page ${index + 1} of ${pages.length} (${candidate.name ?? candidate.id}):`,
	}));
}

/** Rank of a layout status: the most severe page of a flowed set decides. */
const LAYOUT_SEVERITY: Record<LayoutResult["status"], number> = {
	ok: 0,
	tight: 1,
	overflow: 2,
	unchecked: 3,
};

async function measureLayout(
	doc: Document,
	page: Page,
	pageIdx: number,
	deps: Pick<MaketHtmlToolDeps, "layout" | "rendering">,
	mode: "measure" | "check",
): Promise<MeasuredLayout> {
	const measured = await measuredPages(doc, page, deps.rendering);
	const reports: string[] = [];
	let worst: LayoutResult | undefined;
	for (const [index, candidate] of measured.entries()) {
		const result =
			mode === "measure" && index === 0
				? await deps.layout.measure(doc, candidate.html, pageIdx)
				: await deps.layout.check(doc, candidate.html, pageIdx);
		reports.push(layoutReport(candidate, result));
		if (
			!worst ||
			LAYOUT_SEVERITY[result.status] > LAYOUT_SEVERITY[worst.status]
		) {
			worst = result;
		}
	}
	return {
		report: reports.join("\n"),
		result: worst ?? {
			status: "unchecked",
			text: "",
			overflowIds: [],
			overlapIds: [],
		},
	};
}

function collectionMeasuredPage(
	doc: Document,
	page: Page,
	collection: string,
	rendering: PageRendering,
): MeasuredPage {
	const options = cursorRenderOptions(doc, (docName, pageIndex) =>
		rendering.collectionCursors.resolve(docName, pageIndex),
	);
	const cursor = options.pages?.[page.id];
	options.pages = {
		...options.pages,
		[page.id]: cursor?.mode === "rendered" ? cursor : { mode: "all" },
	};
	const prefix = `${page.id}:${collection}:`;
	const renderPage = (source: Document) =>
		rendering.documentRenderer
			.render(source, { collection: options })
			.pages.find((candidate) => candidate.id.startsWith(prefix));
	let rendered: Page | undefined;
	try {
		rendered = renderPage(doc);
	} catch {
		rendered = renderPage(withOnlyCollectionPage(doc, page.id));
	}
	if (!rendered) {
		return {
			html: page.html ?? "",
			note: `Measured the authored template: collection "${collection}" has no member.`,
		};
	}
	return {
		html: rendered.html ?? page.html ?? "",
		note: `Measured with collection "${collection}" member "${rendered.id.slice(prefix.length)}".`,
	};
}

/** The document with every other collection page left as authored, so a
 * failure on another page cannot stand for this page's rendering. */
function withOnlyCollectionPage(doc: Document, pageId: string): Document {
	return {
		...doc,
		pages: doc.pages.map((candidate) =>
			candidate.id === pageId || !candidate.collection
				? candidate
				: { ...candidate, collection: undefined },
		),
	};
}

function layoutReport(measured: MeasuredPage, layoutResult: LayoutResult) {
	return [measured.note, layoutResult.text.trim()].filter(Boolean).join("\n");
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP handlers are adapter boundaries: this one resolves the document/page contract and delegates HTML actions to the owning services.
async function handleMaketHtmlTool(rawArgs: unknown, deps: MaketHtmlToolDeps) {
	const args = MaketHtmlSchema.parse(rawArgs);
	const resolved = resolveDocPage(deps.documents, args.doc, args.page);
	if (typeof resolved === "string") return text(resolved, true);
	const { doc, page, pageIdx } = resolved;

	switch (args.action) {
		case "set": {
			const locked = lockGuard(doc);
			if (locked) return locked;
			const controlled = templatePageGuard(doc, page);
			if (controlled) return controlled;
			return runSet({ args, doc, page, pageIdx, ...deps });
		}
		case "patch": {
			const locked = lockGuard(doc);
			if (locked) return locked;
			const controlled = templatePageGuard(doc, page);
			if (controlled) return controlled;
			return runPatch(args, { doc, page, pageIdx, ...deps });
		}
		case "get":
			return runGet(args, page);
		case "check":
			return runCheck(doc, page, pageIdx, deps);
	}
}

interface HtmlSetContext extends MaketHtmlToolDeps {
	args: Args;
	doc: Document;
	page: Page;
	pageIdx: number;
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP tool action `runSet`: edge adapter over services/store/bus, not domain ownership.
async function runSet(context: HtmlSetContext): Promise<CallToolResult> {
	const {
		args,
		doc,
		page,
		pageIdx,
		documents,
		store,
		layout,
		assets,
		rendering,
	} = context;
	if (args.html == null) return text("html is required for action=set", true);
	if (containsLayoutControlAttribute(args.html)) {
		return text(
			`${LAYOUT_CONTROL_ATTRIBUTE} is not allowed in action=set. ${LAYOUT_IGNORE_PATCH_GUIDANCE}`,
			true,
		);
	}

	if (doc.meta?.charte) {
		const charte = store.loadCharte(doc.meta.charte);
		const current = assets.charteToken(charte);
		const check = validateCharteToken(
			doc.meta.charte,
			args.context_token,
			current,
		);
		if (!check.valid) return text(check.reason || "Invalid token", true);
		if (charte) {
			const violations = checkCharteCompliance(args.html, charte);
			if (violations.length > 0)
				return text(formatViolations(violations), true);
		}
	}

	const nextHtml = stripActiveHtml(normalizeImageSrc(args.html));
	const pageLinkError = templatedPageLinkError(nextHtml);
	if (pageLinkError) return text(pageLinkError, true);
	const stateTemplateError = stateTemplateValidationError(doc, store, {
		...page,
		html: nextHtml,
		jsonForms: undefined,
	});
	if (stateTemplateError) return text(stateTemplateError, true);
	page.html = nextHtml;
	page.jsonForms = undefined;
	documents.persist(doc.name);

	const count = (page.html.match(/data-id=/g) || []).length;
	const html = page.html || "";
	const measured = await measureLayout(
		doc,
		page,
		pageIdx,
		{ layout, rendering },
		"measure",
	);
	const layoutResult = measured.result;
	const tree = buildIdTree(html);

	return text(
		[
			`Page "${page.name || args.page}" updated — ${count} elements`,
			"",
			"layout:",
			measured.report,
			"",
			"tree:",
			tree,
			"",
			"Tip: use maket_html patch to refine by data-id (style, content, insert, replace, remove).",
		].join("\n"),
		{ next: layoutNextHints(layoutResult, doc.name, args.page) },
	);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP patch orchestration intentionally coordinates DOM, state validation,
// persistence, and layout at this adapter boundary.
async function runPatch(
	args: Args,
	context: Omit<HtmlSetContext, "args">,
): Promise<CallToolResult> {
	const { doc, page, pageIdx, documents, store, layout, rendering } = context;
	if (!args.ops) return text("ops is required for action=patch", true);
	if (page.jsonForms) {
		return text(
			"This page uses JSON Forms. Use maket_page action=set_form to replace its form definition, or maket_html action=set to switch it back to HTML.",
			true,
		);
	}
	if (!page.html) page.html = "";
	if (args.ops.some(hasLayoutControlAttr) && args.ops.length !== 1) {
		return text(
			`${LAYOUT_IGNORE_PATCH_GUIDANCE} The enabling op must be the only op in the patch request.`,
			true,
		);
	}

	const { document: dom } = parseHTML(`<html><body>${page.html}</body></html>`);
	const root = dom.body as unknown as DomEl;
	const charte = doc.meta?.charte ? store.loadCharte(doc.meta.charte) : null;

	const results = args.ops.map((op) => applyOp(op, root, charte));

	const nextHtml = stripActiveHtml(normalizeImageSrc(root.innerHTML));
	const pageLinkError = templatedPageLinkError(nextHtml);
	if (pageLinkError) return text(pageLinkError, true);
	const stateTemplateError = stateTemplateValidationError(doc, store, {
		...page,
		html: nextHtml,
	});
	if (stateTemplateError) return text(stateTemplateError, true);
	page.html = nextHtml;
	documents.persist(doc.name);

	const measured = await measureLayout(
		doc,
		page,
		pageIdx,
		{ layout, rendering },
		"measure",
	);
	const layoutResult = measured.result;
	const tree = buildIdTree(root);
	return text(
		[
			"ops:",
			results.join("\n"),
			"",
			"layout:",
			measured.report,
			"",
			"tree:",
			tree,
		].join("\n"),
		{ next: layoutNextHints(layoutResult, doc.name, args.page) },
	);
}

function stateTemplateValidationError(
	doc: Document,
	store: Store,
	page: Page,
): string | null {
	try {
		validateStateTemplateUpdate(doc, store, page);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

function runGet(args: Args, page: Page): CallToolResult {
	const html = page.html || "";

	if (args.id) {
		const { document: dom } = parseHTML(`<html><body>${html}</body></html>`);
		const el = dom.body.querySelector(`[data-id="${cssEscape(args.id)}"]`);
		if (!el) return text(`Element "${args.id}" not found`, true);
		return text(el.outerHTML);
	}

	if (args.format === "text") {
		const out = html
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		return text(out || "(empty page)");
	}
	return text(html || "<!-- empty page -->");
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MCP tool action `runCheck`: edge adapter over layout measurement and page-link validation.
async function runCheck(
	doc: Document,
	page: Page,
	pageIdx: number,
	{ layout, rendering }: MaketHtmlToolDeps,
): Promise<CallToolResult> {
	const renderedForm = Boolean(page.jsonForms) && doc.dataModel === "state";
	if (!page.html && !renderedForm)
		return text("No HTML content on this page", true);
	const measured = await measureLayout(
		doc,
		page,
		pageIdx,
		{ layout, rendering },
		"check",
	);
	const layoutResult = measured.result;
	const linkIssues = page.html ? brokenPageLinks(page.html, doc.pages) : [];
	const report = [measured.report];
	if (linkIssues.length > 0) {
		report.push("", formatPageLinkIssues(linkIssues, doc.pages.length));
	}
	const layoutHints = layoutNextHints(layoutResult, doc.name, pageIdx + 1);
	const linkHint =
		linkIssues.length > 0
			? [
					`maket_html action=patch doc=${doc.name} page=${pageIdx + 1} ops=[...]  # fix page links: ${linkIssues.map((issue) => issue.elementId ?? issue.href).join(", ")}`,
				]
			: [];
	const next = [...(layoutHints ?? []), ...linkHint];
	return text(report.join("\n"), {
		next: next.length > 0 ? next : undefined,
	});
}

export const htmlPack: ToolPack = {
	id: "html",
	name: "Html",
	requires: [
		"documents",
		"store",
		"layout",
		"assets",
		"documentRenderer",
		"collectionCursors",
	],
	declaresTools: ["maket_html"],
	register(container) {
		container.register({
			maketHtmlTool: asFunction(createMaketHtmlTool).singleton(),
		});
	},
};
