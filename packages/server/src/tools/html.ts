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

import { asFunction } from "awilix";
import { parseHTML } from "linkedom";
import { z } from "zod";
import type { ToolHandler, ToolResult } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import { checkCharteCompliance } from "../lib/charte-check.js";
import { stripActiveHtml } from "../lib/strip-active-html.js";
import type { AssetsService } from "../services/assets.js";
import { validateCharteToken } from "../services/assets.js";
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

function applyOp(op: PatchOp, root: DomEl, charte: Charte | null): string {
	const el = root.querySelector(`[data-id="${cssEscape(op.id)}"]`);

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
			"For patch: list of surgical ops by data-id. Each op has `id` plus one of: style (object), content (string), attr (object), insert (html) + optional position, replace (outerHTML), remove (true), clone (newId), moveTo (targetId) + optional position.",
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
	"  set   — REPLACE the full page HTML. Rejects the whole payload on any violation. Requires context_token when the doc has a charte.",
	"  patch — apply ops by data-id: style/content/attr/insert/replace/remove/clone/moveTo. Violating ops roll back individually, the rest still apply.",
	"  get   — return current HTML; pass id=<data-id> for a single element, format=text to strip tags.",
	"  check — measure layout against the canvas + declared `canvas.margins`; no side effects. Status: ✓ OK, ⚠ tight (block crosses a declared margin band — tighten or move into the safe zone before shipping), ⛔ overflow (block escapes the canvas, not shippable; pairwise overlaps between `[data-id]` blocks are reported under this same status). On tight/overflow, the `next:` block points to a snapshot + targeted patch.",
].join("\n");

export function createMaketHtmlTool(deps: HtmlDeps): ToolHandler {
	const { documents, store, layout, assets } = deps;
	return {
		metadata: {
			name: "maket_html",
			description: DESCRIPTION,
			schema: MaketHtmlSchema,
		},
		handler: async (rawArgs) => {
			const args = MaketHtmlSchema.parse(rawArgs);
			const resolved = resolveDocPage(documents, args.doc, args.page);
			if (typeof resolved === "string") return text(resolved, true);
			const { doc, page, pageIdx } = resolved;

			switch (args.action) {
				case "set": {
					const locked = lockGuard(doc);
					if (locked) return locked;
					return runSet(
						args,
						doc,
						page,
						pageIdx,
						documents,
						store,
						layout,
						assets,
					);
				}
				case "patch": {
					const locked = lockGuard(doc);
					if (locked) return locked;
					return runPatch(args, doc, page, pageIdx, documents, store, layout);
				}
				case "get":
					return runGet(args, page);
				case "check":
					return runCheck(doc, page, pageIdx, layout);
			}
		},
	};
}

type Args = z.infer<typeof MaketHtmlSchema>;

async function runSet(
	args: Args,
	doc: Document,
	page: Page,
	pageIdx: number,
	documents: Documents,
	store: Store,
	layout: LayoutService,
	assets: AssetsService,
): Promise<ToolResult> {
	if (args.html == null) return text("html is required for action=set", true);

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

	page.html = stripActiveHtml(normalizeImageSrc(args.html));
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

async function runPatch(
	args: Args,
	doc: Document,
	page: Page,
	pageIdx: number,
	documents: Documents,
	store: Store,
	layout: LayoutService,
): Promise<ToolResult> {
	if (!args.ops) return text("ops is required for action=patch", true);
	if (!page.html) page.html = "";

	const { document: dom } = parseHTML(`<html><body>${page.html}</body></html>`);
	const root = dom.body as unknown as DomEl;
	const charte = doc.meta?.charte ? store.loadCharte(doc.meta.charte) : null;

	const results = args.ops.map((op) => applyOp(op, root, charte));

	page.html = stripActiveHtml(normalizeImageSrc(root.innerHTML));
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

function runGet(args: Args, page: Page): ToolResult {
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
): Promise<ToolResult> {
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
