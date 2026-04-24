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
import { shouldDisableSandbox } from "../lib/chromium-sandbox.js";
import { escapeCssValue, stripStyleClose } from "../lib/css-escape.js";
import { installNetworkGuard } from "../lib/page-network-guard.js";
import type { Document } from "../types.js";
import type { Documents } from "./documents.js";
import type { WsRegistry } from "./ws-registry.js";

/** px per mm at 96 DPI — matches the viewport puppeteer renders into. */
const PX_PER_MM = 96 / 25.4;

export interface LayoutResult {
	status: "ok" | "tight" | "overflow";
	/** Newline-prefixed for direct concatenation; check runner trims. */
	text: string;
	overflowIds: string[];
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
				headless: true,
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
			await page.evaluate(() => document.fonts.ready);
			return (await page.evaluate(measureInBrowser)) as LayoutReport | null;
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
		// Skip puppeteer when mm-math already sees overflow.
		const serverResult = serverLayoutCheck(pageHtml, doc.canvas);
		if (serverResult.status === "overflow") return serverResult;
		// Headless catches content-driven overflow + the tight threshold;
		// falls back to the server's ok when puppeteer is unavailable.
		const headless = await headlessCheck(doc, pageHtml);
		if (headless) return formatLayoutReport(headless, doc.canvas);
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
		return { status: "ok", text: "\n✓ Layout OK", overflowIds: [] };
	}
	return {
		status: "overflow",
		text: `\n⛔ Layout overflow — ${issues.length} issue(s). Not shippable.\n${issues.map((i) => `  • ${i}`).join("\n")}`,
		overflowIds: [...overflowIds],
	};
}

/**
 * Min bottom-margin clearance before a page counts as "shippable". Scales
 * with canvas height so A5 and A4 both get a sensible guardrail without a
 * config knob.
 */
function tightThresholdMm(canvasH: number): number {
	return Math.max(10, canvasH * 0.05);
}

export function formatLayoutReport(
	resp: LayoutReport | null,
	canvas: { w: number; h: number },
): LayoutResult {
	if (!resp) {
		return {
			status: "overflow",
			text: "\n⛔ Layout check unavailable",
			overflowIds: [],
		};
	}
	const vOverflow = (resp.overflowBy ?? 0) > 0;
	const hOverflow = (resp.overflowByW ?? 0) > 0;
	const hasElementOverflow =
		(resp.overflowing?.length ?? 0) > 0 ||
		(resp.elements?.some((el) => el.overflow) ?? false);
	if (resp.overflow || vOverflow || hOverflow || hasElementOverflow) {
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
		if (details.length === 0) {
			details.push(
				"  Elements exceed page bounds (check absolute positioning or transforms)",
			);
		}
		return {
			status: "overflow",
			text: `\n⛔ Layout overflow — not shippable:\n${details.join("\n")}`,
			overflowIds: overflowing,
		};
	}
	const containerH = resp.containerHeight ?? 0;
	const contentH = resp.contentHeight ?? 0;
	const thresholdMm = tightThresholdMm(canvas.h);
	const bottomMarginPx = containerH - contentH;
	if (
		containerH > 0 &&
		contentH > 0 &&
		bottomMarginPx < thresholdMm * PX_PER_MM
	) {
		const bottomMarginMm = Math.round(bottomMarginPx / PX_PER_MM);
		return {
			status: "tight",
			text: `\n⚠ Layout tight — bottom margin ${bottomMarginMm}mm (min ${Math.round(thresholdMm)}mm). Tighten or move content up before shipping.`,
			overflowIds: [],
		};
	}
	return { status: "ok", text: "\n✓ Layout OK", overflowIds: [] };
}

// Run inside puppeteer — has access to `document`.
function measureInBrowser() {
	const root = document.body.firstElementChild as HTMLElement | null;
	if (!root) return null;
	const rootRect = root.getBoundingClientRect();
	const containerHeight = Math.round(rootRect.height);
	const containerWidth = Math.round(rootRect.width);
	const elements = [...root.querySelectorAll("[data-id]")].map((node) => {
		const el = node as HTMLElement;
		const rect = el.getBoundingClientRect();
		const top = Math.round(rect.top - rootRect.top);
		const left = Math.round(rect.left - rootRect.left);
		const bottom = Math.round(rect.bottom - rootRect.top);
		const right = Math.round(rect.right - rootRect.left);
		const overflow =
			top < -1 ||
			left < -1 ||
			bottom > containerHeight + 1 ||
			right > containerWidth + 1;
		return {
			id: el.dataset.id,
			name: el.dataset.name || "",
			top,
			left,
			bottom,
			right,
			overflow,
		};
	});
	const minTop = elements.length
		? Math.min(0, ...elements.map((el) => el.top))
		: 0;
	const minLeft = elements.length
		? Math.min(0, ...elements.map((el) => el.left))
		: 0;
	const maxBottom = elements.length
		? Math.max(root.scrollHeight, ...elements.map((el) => el.bottom))
		: root.scrollHeight;
	const maxRight = elements.length
		? Math.max(root.scrollWidth, ...elements.map((el) => el.right))
		: root.scrollWidth;
	const contentHeight = Math.round(maxBottom - minTop);
	const contentWidth = Math.round(maxRight - minLeft);
	const overflowing = elements
		.filter((el) => el.overflow)
		.map((el) => el.id || el.name || "")
		.filter(Boolean);
	const overflowV = contentHeight > containerHeight;
	const overflowH = contentWidth > containerWidth;
	return {
		overflow: overflowV || overflowH || overflowing.length > 0,
		containerHeight,
		contentHeight,
		overflowBy: overflowV ? contentHeight - containerHeight : 0,
		containerWidth,
		contentWidth,
		overflowByW: overflowH ? contentWidth - containerWidth : 0,
		overflowing,
		elements,
	};
}
