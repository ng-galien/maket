import type { RefObject } from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { Document } from "../store/types";
import { useFocusedDoc, useStore } from "../store/useStore";
import { requestFit } from "../store/zoomBridge";
import { WorkspaceDoc } from "./WorkspaceDoc";

const CSS_PX_PER_MM = 96 / 25.4;
const MIN_GUTTER = 12;
const WIDE_GUTTER = 24;

export function readingScale(
	viewportWidth: number,
	canvasWidthMm: number,
): number {
	const gutter = viewportWidth < 640 ? MIN_GUTTER : WIDE_GUTTER;
	const available = Math.max(1, viewportWidth - gutter * 2);
	return Math.min(1, available / (canvasWidthMm * CSS_PX_PER_MM));
}

export function ReadingWorkspace() {
	const doc = useFocusedDoc();
	const focusedPageIndex = useStore((state) => state.focusedPageIndex);
	const barPosition = useStore((state) => state.barPosition);
	const setFocusedPage = useStore((state) => state.setFocusedPage);
	const setWorkspaceView = useStore((state) => state.setWorkspaceView);
	const scrollRef = useRef<HTMLDivElement>(null);
	const initiallyPositionedDoc = useRef<string | null>(null);
	const [scale, setScale] = useState(1);

	const measure = useCallback(() => {
		if (!doc || !scrollRef.current) return;
		setScale(readingScale(scrollRef.current.clientWidth, doc.canvas.w));
	}, [doc]);

	useLayoutEffect(() => {
		measure();
		const element = scrollRef.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [measure]);

	useLayoutEffect(() => {
		if (!doc || initiallyPositionedDoc.current === doc.name) return;
		const frame = requestAnimationFrame(() => {
			initiallyPositionedDoc.current = doc.name;
			scrollToReadingPage(doc.name, focusedPageIndex, "auto");
		});
		return () => cancelAnimationFrame(frame);
	}, [doc, focusedPageIndex]);

	useVisiblePage({ doc, rootRef: scrollRef, setFocusedPage });
	useReadingKeyboard(doc, setWorkspaceView);

	if (!doc) return null;

	return (
		<div
			ref={scrollRef}
			data-reading-workspace
			data-bar-position={barPosition}
			className={`absolute inset-0 overflow-x-hidden overflow-y-auto bg-[var(--color-app)] px-3 sm:px-6 ${
				barPosition === "top"
					? "pt-20 pb-6 sm:pt-24 sm:pb-8"
					: "pt-6 pb-20 sm:pt-8 sm:pb-24"
			}`}
		>
			<div className="mx-auto flex min-h-full w-full justify-center">
				<div style={{ zoom: scale }}>
					<WorkspaceDoc
						docName={doc.name}
						zoomK={1}
						showDocumentLabel={false}
					/>
				</div>
			</div>
		</div>
	);
}

function useVisiblePage({
	doc,
	rootRef,
	setFocusedPage,
}: {
	doc: Document | null;
	rootRef: RefObject<HTMLDivElement | null>;
	setFocusedPage: (docName: string, pageIndex: number) => void;
}) {
	useEffect(() => {
		const root = rootRef.current;
		if (!doc || !root || typeof IntersectionObserver === "undefined") return;
		const pages = readingPageElements(root, doc.name);
		const ratios = new Map<Element, number>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					ratios.set(
						entry.target,
						entry.isIntersecting ? entry.intersectionRatio : 0,
					);
				}
				const visible = [...ratios.entries()].sort((a, b) => b[1] - a[1])[0];
				if (!visible || visible[1] <= 0) return;
				const pageIndex = Number((visible[0] as HTMLElement).dataset.pageView);
				if (Number.isInteger(pageIndex)) setFocusedPage(doc.name, pageIndex);
			},
			{ root, threshold: [0.15, 0.35, 0.55, 0.75] },
		);
		for (const page of pages) observer.observe(page);
		return () => observer.disconnect();
	}, [doc, rootRef, setFocusedPage]);
}

function useReadingKeyboard(
	doc: Document | null,
	setWorkspaceView: (view: "canvas" | "reading") => void,
) {
	useEffect(() => {
		if (!doc) return;
		const onKeyDown = (event: KeyboardEvent) => {
			const state = useStore.getState();
			if (
				readingShortcutBlocked(
					event.target,
					state.editingElementId,
					state.showPopover,
				)
			)
				return;
			let nextPage: number | null = null;
			switch (event.key) {
				case "PageUp":
					nextPage = Math.max(0, state.focusedPageIndex - 1);
					break;
				case "PageDown":
					nextPage = Math.min(doc.pages.length - 1, state.focusedPageIndex + 1);
					break;
				case "Home":
					nextPage = 0;
					break;
				case "End":
					nextPage = doc.pages.length - 1;
					break;
				case "Escape":
					event.preventDefault();
					returnToCanvas(doc.name, state.focusedPageIndex, setWorkspaceView);
					return;
				default:
					return;
			}
			event.preventDefault();
			state.setFocusedPage(doc.name, nextPage);
			requestAnimationFrame(() =>
				scrollToReadingPage(doc.name, nextPage, "smooth"),
			);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [doc, setWorkspaceView]);
}

export function readingShortcutBlocked(
	target: EventTarget | null,
	editingElementId: string | null,
	showPopover: boolean,
): boolean {
	if (editingElementId || showPopover) return true;
	return (
		target instanceof Element &&
		Boolean(
			target.closest(
				"input, textarea, select, [contenteditable='true'], [role='dialog'], [role='listbox']",
			),
		)
	);
}

function readingPageElements(root: ParentNode, docName: string): HTMLElement[] {
	return [
		...root.querySelectorAll<HTMLElement>("[data-doc] [data-page-view]"),
	].filter(
		(element) =>
			element.closest<HTMLElement>("[data-doc]")?.dataset.doc === docName,
	);
}

export function scrollToReadingPage(
	docName: string,
	pageIndex: number,
	behavior: ScrollBehavior = "smooth",
): void {
	const root = document.querySelector<HTMLElement>("[data-reading-workspace]");
	const page = root
		? readingPageElements(root, docName).find(
				(element) => Number(element.dataset.pageView) === pageIndex,
			)
		: undefined;
	if (page && typeof page.scrollIntoView === "function") {
		page.scrollIntoView({ behavior, block: "start" });
	}
}

export function returnToCanvas(
	docName: string,
	pageIndex: number,
	setWorkspaceView: (view: "canvas" | "reading") => void,
): void {
	setWorkspaceView("canvas");
	requestFit({ docName, pageIndex });
}
