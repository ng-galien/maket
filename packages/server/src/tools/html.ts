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
 * Deps: `documents`, `store` (charte reads), `layout` (WS broadcast +
 * measurement), `assets` (charteToken / validateCharteToken).
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import { asFunction } from "awilix";
import { parseHTML } from "linkedom";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import { checkCharteCompliance } from "../lib/charte-check.js";
import { stripActiveHtml } from "../lib/strip-active-html.js";
import type { AssetsService } from "../services/assets.js";
import { validateCharteToken } from "../services/assets.js";
import { validateStateTemplateUpdate } from "../services/document-states.js";
import type { Documents } from "../services/documents.js";
import type { LayoutResult, LayoutService } from "../services/layout.js";
import type { Store } from "../services/store.js";
import type { Charte, Document, Page } from "../types.js";
import { lockGuard, text } from "./_helpers.js";

export interface HtmlDeps {
	documents: Documents;
	store: Store;
	layout: LayoutService;
	assets: AssetsService;
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

// code-moniker: ignore[smell-feature-envy-local]
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

// code-moniker: ignore[smell-feature-envy-local]
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
	'For a state-backed document, Mustache is display-only. The document must author editable controls and all their CSS explicitly: data-maket-bind supports <input type="checkbox"> for booleans, <input type="text"> for strings, <select> for string enums, and <button type="button"> for the single-value editor. Use state.foo at the root and relative foo inside state sections; never persist data-maket-path or other runtime attributes.',
	"  set   — REPLACE the full page HTML. Rejects the whole payload on any violation. Requires context_token when the doc has a charte.",
	"  patch — apply ops by data-id: style/content/attr/insert/replace/remove/clone/moveTo. Violating ops roll back individually, the rest still apply.",
	"  get   — return current HTML; pass id=<data-id> for a single element, format=text to strip tags.",
	"  check — measure layout against the canvas + declared `canvas.margins`; no side effects. Status: ✓ OK, ⚠ tight (block crosses a declared margin band — tighten or move into the safe zone before shipping), ⛔ overflow (block escapes the canvas, not shippable; pairwise overlaps between `[data-id]` blocks are reported under this same status), or ⛔ unchecked when headless validation could not run. On tight/overflow, the `next:` block points to a snapshot + targeted patch; unchecked is diagnostic-only to avoid blind retry loops.",
].join("\n");

export function createMaketHtmlTool(deps: HtmlDeps): ToolHandler {
	const { documents, store, layout, assets } = deps;
	return {
		metadata: {
			name: "maket_html",
			description: DESCRIPTION,
			schema: MaketHtmlSchema,
		},
		handler: (rawArgs) =>
			handleMaketHtmlTool(rawArgs, { documents, store, layout, assets }),
	};
}

type Args = z.infer<typeof MaketHtmlSchema>;

interface MaketHtmlToolDeps {
	documents: Documents;
	store: Store;
	layout: LayoutService;
	assets: AssetsService;
}

// code-moniker: ignore[smell-feature-envy-local]
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
			return runSet({ args, doc, page, pageIdx, ...deps });
		}
		case "patch": {
			const locked = lockGuard(doc);
			if (locked) return locked;
			return runPatch(
				args,
				doc,
				page,
				pageIdx,
				deps.documents,
				deps.store,
				deps.layout,
			);
		}
		case "get":
			return runGet(args, page);
		case "check":
			return runCheck(doc, page, pageIdx, deps.layout);
	}
}

interface HtmlSetContext {
	args: Args;
	doc: Document;
	page: Page;
	pageIdx: number;
	documents: Documents;
	store: Store;
	layout: LayoutService;
	assets: AssetsService;
}

// code-moniker: ignore[smell-feature-envy-local]
// MCP tool action `runSet`: edge adapter over services/store/bus, not domain ownership.
async function runSet(context: HtmlSetContext): Promise<CallToolResult> {
	const { args, doc, page, pageIdx, documents, store, layout, assets } =
		context;
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
	const stateTemplateError = stateTemplateValidationError(doc, store, nextHtml);
	if (stateTemplateError) return text(stateTemplateError, true);
	page.html = nextHtml;
	documents.persist(doc.name);

	const count = (page.html.match(/data-id=/g) || []).length;
	const html = page.html || "";
	const layoutResult = await layout.measure(doc, html, pageIdx);
	const tree = buildIdTree(html);

	return text(
		[
			`Page "${page.name || args.page}" updated — ${count} elements`,
			"",
			"layout:",
			layoutResult.text.trim(),
			"",
			"tree:",
			tree,
			"",
			"Tip: use maket_html patch to refine by data-id (style, content, insert, replace, remove).",
		].join("\n"),
		{ next: layoutNextHints(layoutResult, doc.name, args.page) },
	);
}

// code-moniker: ignore[smell-feature-envy-local]
// MCP patch orchestration intentionally coordinates DOM, state validation,
// persistence, and layout at this adapter boundary.
async function runPatch(
	args: Args,
	doc: Document,
	page: Page,
	pageIdx: number,
	documents: Documents,
	store: Store,
	layout: LayoutService,
): Promise<CallToolResult> {
	if (!args.ops) return text("ops is required for action=patch", true);
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
	const stateTemplateError = stateTemplateValidationError(doc, store, nextHtml);
	if (stateTemplateError) return text(stateTemplateError, true);
	page.html = nextHtml;
	documents.persist(doc.name);

	const layoutResult = await layout.measure(doc, page.html || "", pageIdx);
	const tree = buildIdTree(root);
	return text(
		[
			"ops:",
			results.join("\n"),
			"",
			"layout:",
			layoutResult.text.trim(),
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
	html: string,
): string | null {
	try {
		validateStateTemplateUpdate(doc, store, html);
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

async function runCheck(
	doc: Document,
	page: Page,
	pageIdx: number,
	layout: LayoutService,
): Promise<CallToolResult> {
	if (!page.html) return text("No HTML content on this page", true);
	const layoutResult = await layout.check(doc, page.html, pageIdx);
	return text(layoutResult.text.trim(), {
		next: layoutNextHints(layoutResult, doc.name, pageIdx + 1),
	});
}

export const htmlPack: ToolPack = {
	id: "html",
	name: "Html",
	requires: ["documents", "store", "layout", "assets"],
	declaresTools: ["maket_html"],
	register(container) {
		container.register({
			maketHtmlTool: asFunction(createMaketHtmlTool).singleton(),
		});
	},
};
