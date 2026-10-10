/**
 * page-flow — spreads the items of a list longer than its page over generated
 * continuation pages.
 *
 * A renderer describes one source page as a function of item ranges: every
 * flowing list (a state array, the cards of a Structured Workspace items slot)
 * renders the items of its range, each wrapped in `maket-flow` comments. The
 * planner lays the page out in headless Chromium at the document canvas size,
 * finds the first item of each list that ends below the canvas or below a
 * clipping ancestor, and starts the next page there. The page template repeats
 * on every continuation page, so its own header heads each of them.
 *
 * Rendering stays synchronous: `pages` answers from the plan measured for the
 * same rendered content, or from the last plan of that page while a new one is
 * measured in the background; a finished plan that changes the page list emits
 * `document:flowed` so listeners re-broadcast the document.
 */

import { createHash } from "node:crypto";
import type { DocumentStateFlowRange } from "@maket/shared";
import { escapeCssValue, stripStyleClose } from "../lib/css-escape.js";
import { installNetworkGuard } from "../lib/page-network-guard.js";
import { waitForPageStable } from "../lib/page-stable-wait.js";
import type { Document, Page } from "../types.js";
import type { BrowserPool, RenderPage } from "./browser-pool.js";
import type { Bus } from "./bus.js";
import type { Documents } from "./documents.js";

const PX_PER_MM = 96 / 25.4;
const MAX_FLOW_PAGES = 60;
const MAX_CACHED_PLANS = 500;
const EXHAUSTED = Number.MAX_SAFE_INTEGER;

export type FlowRanges = Record<string, DocumentStateFlowRange>;

export interface FlowRender {
	/** Page HTML with every flowing item wrapped in maket-flow comments. */
	html: string;
	/** Flowing list keys, indexed by the list rank written in the comments. */
	lists: string[];
}

export interface PageFlowRequest {
	doc: Pick<Document, "name" | "canvas" | "meta">;
	/** Identifies the source page inside the document. */
	pageKey: string;
	/** The page rendered with every item of every list, marked. */
	full: FlowRender;
	/** Renders the page with only the items of `ranges`, marked. */
	render(ranges: FlowRanges): FlowRender;
}

export interface PageFlow {
	/** Item ranges of every output page, or null when the page stays one page. */
	pages(request: PageFlowRequest): FlowRanges[] | null;
	/** Resolves once every queued plan is measured. */
	settle(): Promise<void>;
}

export interface PageFlowDeps {
	bus: Bus;
	browserPool: BrowserPool;
	documents: Pick<Documents, "charteCss">;
}

export interface PageFlowOptions {
	getAssetBaseUrl?: () => string;
}

interface CachedPlan {
	signature: string;
	pages: FlowRanges[] | null;
}

interface QueuedPlan {
	signature: string;
	request: PageFlowRequest;
	charteCss: string;
	served: FlowRanges[] | null;
}

interface MeasuredList {
	units: number;
	overflow: number | null;
}

/**
 * Identity of the n-th (0-based) output page of a source page that renders to
 * `count` pages. Every page of a flowed set carries `flow`, which names its
 * source page; the identifier is never parsed to find it.
 */
export function flowedPageIdentity(
	page: Pick<Page, "id" | "name">,
	index: number,
	count: number,
): Pick<Page, "id" | "name" | "flow"> {
	if (count <= 1) return { id: page.id, name: page.name };
	const flow = { sourcePageId: page.id, index, count };
	if (index === 0) return { id: page.id, name: page.name, flow };
	return {
		id: `${page.id}~${index + 1}`,
		name: `${page.name ?? "Page"} (${index + 1})`,
		flow,
	};
}

/** The authored page an output page renders. */
export function flowSourcePageId(page: Pick<Page, "id" | "flow">): string {
	return page.flow?.sourcePageId ?? page.id;
}

/** Whether an output page is a generated continuation page. */
export function isFlowContinuation(page: Pick<Page, "flow">): boolean {
	return (page.flow?.index ?? 0) > 0;
}

/** Marks a continuation page on its first element: `data-maket-flow-page`
 * holds its rank and `data-maket-flow-pages` the page count, both 1-based. */
export function markFlowedPage(
	html: string,
	index: number,
	count: number,
): string {
	if (count <= 1) return html;
	const attributes = ` data-maket-flow-page="${index + 1}" data-maket-flow-pages="${count}"`;
	const pattern = /<(?!(?:style|script|link|meta)\b)([a-zA-Z][\w-]*)/g;
	const match = pattern.exec(html);
	if (!match) return html;
	const end = match.index + match[0].length;
	return `${html.slice(0, end)}${attributes}${html.slice(end)}`;
}

