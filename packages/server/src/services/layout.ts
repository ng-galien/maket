/**
 * layout — layout measurement service for HTML mutations.
 *
 * Two entry points:
 *
 * - `measure(doc, html, pageIdx)` — used by `set_html` / `patch_html`. First
 *   broadcasts the new state to connected browsers (fire-and-forget, so the
 *   live preview refreshes immediately), then returns a canvas-authoritative
 *   layout summary computed server-side (mm-math walker, with a headless
 *   Chromium fallback for content-driven overflow).
 *
 * - `check(doc, html, pageIdx)` — used by `check_layout`. Same measurement
 *   path as `measure` but without the state broadcast, and the result is
 *   trimmed (no leading newline).
 *
 * Earlier revisions awaited a browser-measured layout report via WebSocket
 * (measureId correlation). That reported the *thumbnail's* container size,
 * not the canvas, so agents routinely saw phantom overflow on pages that
 * fit the canvas perfectly. We kept the broadcast (for live preview sync,
 * which is independent of measurement) but dropped the round-trip wait
 * and report nothing but canvas-authoritative numbers.
 */

import { parseHTML } from "linkedom";
import puppeteer, { type Browser } from "puppeteer";
import { parseStyle } from "../lib/charte-check.js";
import {
	CHROMIUM_HEADLESS,
	shouldDisableSandbox,
} from "../lib/chromium-sandbox.js";
import { escapeCssValue, stripStyleClose } from "../lib/css-escape.js";
import { installNetworkGuard } from "../lib/page-network-guard.js";
import {
	PAGE_BLOCK_SELECTOR,
	waitForPageStable,
} from "../lib/page-stable-wait.js";
import type { Document } from "../types.js";
import type { Documents } from "./documents.js";
import type { WsRegistry } from "./ws-registry.js";

/** px per mm at 96 DPI — matches the viewport puppeteer renders into. */
const PX_PER_MM = 96 / 25.4;

export interface LayoutResult {
	status: "ok" | "tight" | "overflow";
	/** Newline-prefixed for direct concatenation; check runner trims. */
	text: string;
	/** Block ids that escape the canvas. */
	overflowIds: string[];
	/** Block ids involved in any pairwise intersection (flat unique list). */
	overlapIds: string[];
	/** Block ids that cross a declared margin band (flat unique list). */
	tightIds?: string[];
}

export interface LayoutService {
	/** Broadcasts state for live preview, then measures. */
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
	documents: Documents;
	wsRegistry: WsRegistry;
}

export interface LayoutServiceOptions {
	/** Override for the puppeteer launcher (defaults to `puppeteer.launch`). */
	browserLaunch?: () => Promise<Browser>;
	/** Override for the base URL used to rewrite relative `/assets/…` paths. */
	getAssetBaseUrl?: () => string;
}

/**
 * Options live in a second argument on purpose: Awilix PROXY mode triggers a
 * container lookup for every destructured name on the deps object, so putting
 * optional test overrides there would require registering `undefined` for
 * them at the container level.
 */
export function createLayoutService(
	deps: LayoutServiceDeps,
	opts: LayoutServiceOptions = {},
): LayoutService {
	const { documents, wsRegistry } = deps;
	const browserLaunch =
		opts.browserLaunch ??
		(() =>
			puppeteer.launch({
				headless: CHROMIUM_HEADLESS,
				args: shouldDisableSandbox() ? ["--no-sandbox"] : [],
			}));
	const getAssetBaseUrl =
		opts.getAssetBaseUrl ??
		(() => `http://localhost:${process.env.MAKET_PORT || "3333"}`);

	let browser: Browser | null = null;
	async function getBrowser(): Promise<Browser> {
		if (browser?.connected) return browser;
		browser = await browserLaunch();
		browser.on("disconnected", () => {
			browser = null;
		});
		return browser;
	}

	async function headlessCheck(
		doc: Document,
		pageHtml: string,
	): Promise<LayoutReport | null> {
		let b: Browser;
		try {
			b = await getBrowser();
		} catch {
			return null;
		}
		const page = await b.newPage();
		try {
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
			await page.setContent(fullHtml, { waitUntil: "networkidle0" });
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
		} catch {
			return null;
		} finally {
			await page.close();
		}
	}

	async function runMeasure(
		doc: Document,
		pageHtml: string,
	): Promise<LayoutResult> {
		const serverResult = serverLayoutCheck(pageHtml, doc.canvas);
		if (serverResult.status === "overflow") return serverResult;
		const headless = await headlessCheck(doc, pageHtml);
		if (headless) return formatLayoutReport(headless, doc.canvas);
		if (serverResult.status === "ok") {
			return {
				status: "ok",
				text: "\n✓ Layout OK (headless unavailable — content overflow + overlap unchecked)",
				overflowIds: [],
				overlapIds: [],
			};
		}
		return serverResult;
	}

	function broadcastState(doc: Document, pageIdx: number) {
		if (!wsRegistry.hasClients()) return;
		wsRegistry.broadcast({
			type: "state",
			doc: documents.lightView(doc, pageIdx),
			docList: documents.list(),
			charteCss: documents.charteCss(doc),
		});
	}

	return {
		async measure(doc, pageHtml, pageIdx) {
			broadcastState(doc, pageIdx);
			return runMeasure(doc, pageHtml);
		},
		async check(doc, pageHtml, _pageIdx) {
			return runMeasure(doc, pageHtml);
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
	elements?: {
		id?: string;
		name?: string;
		overflow?: boolean;
	}[];
}

/** Extract mm value from a CSS string like "200mm". */
function parseMm(value: string | undefined): number | null {
	if (!value) return null;
	const m = value.trim().match(/^([\d.]+)\s*mm$/);
	return m ? Number.parseFloat(m[1] ?? "0") : null;
}

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
			children?: { getAttribute?: (name: string) => string | null }[];
		};
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

export function formatLayoutReport(
	resp: LayoutReport | null,
	_canvas: { w: number; h: number },
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
		resp.overflow === true || vOverflow || hOverflow || hasElementOverflow;
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
			text: `\n⛔ ${headline}:\n${details.join("\n")}`,
			overflowIds: overflowing,
			overlapIds,
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
			text: `\n⚠ Layout tight — blocks cross declared margins (${sideText}). Tighten or move content inside the safe zone before shipping.`,
			overflowIds: [],
			overlapIds: [],
			tightIds: ids,
		};
	}
	return {
		status: "ok",
		text: "\n✓ Layout OK",
		overflowIds: [],
		overlapIds: [],
	};
}

