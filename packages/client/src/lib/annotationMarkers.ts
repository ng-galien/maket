import type { PendingMessage } from "../store/useStore";

export interface AnnotationTarget {
	elementId: string;
	note: boolean;
	deletion: boolean;
}

export interface ElementBox {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

/** Pending notes and deletions anchored to elements of one page, one target
 * per element. A message without a page index belongs to the first page. */
export function pendingAnnotationTargets(
	pending: readonly PendingMessage[],
	docName: string,
	pageIndex: number,
): AnnotationTarget[] {
	const byElement = new Map<string, AnnotationTarget>();
	for (const message of pending) {
		if (
			message.docName !== docName ||
			(message.pageIndex ?? 0) !== pageIndex ||
			!message.elementId ||
			(message.type !== "note" && message.type !== "delete")
		)
			continue;
		const target = byElement.get(message.elementId) ?? {
			elementId: message.elementId,
			note: false,
			deletion: false,
		};
		if (message.type === "note") target.note = true;
		if (message.type === "delete") target.deletion = true;
		byElement.set(message.elementId, target);
	}
	return [...byElement.values()];
}

/** Number of pending messages on one document. */
export function pendingMessageCount(
	pending: readonly PendingMessage[],
	docName: string,
): number {
	return pending.filter((message) => message.docName === docName).length;
}

function hasArea(box: ElementBox): boolean {
	return box.width > 0 && box.height > 0;
}

function union(boxes: ElementBox[]): ElementBox | null {
	if (boxes.length === 0) return null;
	const left = Math.min(...boxes.map((box) => box.left));
	const top = Math.min(...boxes.map((box) => box.top));
	const right = Math.max(...boxes.map((box) => box.right));
	const bottom = Math.max(...boxes.map((box) => box.bottom));
	return {
		left,
		top,
		right,
		bottom,
		width: right - left,
		height: bottom - top,
	};
}

function textBox(node: Text): ElementBox | null {
	if (!node.data.trim() || typeof document.createRange !== "function")
		return null;
	const range = document.createRange();
	range.selectNodeContents(node);
	if (typeof range.getBoundingClientRect !== "function") return null;
	const rect = range.getBoundingClientRect();
	return hasArea(rect) ? rect : null;
}

function boxWithArea(element: Element): ElementBox | null {
	const rect = element.getBoundingClientRect();
	if (hasArea(rect)) return rect;
	const parts: ElementBox[] = [];
	for (const child of element.childNodes) {
		const box =
			child.nodeType === Node.ELEMENT_NODE
				? boxWithArea(child as Element)
				: child.nodeType === Node.TEXT_NODE
					? textBox(child as Text)
					: null;
		if (box) parts.push(box);
	}
	return union(parts);
}

/**
 * Viewport box of an element. An element without an area of its own
 * (`display: contents`, such as the field rows of a generated detail
 * template, or a flat block around an absolutely positioned child) takes
 * the union of the boxes of its content.
 */
export function elementBox(element: Element): ElementBox {
	return boxWithArea(element) ?? element.getBoundingClientRect();
}

/** The box of an element as {@link elementBox}. Without any area, the union
 * of the boxes of the element and its descendants that are rendered; null
 * when none is (`display: none`, or no box and only whitespace). */
export function renderedElementBox(element: Element): ElementBox | null {
	const box = boxWithArea(element);
	if (box) return box;
	return union(
		[element, ...element.querySelectorAll("*")]
			.filter((candidate) => candidate.getClientRects().length > 0)
			.map((candidate) => candidate.getBoundingClientRect()),
	);
}