/** Page links of a flowed document point at the first output page of their
 * source page; `sourceStarts[n]` is the output index of source page n. */
export function remapPageLinkNumbers(
	html: string,
	sourceStarts: number[],
): string {
	return html.replace(
		/(href\s*=\s*["'])#page=(\d+)(["'])/g,
		(whole, open: string, raw: string, close: string) => {
			const target = sourceStarts[Number(raw) - 1];
			return target === undefined
				? whole
				: `${open}#page=${target + 1}${close}`;
		},
	);
}

export function createPageFlow(
	deps: PageFlowDeps,
	opts: PageFlowOptions = {},
): PageFlow {
	const getAssetBaseUrl =
		opts.getAssetBaseUrl ??
		(() => `http://localhost:${process.env.MAKET_PORT || "3333"}`);
	const plans = new Map<string, CachedPlan>();
	const queue = new Map<string, QueuedPlan>();
	const measuring = new Map<string, string>();
	let running: Promise<void> | null = null;

	function remember(key: string, plan: CachedPlan): void {
		plans.delete(key);
		plans.set(key, plan);
		while (plans.size > MAX_CACHED_PLANS) {
			const oldest = plans.keys().next().value;
			if (oldest === undefined) break;
			plans.delete(oldest);
		}
	}

	function takeQueued(): [string, QueuedPlan] {
		const next = queue.entries().next().value as [string, QueuedPlan];
		queue.delete(next[0]);
		measuring.set(next[0], next[1].signature);
		return next;
	}

	function finishPlan(
		key: string,
		queued: QueuedPlan,
		pages: FlowRanges[] | null,
	): void {
		measuring.delete(key);
		if (queue.has(key)) return;
		remember(key, { signature: queued.signature, pages });
		if (JSON.stringify(pages) !== JSON.stringify(queued.served)) {
			deps.bus.emit("document:flowed", { docName: queued.request.doc.name });
		}
	}

	async function drain(): Promise<void> {
		while (queue.size > 0) {
			const [key, queued] = takeQueued();
			finishPlan(
				key,
				queued,
				await measuredPlan(queued, deps.browserPool, getAssetBaseUrl),
			);
		}
	}

	function schedule(): void {
		running ??= drain().finally(() => {
			running = null;
			if (queue.size > 0) schedule();
		});
	}

	return {
		pages(request) {
			if (request.full.lists.length === 0) return null;
			const key = `${request.doc.name}\u0000${request.pageKey}`;
			const charteCss = deps.documents.charteCss(request.doc as Document);
			const signature = flowSignature(request, charteCss);
			const cached = plans.get(key);
			if (cached?.signature === signature) return cached.pages;
			const served = cached?.pages ?? null;
			if (measuring.get(key) === signature) {
				queue.delete(key);
				return served;
			}
			if (queue.get(key)?.signature !== signature) {
				queue.set(key, { signature, request, charteCss, served });
			}
			schedule();
			return served;
		},
		async settle() {
			while (running) await running;
		},
	};
}

/** The plan of a queued page, or null (one page) when it cannot be measured. */
async function measuredPlan(
	queued: QueuedPlan,
	browserPool: BrowserPool,
	getAssetBaseUrl: () => string,
): Promise<FlowRanges[] | null> {
	try {
		return await measurePlan(queued, browserPool, getAssetBaseUrl);
	} catch (error) {
		console.error(
			`[page-flow] ${queued.request.doc.name}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return null;
	}
}

function flowSignature(request: PageFlowRequest, charteCss: string): string {
	return createHash("sha1")
		.update(request.full.html)
		.update("\u0000")
		.update(JSON.stringify(request.doc.canvas))
		.update("\u0000")
		.update(charteCss)
		.digest("hex");
}

// Planning loop: Chromium measures one candidate page per iteration.
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
async function measurePlan(
	queued: QueuedPlan,
	browserPool: BrowserPool,
	getAssetBaseUrl: () => string,
): Promise<FlowRanges[] | null> {
	const { request, charteCss } = queued;
	const browser = await browserPool.get();
	const page = await browser.newPage();
	try {
		const { w, h } = request.doc.canvas;
		await installNetworkGuard(page, "localhost-only");
		await page.setViewport({
			width: Math.ceil(w * PX_PER_MM),
			height: Math.ceil(h * PX_PER_MM),
		});
		const starts: Record<string, number>[] = [];
		let current: Record<string, number> = {};
		for (let index = 0; index < MAX_FLOW_PAGES; index += 1) {
			const rendered =
				index === 0 ? request.full : request.render(openRanges(current));
			const measured = await measureFlowPage(
				page,
				rendered.html,
				request.doc,
				charteCss,
				getAssetBaseUrl(),
			);
			starts.push(current);
			const next: Record<string, number> = { ...current };
			let progress = false;
			let overflowing = false;
			for (const [rank, list] of rendered.lists.entries()) {
				const result = measured[rank];
				if (!result || result.units === 0) {
					next[list] = EXHAUSTED;
					continue;
				}
				if (result.overflow === null) {
					next[list] = EXHAUSTED;
					progress = true;
					continue;
				}
				overflowing = true;
				if (result.overflow > (current[list] ?? 0)) progress = true;
				next[list] = result.overflow;
			}
			if (!overflowing) break;
			if (!progress) {
				for (const list of rendered.lists) {
					const start = current[list] ?? 0;
					if (measured[rendered.lists.indexOf(list)]?.overflow === start) {
						next[list] = start + 1;
					}
				}
			}
			current = next;
		}
		if (starts.length <= 1) return null;
		return starts.map((start, index) => {
			const following = starts[index + 1];
			const ranges: FlowRanges = {};
			for (const list of new Set([
				...Object.keys(start),
				...Object.keys(following ?? {}),
				...request.full.lists,
			])) {
				ranges[list] = [start[list] ?? 0, following?.[list] ?? null];
			}
			return ranges;
		});
	} finally {
		await page.close().catch(() => {});
	}
}

function openRanges(starts: Record<string, number>): FlowRanges {
	return Object.fromEntries(
		Object.entries(starts).map(([list, start]) => [list, [start, null]]),
	);
}

async function measureFlowPage(
	page: RenderPage,
	html: string,
	doc: Pick<Document, "canvas">,
	charteCss: string,
	assetBaseUrl: string,
): Promise<Record<number, MeasuredList>> {
	const { w, h, bg } = doc.canvas;
	await page.setContent(
		`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
${stripStyleClose(charteCss)}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { margin: 0; padding: 0; width: ${w}mm; height: ${h}mm; overflow: hidden; background: ${escapeCssValue(bg || "#ffffff")}; }
</style>
</head>
<body>${html.replaceAll("/assets/", `${assetBaseUrl}/assets/`)}</body>
</html>`,
		{ waitUntil: "load" },
	);
	await waitForPageStable(page);
	const expression = `(() => { globalThis.__name ??= (target) => target; return (${measureFlowInBrowser.toString()})(); })()`;
	return ((await page.evaluate(expression)) ?? {}) as Record<
		number,
		MeasuredList
	>;
}

// Puppeteer serializes this function alone, so its helpers stay inside it.
// code-moniker: ignore[maket-hygiene-limits-callable-size]
function measureFlowInBrowser(): Record<number, MeasuredList> {
	const TOLERANCE_PX = 2;
	const canvasBottom = window.innerHeight;
	const units: { list: number; index: number; start: Comment; end: Comment }[] =
		[];
	const open: { list: number; index: number; start: Comment }[] = [];
	const walker = document.createTreeWalker(
		document.body,
		NodeFilter.SHOW_COMMENT,
	);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const value = node.nodeValue ?? "";
		const marker = /^maket-flow:(\d+):(\d+)$/.exec(value);
		if (marker) {
			open.push({
				list: Number(marker[1]),
				index: Number(marker[2]),
				start: node as Comment,
			});
			continue;
		}
		if (value === "/maket-flow") {
			const started = open.pop();
			if (started) units.push({ ...started, end: node as Comment });
		}
	}
	const clipBottom = (node: Node): number => {
		let bottom = canvasBottom;
		for (
			let element: Element | null =
				node instanceof Element ? node : node.parentElement;
			element && element !== document.body;
			element = element.parentElement
		) {
			const style = getComputedStyle(element);
			const clamped =
				style.getPropertyValue("-webkit-line-clamp") !== "" &&
				style.getPropertyValue("-webkit-line-clamp") !== "none";
			if (style.overflowY !== "visible" && !clamped) {
				bottom = Math.min(bottom, element.getBoundingClientRect().bottom);
			}
		}
		return bottom;
	};
	const lists: Record<number, MeasuredList> = {};
	for (const unit of units) {
		const range = document.createRange();
		range.setStartAfter(unit.start);
		range.setEndBefore(unit.end);
		const rects = [...range.getClientRects()].filter(
			(rect) => rect.width > 0 || rect.height > 0,
		);
		if (rects.length === 0) continue;
		const list = lists[unit.list] ?? { units: 0, overflow: null };
		lists[unit.list] = list;
		list.units += 1;
		const bottom = Math.max(...rects.map((rect) => rect.bottom));
		const limit = clipBottom(range.commonAncestorContainer);
		if (
			bottom > limit + TOLERANCE_PX &&
			(list.overflow === null || unit.index < list.overflow)
		) {
			list.overflow = unit.index;
		}
	}
	return lists;
}
