import { parsePageLink, resolvePageLink } from "@maket/shared";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { fitToDoc } from "../store/zoomBridge";

/** DOM event a page canvas dispatches when a page link is followed. A
 * surface that owns page navigation (Reader, viewer) handles it and calls
 * `preventDefault()`; otherwise the Canvas follows it with
 * `followCanvasPageLink`. */
export const PAGE_LINK_EVENT = "maket:page-link";

export interface PageLinkRequest {
	docName: string;
	/** 0-based index in `doc.pages`. */
	pageIndex: number;
}

export type PageLinkEvent = CustomEvent<PageLinkRequest>;

/** Source page targeted by a followed link inside `target`, or `undefined`
 * when `target` is not inside a page link. `null` means a page link whose
 * page does not exist. */
export function pageLinkTarget(
	target: EventTarget | null,
	doc: Pick<Document, "pages">,
): number | null | undefined {
	if (!(target instanceof Element)) return undefined;
	if (target.closest("[contenteditable='true']")) return undefined;
	const link = target.closest("a[href], area[href]");
	const parsed = parsePageLink(link?.getAttribute("href"));
	if (!parsed) return undefined;
	return resolvePageLink(parsed, doc.pages);
}

/** Dispatch the request from `origin`; true when a surface handled it. */
export function dispatchPageLink(
	origin: Element,
	request: PageLinkRequest,
): boolean {
	const event = new CustomEvent<PageLinkRequest>(PAGE_LINK_EVENT, {
		bubbles: true,
		cancelable: true,
		detail: request,
	});
	return !origin.dispatchEvent(event);
}

/** In the authoring Canvas a plain click selects the link for editing; the
 * platform command modifier (⌘ on Apple platforms, Ctrl elsewhere) follows
 * it. */
export function followsPageLinkWhileAuthoring(
	event: Pick<MouseEvent, "metaKey" | "ctrlKey">,
): boolean {
	const platform =
		(typeof navigator !== "undefined" &&
			(navigator.platform || navigator.userAgent)) ||
		"";
	return /Mac|iPhone|iPad|iPod/i.test(platform) ? event.metaKey : event.ctrlKey;
}

/** A followed link is an explicit command: focus the target page and fit the
 * view on it once. With automatic recentering on, the focus change already
 * fits it; otherwise the immediate fit does. */
export function followCanvasPageLink({
	docName,
	pageIndex,
}: PageLinkRequest): void {
	const state = useStore.getState();
	const focusChanges =
		state.focusedDocName !== docName || state.focusedPageIndex !== pageIndex;
	state.setFocusedPage(docName, pageIndex);
	if (!focusChanges || !state.autoFocusFit) fitToDoc(docName, pageIndex);
}
