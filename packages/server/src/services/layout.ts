/**
 * layout — layout measurement service for HTML mutations.
 *
 * Two entry points:
 *
 * - `measure(doc, html, pageIdx)` — used by `set_html` / `patch_html`. First
 *   emits `document:saved` so index listeners refresh live previews, then
 *   returns a canvas-authoritative layout summary (mm-math walker, with a
 *   headless Chromium fallback for content-driven overflow).
 *
 * - `check(doc, html, pageIdx)` — used by `check_layout`. Same measurement
 *   path as `measure` but without the preview emit, and the result is
 *   trimmed (no leading newline).
 *
 * Browser-side measurement was removed because it reported the preview
 * container rather than the canvas and produced phantom overflow. The server
 * now reports only canvas-authoritative numbers.
 */

import { parseHTML } from "linkedom";
import type { Browser } from "puppeteer";
import { parseStyle } from "../lib/charte-check.js";
import { escapeCssValue, stripStyleClose } from "../lib/css-escape.js";
import { installNetworkGuard } from "../lib/page-network-guard.js";
import {
	PAGE_BLOCK_SELECTOR,
	waitForPageStable,
} from "../lib/page-stable-wait.js";
import type { Document } from "../types.js";
import type { BrowserPool, RenderBrowser, RenderPage } from "./browser-pool.js";
import type { Bus } from "./bus.js";
import type { Documents } from "./documents.js";

/** px per mm at 96 DPI — matches the viewport puppeteer renders into. */
const PX_PER_MM = 96 / 25.4;
const DEFAULT_HEADLESS_TIMEOUT_MS = 15_000;
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
const LAYOUT_INTERACTIVE_ATTRIBUTES = [
	"contenteditable",
	"data-maket-bind",
	"href",
	"role",
	"tabindex",
] as const;

export interface LayoutResult {
	status: "ok" | "tight" | "overflow" | "unchecked";
	/** Newline-prefixed for direct concatenation; check runner trims. */
	text: string;
	/** Block ids that escape the canvas. */
	overflowIds: string[];
	/** Block ids involved in any pairwise intersection (flat unique list). */
	overlapIds: string[];
	/** Block ids that cross a declared margin band (flat unique list). */
	tightIds?: string[];
	/** Raw Chromium geometry behind the human-readable measurement report. */
	measurements?: LayoutReport;
}

export interface LayoutService {
	/** Emits document:saved for live preview, then measures. */
	measure(
		doc: Document,
		pageHtml: string,
		pageIdx: number,
	): Promise<LayoutResult>;
	check(
		doc: Document,
		pageHtml: string,
		pageIdx: number,
	): Promise<LayoutResult>;
}

export interface LayoutServiceDeps {
	bus: Bus;
	documents: Documents;
	browserPool: BrowserPool;
}

export interface LayoutServiceOptions {
	/** Override the shared browser pool in focused tests. */
	browserLaunch?: () => Promise<Browser>;
	/** Override for the base URL used to rewrite relative `/assets/…` paths. */
	getAssetBaseUrl?: () => string;
	/** Max time spent in headless validation before returning unchecked. */
	headlessTimeoutMs?: number;
}

type HeadlessCheckResult =
	| { ok: true; report: LayoutReport }
	| { ok: false; error: string };

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return String(error || "Unknown headless layout error");
}