// Run inside puppeteer — has access to `document`. Selector + margins passed
// in because page.evaluate ships the function source, not its closure.
//
// Format contract (see html.ts tool description): the agent's HTML root is
// `<div data-id="page" style="width:Wmm;height:Hmm">…</div>` — a single block
// declaring its own measurement zone. Falls back to firstElementChild for
// legacy / non-canonical content.
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
	const root = (document.body.querySelector(pageSelector) ??
		document.body.firstElementChild) as HTMLElement | null;
	if (!root) return null;
	const rootRect = root.getBoundingClientRect();
	const containerHeight = Math.round(rootRect.height);
	const containerWidth = Math.round(rootRect.width);
	const blocks = [...root.querySelectorAll("[data-id]")].map((node) => {
		const el = node as HTMLElement;
		const rect = el.getBoundingClientRect();
		const top = Math.round(rect.top - rootRect.top);
		const left = Math.round(rect.left - rootRect.left);
		const bottom = Math.round(rect.bottom - rootRect.top);
		const right = Math.round(rect.right - rootRect.left);
		return {
			el,
			id: el.dataset.id || "",
			name: el.dataset.name || "",
			top,
			left,
			bottom,
			right,
			overflow:
				top < -TOLERANCE_PX ||
				left < -TOLERANCE_PX ||
				bottom > containerHeight + TOLERANCE_PX ||
				right > containerWidth + TOLERANCE_PX,
		};
	});
	const minTop = blocks.length ? Math.min(0, ...blocks.map((b) => b.top)) : 0;
	const minLeft = blocks.length ? Math.min(0, ...blocks.map((b) => b.left)) : 0;
	const maxBottom = blocks.length
		? Math.max(root.scrollHeight, ...blocks.map((b) => b.bottom))
		: root.scrollHeight;
	const maxRight = blocks.length
		? Math.max(root.scrollWidth, ...blocks.map((b) => b.right))
		: root.scrollWidth;
	const contentHeight = Math.round(maxBottom - minTop);
	const contentWidth = Math.round(maxRight - minLeft);
	const overflowing = blocks
		.filter((b) => b.overflow)
		.map((b) => b.id || b.name || "")
		.filter(Boolean);
	const overflowV = contentHeight > containerHeight;
	const overflowH = contentWidth > containerWidth;
	const overlaps: [string, string][] = [];
	for (const [i, a] of blocks.entries()) {
		if (!a.id) continue;
		for (const b of blocks.slice(i + 1)) {
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
		for (const b of blocks) {
			if (!b.id || b.overflow) continue;
			if (b.top < marginsPx.top - TOLERANCE_PX) tight.top.push(b.id);
			if (b.left < marginsPx.left - TOLERANCE_PX) tight.left.push(b.id);
			if (b.bottom > containerHeight - marginsPx.bottom + TOLERANCE_PX)
				tight.bottom.push(b.id);
			if (b.right > containerWidth - marginsPx.right + TOLERANCE_PX)
				tight.right.push(b.id);
		}
	}
	return {
		overflow: overflowV || overflowH || overflowing.length > 0,
		containerHeight,
		contentHeight,
		overflowBy: overflowV ? contentHeight - containerHeight : 0,
		containerWidth,
		contentWidth,
		overflowByW: overflowH ? contentWidth - containerWidth : 0,
		overflowing,
		overlaps,
		tight,
		elements: blocks.map((b) => ({
			id: b.id,
			name: b.name,
			overflow: b.overflow,
		})),
	};
}