/**
 * Options live in a second argument on purpose: Awilix PROXY mode triggers a
 * container lookup for every destructured name on the deps object, so putting
 * optional test overrides there would require registering `undefined` for
 * them at the container level.
 */

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Headless layout path coordinates browser, network guard, and DOM measure.
async function runHeadlessLayoutCheck(ctx: {
	doc: Document;
	pageHtml: string;
	documents: Documents;
	getBrowser: () => Promise<RenderBrowser>;
	getAssetBaseUrl: () => string;
	timeoutMs: number;
}): Promise<HeadlessCheckResult> {
	const { doc, pageHtml, documents, getBrowser, getAssetBaseUrl, timeoutMs } =
		ctx;
	let page: RenderPage | undefined;
	let expired = false;
	let succeeded = false;
	let closePromise: Promise<void> | undefined;
	const closePage = () => {
		if (!page) return Promise.resolve();
		closePromise ??= page.close().catch(() => {});
		return closePromise;
	};
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			expired = true;
			void closePage();
			reject(new Error(`Headless layout timed out after ${timeoutMs}ms`));
		}, timeoutMs);
	});

	try {
		const report = await Promise.race([
			(async () => {
				const browser = await getBrowser();
				if (expired) throw new Error("Headless layout timed out");
				page = await browser.newPage();
				if (expired) {
					await closePage();
					throw new Error("Headless layout timed out");
				}
				const { w, h, bg } = doc.canvas;
				const charteCss = documents.charteCss(doc);
				const html = pageHtml.replaceAll(
					"/assets/",
					`${getAssetBaseUrl()}/assets/`,
				);
				const safeBg = escapeCssValue(bg || "#ffffff");
				const safeCharteCss = stripStyleClose(charteCss);
				const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
${safeCharteCss}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { margin: 0; padding: 0; width: ${w}mm; height: ${h}mm; overflow: hidden; background: ${safeBg}; }
</style>
</head>
<body>${html}</body>
</html>`;
				await installNetworkGuard(page, "localhost-only");
				await page.setViewport({
					width: Math.ceil(w * PX_PER_MM),
					height: Math.ceil(h * PX_PER_MM),
				});
				await page.setContent(fullHtml, { waitUntil: "load" });
				await waitForPageStable(page);
				const m = doc.canvas.margins;
				const marginsPx = m
					? {
							top: m.top * PX_PER_MM,
							right: m.right * PX_PER_MM,
							bottom: m.bottom * PX_PER_MM,
							left: m.left * PX_PER_MM,
						}
					: null;
				return (await page.evaluate(
					measureInBrowser,
					PAGE_BLOCK_SELECTOR,
					marginsPx,
				)) as LayoutReport | null;
			})(),
			timeout,
		]);
		if (!report) return { ok: false, error: "No page root found" };
		succeeded = true;
		return { ok: true, report };
	} catch (error) {
		return { ok: false, error: errorMessage(error) };
	} finally {
		if (timer) clearTimeout(timer);
		if (expired || !succeeded) void closePage();
		else await closePage();
	}
}

export function createLayoutService(
	deps: LayoutServiceDeps,
	opts: LayoutServiceOptions = {},
): LayoutService {
	const { bus, documents, browserPool } = deps;
	const getAssetBaseUrl =
		opts.getAssetBaseUrl ??
		(() => `http://localhost:${process.env.MAKET_PORT || "3333"}`);
	const getBrowser = opts.browserLaunch
		? async () => (await opts.browserLaunch?.()) as unknown as RenderBrowser
		: () => browserPool.get();
	const headlessTimeoutMs =
		opts.headlessTimeoutMs ?? DEFAULT_HEADLESS_TIMEOUT_MS;

	async function headlessCheck(
		doc: Document,
		pageHtml: string,
	): Promise<HeadlessCheckResult> {
		return runHeadlessLayoutCheck({
			doc,
			pageHtml,
			documents,
			getBrowser,
			getAssetBaseUrl,
			timeoutMs: headlessTimeoutMs,
		});
	}

	async function runMeasure(
		doc: Document,
		pageHtml: string,
		detailed = false,
	): Promise<LayoutResult> {
		const serverResult = serverLayoutCheck(pageHtml, doc.canvas);
		if (serverResult.status === "overflow" && !detailed) return serverResult;
		const headless = await headlessCheck(doc, pageHtml);
		if (headless.ok) return formatLayoutReport(headless.report, doc.canvas);
		if (serverResult.status === "ok") {
			return {
				status: "unchecked",
				text: `\n⛔ Layout check unavailable — not shippable until headless validation runs.\n  ${headless.error}`,
				overflowIds: [],
				overlapIds: [],
			};
		}
		return {
			...serverResult,
			text: `${serverResult.text}\n⛔ Full layout check unavailable: ${headless.error}`,
		};
	}

	return {
		async measure(doc, pageHtml, _pageIdx) {
			bus.emit("document:saved", { docName: doc.name });
			return runMeasure(doc, pageHtml);
		},
		async check(doc, pageHtml, _pageIdx) {
			return runMeasure(doc, pageHtml, true);
		},
	};
}

// ============================================================
// Pure helpers (exported for tests)
// ============================================================

export interface LayoutReport {
	overflow?: boolean;
	containerHeight?: number;
	contentHeight?: number;
	overflowBy?: number;
	containerWidth?: number;
	contentWidth?: number;
	overflowByW?: number;
	overflowing?: string[];
	/** Block ids whose text exceeds a constrained visible box. */
	clipped?: string[];
	/**
	 * Pairs of [data-id] block ids whose AABBs intersect. Skips ancestor /
	 * descendant relations (a block "overlapping" its own contents is by
	 * design). Empty when no pair intersects.
	 */
	overlaps?: [string, string][];
	/**
	 * Block ids that cross into a margin band (per side). Populated only when
	 * the canvas declares `margins`; otherwise all sides are empty.
	 */
	tight?: {
		top: string[];
		right: string[];
		bottom: string[];
		left: string[];
	};
	root?: {
		id?: string;
		left: number;
		top: number;
		width: number;
		height: number;
	};
	elements?: {
		id?: string;
		name?: string;
		parentId?: string;
		left?: number;
		top?: number;
		width?: number;
		height?: number;
		canvasExcess?: {
			top: number;
			right: number;
			bottom: number;
			left: number;
		};
		parentExcess?: {
			top: number;
			right: number;
			bottom: number;
			left: number;
		};
		overflow?: boolean;
		canvasOverflow?: boolean;
		containerOverflow?: boolean;
		clipped?: boolean;
	}[];
}

/** Extract mm value from a CSS string like "200mm". */
function parseMm(value: string | undefined): number | null {
	if (!value) return null;
	const m = value.trim().match(/^([\d.]+)\s*mm$/);
	return m ? Number.parseFloat(m[1] ?? "0") : null;
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Layout `serverLayoutCheck`: multi-step HTML/browser measurement pipeline, not a Document method.
export function serverLayoutCheck(
	html: string,
	canvas: { w: number; h: number },
): LayoutResult {
	const { document: dom } = parseHTML(`<html><body>${html}</body></html>`);
	const issues: string[] = [];
	const overflowIds = new Set<string>();
	const flag = (id: string | null, msg: string) => {
		issues.push(msg);
		if (id) overflowIds.add(id);
	};
	for (const el of dom.body.querySelectorAll("[data-id]")) {
		const node = el as unknown as {
			getAttribute(name: string): string | null;
			hasAttribute(name: string): boolean;
			children?: { getAttribute?: (name: string) => string | null }[];
			tagName?: string;
			textContent?: string | null;
		};
		const interactive =
			LAYOUT_INTERACTIVE_TAGS.has(String(node.tagName || "").toLowerCase()) ||
			LAYOUT_INTERACTIVE_ATTRIBUTES.some((name) => node.hasAttribute(name));
		const layoutIgnored =
			node.getAttribute("data-maket-layout") === "ignore" &&
			(node.children?.length ?? 0) === 0 &&
			!node.textContent?.trim() &&
			!interactive;
		if (layoutIgnored) continue;
		const style = node.getAttribute("style") || "";
		const id = node.getAttribute("data-id");
		const props = parseStyle(style);
		const w = parseMm(props.get("width"));
		const h = parseMm(props.get("height"));
		if (w && w > canvas.w) {
			flag(
				id,
				`[${id}] width ${w}mm > canvas ${canvas.w}mm (+${Math.round(w - canvas.w)}mm)`,
			);
		}
		if (h && h > canvas.h) {
			flag(
				id,
				`[${id}] height ${h}mm > canvas ${canvas.h}mm (+${Math.round(h - canvas.h)}mm)`,
			);
		}
		const display = props.get("display");
		const flexDir = props.get("flex-direction");
		const flexWrap = props.get("flex-wrap");
		if (
			display === "flex" &&
			(!flexDir || flexDir === "row") &&
			flexWrap !== "wrap" &&
			flexWrap !== "wrap-reverse"
		) {
			const outerW = w || canvas.w;
			const containerPl =
				parseMm(props.get("padding-left")) ||
				parseMm(props.get("padding")) ||
				0;
			const containerPr =
				parseMm(props.get("padding-right")) ||
				parseMm(props.get("padding")) ||
				0;
			const innerW = outerW - containerPl - containerPr;
			const gap = parseMm(props.get("gap")) || 0;
			let childSum = 0;
			let childCount = 0;
			const totalChildren = node.children?.length || 0;
			for (const child of node.children || []) {
				const childStyle = child.getAttribute?.("style") || "";
				const childProps = parseStyle(childStyle);
				const cw =
					parseMm(childProps.get("width")) ||
					parseMm(childProps.get("min-width"));
				if (cw) {
					childSum += cw;
					childCount++;
				}
			}
			if (childCount > 0 && childCount === totalChildren) {
				if (childCount > 1) childSum += gap * (childCount - 1);
				if (childSum > innerW) {
					flag(
						id,
						`[${id}] flex row children total ${Math.round(childSum)}mm > container ${Math.round(innerW)}mm (+${Math.round(childSum - innerW)}mm)`,
					);
				}
			}
		}
		if (props.get("position") === "absolute") {
			const left = parseMm(props.get("left"));
			const top = parseMm(props.get("top"));
			if (left != null && w != null && left + w > canvas.w) {
				flag(
					id,
					`[${id}] left(${left}mm) + width(${w}mm) = ${left + w}mm > canvas ${canvas.w}mm`,
				);
			}
			if (top != null && h != null && top + h > canvas.h) {
				flag(
					id,
					`[${id}] top(${top}mm) + height(${h}mm) = ${top + h}mm > canvas ${canvas.h}mm`,
				);
			}
		}
	}
	if (issues.length === 0) {
		return {
			status: "ok",
			text: "\n✓ Layout OK",
			overflowIds: [],
			overlapIds: [],
		};
	}
	return {
		status: "overflow",
		text: `\n⛔ Layout overflow — ${issues.length} issue(s). Not shippable.\n${issues.map((i) => `  • ${i}`).join("\n")}`,
		overflowIds: [...overflowIds],
		overlapIds: [],
	};
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Layout `formatLayoutReport`: multi-step HTML/browser measurement pipeline, not a Document method.
export function formatLayoutReport(
	resp: LayoutReport | null,
	canvas: { w: number; h: number },
): LayoutResult {
	if (!resp) {
		return {
			status: "overflow",
			text: "\n⛔ Layout check unavailable",
			overflowIds: [],
			overlapIds: [],
		};
	}
	const vOverflow = (resp.overflowBy ?? 0) > 0;
	const hOverflow = (resp.overflowByW ?? 0) > 0;
	const hasElementOverflow =
		(resp.overflowing?.length ?? 0) > 0 ||
		(resp.elements?.some((el) => el.overflow) ?? false);
	const clipped = [
		...new Set(
			[
				...(resp.clipped || []),
				...(resp.elements || [])
					.filter((el) => el.clipped)
					.map((el) => el.id || el.name || ""),
			].filter(Boolean),
		),
	];
	const hasClipped = clipped.length > 0;
	const overlapPairs = resp.overlaps ?? [];
	const overlapIdSet = new Set<string>();
	const overlapText: string[] = [];
	for (const [a, b] of overlapPairs) {
		if (a) overlapIdSet.add(a);
		if (b) overlapIdSet.add(b);
		overlapText.push(`${a} ↔ ${b}`);
	}
	const overlapIds = [...overlapIdSet];
	const hasOverlap = overlapPairs.length > 0;
	const hasOverflow =
		resp.overflow === true ||
		vOverflow ||
		hOverflow ||
		hasElementOverflow ||
		hasClipped;
	if (hasOverflow || hasOverlap) {
		const overflowing = [
			...new Set(
				[
					...(resp.overflowing || []),
					...(resp.elements || [])
						.filter((el) => el.overflow)
						.map((el) => el.id || el.name || ""),
				].filter(Boolean),
			),
		];
		const details: string[] = [];
		if (vOverflow) {
			details.push(
				`  Vertical: content ${resp.contentHeight}px > container ${resp.containerHeight}px (+${resp.overflowBy}px)`,
			);
		}
		if (hOverflow) {
			details.push(
				`  Horizontal: content ${resp.contentWidth}px > container ${resp.containerWidth}px (+${resp.overflowByW}px)`,
			);
		}
		if (overflowing.length > 0) {
			details.push(`  Overflowing: ${overflowing.join(", ")}`);
		}
		if (clipped.length > 0) {
			details.push(`  Clipped content: ${clipped.join(", ")}`);
		}
		if (hasOverlap) {
			details.push(`  Overlapping: ${overlapText.join(", ")}`);
		}
		if (details.length === 0) {
			details.push(
				"  Elements exceed page bounds (check absolute positioning or transforms)",
			);
		}
		const headline =
			hasOverflow && hasOverlap
				? "Layout overflow and overlap — not shippable"
				: hasOverflow
					? "Layout overflow — not shippable"
					: "Layout overlap — not shippable";
		return {
			status: "overflow",
			text: `\n⛔ ${headline}:\n${details.join("\n")}${formatMeasurementDetails(resp, canvas)}`,
			overflowIds: [...new Set([...overflowing, ...clipped])],
			overlapIds,
			measurements: resp,
		};
	}
	const tight = resp.tight;
	const tightSides: { side: string; ids: string[] }[] = [];
	if (tight?.top.length) tightSides.push({ side: "top", ids: tight.top });
	if (tight?.right.length) tightSides.push({ side: "right", ids: tight.right });
	if (tight?.bottom.length)
		tightSides.push({ side: "bottom", ids: tight.bottom });
	if (tight?.left.length) tightSides.push({ side: "left", ids: tight.left });
	if (tightSides.length > 0) {
		const ids = [...new Set(tightSides.flatMap((s) => s.ids))];
		const sideText = tightSides
			.map((s) => `${s.side}: ${s.ids.join(", ")}`)
			.join(" • ");
		return {
			status: "tight",
			text: `\n⚠ Layout tight — blocks cross declared margins (${sideText}). Tighten or move content inside the safe zone before shipping.${formatMeasurementDetails(resp, canvas)}`,
			overflowIds: [],
			overlapIds: [],
			tightIds: ids,
			measurements: resp,
		};
	}
	return {
		status: "ok",
		text: `\n✓ Layout OK${formatMeasurementDetails(resp, canvas)}`,
		overflowIds: [],
		overlapIds: [],
		measurements: resp,
	};
}

function formatMeasurementDetails(
	resp: LayoutReport,
	canvas: { w: number; h: number },
): string {
	const lines = [
		"",
		"### Measurements",
		`- Physical canvas: ${canvas.w}×${canvas.h}mm (${measurementPx(resp.containerWidth)}×${measurementPx(resp.containerHeight)}px)`,
		`- Content extent: ${measurementPx(resp.contentWidth)}×${measurementPx(resp.contentHeight)}px`,
		`- Measured addressable blocks: ${resp.elements?.length ?? 0}`,
		...(resp.root ? [formatMeasurementRoot(resp.root)] : []),
		...formatMeasurementProblems(resp.elements ?? []),
		...formatMeasurementOverlaps(resp.overlaps ?? []),
	];
	return `\n${lines.join("\n")}`;
}

function measurementPx(value: number | undefined): number {
	return Math.round(value ?? 0);
}

function formatMeasurementRoot(
	root: NonNullable<LayoutReport["root"]>,
): string {
	return `- Root \`[${root.id || "unnamed"}]\`: x=${measurementPx(root.left)}px, y=${measurementPx(root.top)}px, w=${measurementPx(root.width)}px, h=${measurementPx(root.height)}px`;
}

function formatMeasurementProblems(
	elements: NonNullable<LayoutReport["elements"]>,
): string[] {
	const problems = elements.filter(
		(element) => element.overflow || element.clipped,
	);
	if (problems.length === 0) return [];
	return [
		"",
		"| Element | Problem | Measured box | Excess |",
		"| --- | --- | --- | --- |",
		...problems.map(formatMeasurementProblem),
	];
}

function formatMeasurementProblem(
	element: NonNullable<LayoutReport["elements"]>[number],
): string {
	const problem = [
		element.canvasOverflow ? "physical canvas" : "",
		element.containerOverflow
			? `container [${element.parentId || "unnamed"}]`
			: "",
		element.clipped ? "clipped content" : "",
	]
		.filter(Boolean)
		.join(" + ");
	const excess = [
		formatMeasurementExcess("canvas", element.canvasExcess),
		formatMeasurementExcess("container", element.parentExcess),
	]
		.filter(Boolean)
		.join("; ");
	return `| \`[${escapeMeasurementCell(element.id || element.name || "unnamed")}]\` | ${escapeMeasurementCell(problem)} | x=${measurementPx(element.left)}, y=${measurementPx(element.top)}, w=${measurementPx(element.width)}, h=${measurementPx(element.height)}px | ${escapeMeasurementCell(excess || "n/a")} |`;
}

function formatMeasurementExcess(
	label: string,
	value:
		| { top: number; right: number; bottom: number; left: number }
		| undefined,
): string {
	if (!value) return "";
	const sides = (["top", "right", "bottom", "left"] as const)
		.filter((side) => value[side] > 2)
		.map((side) => `${side} +${measurementPx(value[side])}px`);
	return sides.length > 0 ? `${label}: ${sides.join(", ")}` : "";
}

function formatMeasurementOverlaps(overlaps: [string, string][]): string[] {
	if (overlaps.length === 0) return [];
	return [
		"",
		`- Overlap pairs: ${overlaps.map(([a, b]) => `\`[${a}]\` ↔ \`[${b}]\``).join(", ")}`,
	];
}

function escapeMeasurementCell(value: string): string {
	return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

// Run inside puppeteer — has access to `document`. Selector + margins passed
// in because page.evaluate ships the function source, not its closure.
//
// Format contract (see html.ts tool description): the agent's HTML root is
// `<div data-id="page" style="width:Wmm;height:Hmm">…</div>` — a single block
// declaring its own measurement zone. Falls back to the first addressable
// block for legacy / non-canonical roots such as `data-id="p4"`; page HTML
// commonly starts with a `<style>`, which is not a measurement container.
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Layout `measureInBrowser`: multi-step HTML/browser measurement pipeline, not a Document method.
// code-moniker: ignore[maket-hygiene-limits-callable-size]
// Puppeteer serializes this function alone, so browser helpers must stay inside its body.
function measureInBrowser(
	pageSelector: string,
	marginsPx: {
		top: number;
		right: number;
		bottom: number;
		left: number;
	} | null,
) {
	const TOLERANCE_PX = 2;
	const isMeasurableRoot = (node: Element | null): node is HTMLElement => {
		if (!(node instanceof HTMLElement) || node.parentElement !== document.body)
			return false;
		if (["SCRIPT", "STYLE", "TEMPLATE"].includes(node.tagName)) return false;
		const rect = node.getBoundingClientRect();
		return (
			getComputedStyle(node).display !== "none" &&
			rect.width > TOLERANCE_PX &&
			rect.height > TOLERANCE_PX
		);
	};
	const canonicalRoot = document.body.querySelector(pageSelector);
	const legacyRoots = [...document.body.children].filter(
		(node) => node.hasAttribute("data-id") && isMeasurableRoot(node),
	);
	const root = isMeasurableRoot(canonicalRoot)
		? canonicalRoot
		: legacyRoots.length === 1
			? legacyRoots[0]
			: null;
	if (!root) return null;
	const canvasRect = {
		top: 0,
		right: window.innerWidth,
		bottom: window.innerHeight,
		left: 0,
	};
	const rootRect = root.getBoundingClientRect();
	const containerHeight = Math.round(window.innerHeight);
	const containerWidth = Math.round(window.innerWidth);
	const isVisuallyHidden = (rect: DOMRect, style: CSSStyleDeclaration) =>
		style.position === "absolute" &&
		rect.width <= TOLERANCE_PX &&
		rect.height <= TOLERANCE_PX &&
		(style.opacity === "0" ||
			style.overflow === "hidden" ||
			style.clip !== "auto" ||
			style.clipPath !== "none");
	const interactiveTags = new Set([
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
	const interactiveAttributes = [
		"contenteditable",
		"data-maket-bind",
		"href",
		"role",
		"tabindex",
	];
	const hasClippedText = (
		el: Element,
		rect: DOMRect,
		overflowX: string,
		overflowY: string,
	) => {
		if (overflowX === "visible" && overflowY === "visible") return false;
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (!node.textContent?.trim()) continue;
			const range = document.createRange();
			range.selectNodeContents(node);
			for (const textRect of range.getClientRects()) {
				const clippedX =
					overflowX !== "visible" &&
					(textRect.left < rect.left - TOLERANCE_PX ||
						textRect.right > rect.right + TOLERANCE_PX);
				const clippedY =
					overflowY !== "visible" &&
					(textRect.top < rect.top - TOLERANCE_PX ||
						textRect.bottom > rect.bottom + TOLERANCE_PX);
				if (clippedX || clippedY) return true;
			}
		}
		return false;
	};
	const excess = (
		top: number,
		right: number,
		bottom: number,
		left: number,
		bounds: { top: number; right: number; bottom: number; left: number },
	) => ({
		top: Math.max(0, Math.round(bounds.top - top)),
		right: Math.max(0, Math.round(right - bounds.right)),
		bottom: Math.max(0, Math.round(bottom - bounds.bottom)),
		left: Math.max(0, Math.round(bounds.left - left)),
	});
	const hasExcess = (value: {
		top: number;
		right: number;
		bottom: number;
		left: number;
	}) => Object.values(value).some((amount) => amount > TOLERANCE_PX);
	const addressableParent = (el: Element) => {
		for (
			let parent = el.parentElement;
			parent && parent !== document.body;
			parent = parent.parentElement
		) {
			if (!parent.hasAttribute("data-id")) continue;
			const rect = parent.getBoundingClientRect();
			if (rect.width > TOLERANCE_PX && rect.height > TOLERANCE_PX) {
				return { element: parent, rect };
			}
		}
		return null;
	};
	const blocks = [...root.querySelectorAll("[data-id]"), root].map((el) => {
		const rect = el.getBoundingClientRect();
		const top = Math.round(rect.top - canvasRect.top);
		const left = Math.round(rect.left - canvasRect.left);
		const bottom = Math.round(rect.bottom - canvasRect.top);
		const right = Math.round(rect.right - canvasRect.left);
		const style = getComputedStyle(el);
		const visuallyHidden = isVisuallyHidden(rect, style);
		const interactive =
			interactiveTags.has(el.tagName.toLowerCase()) ||
			interactiveAttributes.some((name) => el.hasAttribute(name));
		const layoutIgnored =
			el.getAttribute("data-maket-layout") === "ignore" &&
			el.children.length === 0 &&
			!el.textContent?.trim() &&
			!interactive;
		const scrollHeight =
			"scrollHeight" in el && typeof el.scrollHeight === "number"
				? el.scrollHeight
				: rect.height;
		const scrollWidth =
			"scrollWidth" in el && typeof el.scrollWidth === "number"
				? el.scrollWidth
				: rect.width;
		const visualBottom =
			style.overflowY === "visible"
				? Math.max(bottom, top + scrollHeight)
				: bottom;
		const visualRight =
			style.overflowX === "visible"
				? Math.max(right, left + scrollWidth)
				: right;
		const parent = el === root ? null : addressableParent(el);
		const parentBounds = parent
			? {
					top: Math.round(parent.rect.top - canvasRect.top),
					right: Math.round(parent.rect.right - canvasRect.left),
					bottom: Math.round(parent.rect.bottom - canvasRect.top),
					left: Math.round(parent.rect.left - canvasRect.left),
				}
			: null;
		const canvasExcess = excess(top, visualRight, visualBottom, left, {
			top: 0,
			right: containerWidth,
			bottom: containerHeight,
			left: 0,
		});
		const parentExcess = parentBounds
			? excess(top, visualRight, visualBottom, left, parentBounds)
			: { top: 0, right: 0, bottom: 0, left: 0 };
		const canvasOverflow = hasExcess(canvasExcess);
		const containerOverflow = hasExcess(parentExcess);
		const clipped =
			!visuallyHidden &&
			!layoutIgnored &&
			hasClippedText(el, rect, style.overflowX, style.overflowY);
		return {
			el,
			visuallyHidden,
			layoutIgnored,
			id: el.getAttribute("data-id") || "",
			name: el.getAttribute("data-name") || "",
			parentId: parent?.element.getAttribute("data-id") || "",
			top,
			left,
			bottom,
			right,
			visualBottom,
			visualRight,
			canvasExcess,
			parentExcess,
			canvasOverflow,
			containerOverflow,
			overflow: canvasOverflow || containerOverflow,
			clipped,
		};
	});
	const measuredBlocks = blocks.filter(
		(b) => !b.visuallyHidden && !b.layoutIgnored,
	);
	const minTop = measuredBlocks.length
		? Math.min(0, ...measuredBlocks.map((b) => b.top))
		: 0;
	const minLeft = measuredBlocks.length
		? Math.min(0, ...measuredBlocks.map((b) => b.left))
		: 0;
	const maxBottom = measuredBlocks.length
		? Math.max(containerHeight, ...measuredBlocks.map((b) => b.visualBottom))
		: containerHeight;
	const maxRight = measuredBlocks.length
		? Math.max(containerWidth, ...measuredBlocks.map((b) => b.visualRight))
		: containerWidth;
	const contentHeight = Math.round(maxBottom - minTop);
	const contentWidth = Math.round(maxRight - minLeft);
	const overflowing = measuredBlocks
		.filter((b) => b.overflow)
		.map((b) => b.id || b.name || "")
		.filter(Boolean);
	const overflowV = contentHeight > containerHeight + TOLERANCE_PX;
	const overflowH = contentWidth > containerWidth + TOLERANCE_PX;
	const clipped = measuredBlocks
		.filter((b) => b.clipped)
		.map((b) => b.id || b.name || "")
		.filter(Boolean);
	const overlaps: [string, string][] = [];
	for (const [i, a] of measuredBlocks.entries()) {
		if (!a.id) continue;
		for (const b of measuredBlocks.slice(i + 1)) {
			if (!b.id) continue;
			if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
			const intersects =
				a.left < b.right - TOLERANCE_PX &&
				a.right > b.left + TOLERANCE_PX &&
				a.top < b.bottom - TOLERANCE_PX &&
				a.bottom > b.top + TOLERANCE_PX;
			if (intersects) overlaps.push([a.id, b.id]);
		}
	}
	const tight = { top: [], right: [], bottom: [], left: [] } as {
		top: string[];
		right: string[];
		bottom: string[];
		left: string[];
	};
	if (marginsPx) {
		for (const b of measuredBlocks) {
			if (b.el === root || !b.id || b.overflow) continue;
			if (b.top < marginsPx.top - TOLERANCE_PX) tight.top.push(b.id);
			if (b.left < marginsPx.left - TOLERANCE_PX) tight.left.push(b.id);
			if (b.bottom > containerHeight - marginsPx.bottom + TOLERANCE_PX)
				tight.bottom.push(b.id);
			if (b.right > containerWidth - marginsPx.right + TOLERANCE_PX)
				tight.right.push(b.id);
		}
	}
	return {
		overflow:
			overflowV || overflowH || overflowing.length > 0 || clipped.length > 0,
		containerHeight,
		contentHeight,
		overflowBy: overflowV ? contentHeight - containerHeight : 0,
		containerWidth,
		contentWidth,
		overflowByW: overflowH ? contentWidth - containerWidth : 0,
		overflowing,
		clipped,
		overlaps,
		tight,
		root: {
			id: root.getAttribute("data-id") || "",
			left: Math.round(rootRect.left - canvasRect.left),
			top: Math.round(rootRect.top - canvasRect.top),
			width: Math.round(rootRect.width),
			height: Math.round(rootRect.height),
		},
		elements: measuredBlocks.map((b) => ({
			id: b.id,
			name: b.name,
			parentId: b.parentId,
			left: b.left,
			top: b.top,
			width: Math.round(b.right - b.left),
			height: Math.round(b.bottom - b.top),
			canvasExcess: b.canvasExcess,
			parentExcess: b.parentExcess,
			overflow: b.overflow,
			canvasOverflow: b.canvasOverflow,
			containerOverflow: b.containerOverflow,
			clipped: b.clipped,
		})),
	};
}
