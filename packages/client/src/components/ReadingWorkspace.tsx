import { ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useT } from "../i18n/useT";
import type { Document } from "../store/types";
import { useFocusedDoc, useStore } from "../store/useStore";
import { requestFit } from "../store/zoomBridge";
import type { PresentationDataSource } from "./presentation-policy";
import {
	collectionPageViews,
	type PageView,
	WorkspaceDoc,
} from "./WorkspaceDoc";

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
	const model = useConnectedReaderModel();
	if (!model) return null;
	return (
		<div className="relative h-full w-full">
			<ReaderSurface
				key={model.doc.name}
				doc={model.doc}
				dataSource="connected"
				barPosition={model.barPosition}
				initialPageIndex={model.initialReaderPageIndex}
				onVisiblePage={model.onVisiblePage}
			/>
			<ReaderBar model={model.bar} />
		</div>
	);
}

interface ReaderBarModel {
	position: "top" | "bottom";
	documentNames: string[];
	docName: string;
	pageIndex: number;
	pageTotal: number;
	pageLabel: string;
	onDocumentChange: (name: string) => void;
	onPageChange: (pageIndex: number) => void;
	onExit: () => void;
}

interface ConnectedReaderModel {
	doc: Document;
	barPosition: "top" | "bottom";
	initialReaderPageIndex: number;
	onVisiblePage: (logicalIndex: number, sourcePageIndex: number) => void;
	bar: ReaderBarModel;
}

// code-moniker: ignore[smell-feature-envy-local]
// This hook is the connected Reader shell adapter: it composes Zustand selectors and navigation commands while ReaderSurface owns presentation.
function useConnectedReaderModel(): ConnectedReaderModel | null {
	const doc = useFocusedDoc();
	const collections = useStore((state) => state.collections);
	const workspaceDocNames = useStore((state) => state.workspaceDocNames);
	const docs = useStore((state) => state.docs);
	const focusedPageIndex = useStore((state) => state.focusedPageIndex);
	const barPosition = useStore((state) => state.barPosition);
	const setFocusedDoc = useStore((state) => state.setFocusedDoc);
	const setFocusedPage = useStore((state) => state.setFocusedPage);
	const setWorkspaceView = useStore((state) => state.setWorkspaceView);
	const t = useT();
	const pageLabel = t("page");
	const rowLabel = t("collection_row_lower");
	const pageViews = useMemo(
		() =>
			doc
				? collectionPageViews(
						doc,
						collections,
						{},
						{},
						{ page: pageLabel, row: rowLabel },
						"reader",
					)
				: [],
		[collections, doc, pageLabel, rowLabel],
	);
	const initialReaderPageIndex = Math.max(
		0,
		pageViews.findIndex((view) => view.pageIndex === focusedPageIndex),
	);
	const [readerPageIndex, setReaderPageIndex] = useState(
		initialReaderPageIndex,
	);

	useEffect(() => {
		const firstMatchingPage = pageViews.findIndex(
			(view) => view.pageIndex === focusedPageIndex,
		);
		setReaderPageIndex(Math.max(0, firstMatchingPage));
	}, [doc?.name, focusedPageIndex, pageViews]);

	const showReaderPage = useCallback(
		(logicalIndex: number, behavior: ScrollBehavior = "smooth") => {
			if (!doc || pageViews.length === 0) return;
			const nextIndex = Math.max(
				0,
				Math.min(pageViews.length - 1, logicalIndex),
			);
			const sourcePageIndex = pageViews[nextIndex]?.pageIndex ?? 0;
			setReaderPageIndex(nextIndex);
			setFocusedPage(doc.name, sourcePageIndex);
			requestAnimationFrame(() =>
				scrollToReadingPage(doc.name, nextIndex, preferredScroll(behavior)),
			);
		},
		[doc, pageViews, setFocusedPage],
	);

	const returnToCanvasView = useCallback(() => {
		if (!doc) return;
		returnToCanvas(
			doc.name,
			pageViews[readerPageIndex]?.pageIndex ?? focusedPageIndex,
			setWorkspaceView,
		);
	}, [doc, focusedPageIndex, pageViews, readerPageIndex, setWorkspaceView]);
	const handleVisiblePage = useCallback(
		(logicalIndex: number, sourcePageIndex: number) => {
			if (!doc) return;
			setReaderPageIndex(logicalIndex);
			setFocusedPage(doc.name, sourcePageIndex);
		},
		[doc, setFocusedPage],
	);

	useReadingKeyboard({
		pageCount: pageViews.length,
		pageIndex: readerPageIndex,
		onPageChange: showReaderPage,
		onExit: returnToCanvasView,
	});

	if (!doc) return null;
	const documentNames = workspaceDocNames.filter((name) => docs.has(name));
	return {
		doc,
		barPosition,
		initialReaderPageIndex,
		onVisiblePage: handleVisiblePage,
		bar: {
			position: barPosition,
			documentNames,
			docName: doc.name,
			pageIndex: readerPageIndex,
			pageTotal: pageViews.length,
			pageLabel: readerPageName(
				doc,
				pageViews[readerPageIndex],
				readerPageIndex,
				t("reader_empty_collection"),
			),
			onDocumentChange: setFocusedDoc,
			onPageChange: showReaderPage,
			onExit: returnToCanvasView,
		},
	};
}

export function ReaderSurface({
	doc,
	dataSource,
	embedded = false,
	barPosition,
	initialPageIndex = 0,
	onVisiblePage,
	status,
}: {
	doc: Document;
	dataSource: PresentationDataSource;
	embedded?: boolean;
	barPosition?: "top" | "bottom";
	initialPageIndex?: number;
	onVisiblePage?: (logicalIndex: number, sourcePageIndex: number) => void;
	status?: ReactNode;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const initiallyPositioned = useRef(false);
	const [scale, setScale] = useState(1);

	const measure = useCallback(() => {
		if (!scrollRef.current) return;
		setScale(readingScale(scrollRef.current.clientWidth, doc.canvas.w));
	}, [doc.canvas.w]);

	useLayoutEffect(() => {
		measure();
		const element = scrollRef.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [measure]);

	useLayoutEffect(() => {
		if (initiallyPositioned.current) return;
		const frame = requestAnimationFrame(() => {
			initiallyPositioned.current = true;
			scrollToReadingPage(doc.name, initialPageIndex, "auto");
		});
		return () => cancelAnimationFrame(frame);
	}, [doc.name, initialPageIndex]);

	useVisiblePage({ doc, rootRef: scrollRef, onVisiblePage });

	const toolbarClearance = barPosition
		? barPosition === "top"
			? "pt-20 pb-6 sm:pt-24 sm:pb-8"
			: "pt-6 pb-20 sm:pt-8 sm:pb-24"
		: embedded
			? "py-0"
			: "py-6 sm:py-8";

	return (
		<div
			ref={scrollRef}
			data-reading-workspace
			data-reader-appearance={embedded ? "embed" : "app"}
			data-bar-position={barPosition}
			className={`absolute inset-0 overflow-x-hidden overflow-y-auto ${embedded ? "bg-transparent px-0" : "bg-[var(--color-app)] px-3 sm:px-6"} ${toolbarClearance}`}
		>
			{status}
			<div className="mx-auto flex min-h-full w-full justify-center">
				<div style={{ zoom: scale }}>
					<WorkspaceDoc
						docName={doc.name}
						zoomK={1}
						showDocumentLabel={false}
						showPageLabels={false}
						surface="reader"
						dataSource={dataSource}
					/>
				</div>
			</div>
		</div>
	);
}

function ReaderBar({ model }: { model: ReaderBarModel }) {
	const t = useT();
	const documentIndex = model.documentNames.indexOf(model.docName);
	return (
		<nav
			aria-label={t("reader_navigation")}
			className={`fixed left-1/2 z-[var(--z-bar)] flex h-12 w-[min(100%-1rem,720px)] -translate-x-1/2 items-center gap-1 rounded-full bg-panel px-1.5 shadow-lg ${model.position === "top" ? "top-[max(0.5rem,env(safe-area-inset-top))]" : "bottom-[max(0.5rem,env(safe-area-inset-bottom))]"}`}
		>
			<ReaderButton label={t("canvas_view")} onClick={model.onExit}>
				<LayoutGrid size={17} />
			</ReaderButton>
			<ReaderButton
				label={t("previous_document")}
				disabled={documentIndex <= 0}
				className="hidden sm:flex"
				onClick={() =>
					model.onDocumentChange(
						model.documentNames[documentIndex - 1] ?? model.docName,
					)
				}
			>
				<ChevronLeft size={17} />
			</ReaderButton>
			<label className="sr-only" htmlFor="reader-document">
				{t("reader_document")}
			</label>
			<select
				id="reader-document"
				value={model.docName}
				onChange={(event) => model.onDocumentChange(event.target.value)}
				className="h-11 min-w-0 flex-1 truncate rounded-full bg-input px-3 text-sm font-semibold text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
			>
				{model.documentNames.map((name) => (
					<option key={name} value={name}>
						{name}
					</option>
				))}
			</select>
			<ReaderButton
				label={t("next_document")}
				disabled={
					documentIndex < 0 || documentIndex >= model.documentNames.length - 1
				}
				onClick={() =>
					model.onDocumentChange(
						model.documentNames[documentIndex + 1] ?? model.docName,
					)
				}
				className="hidden sm:flex"
			>
				<ChevronRight size={17} />
			</ReaderButton>
			<div className="mx-0.5 h-6 w-px shrink-0 bg-border" />
			<ReaderPageControls
				pageIndex={model.pageIndex}
				pageTotal={model.pageTotal}
				pageLabel={model.pageLabel}
				onPageChange={model.onPageChange}
			/>
		</nav>
	);
}

export function ReaderPageControls({
	pageIndex,
	pageTotal,
	pageLabel,
	onPageChange,
}: {
	pageIndex: number;
	pageTotal: number;
	pageLabel: string;
	onPageChange: (pageIndex: number) => void;
}) {
	const t = useT();
	const current = pageTotal === 0 ? 0 : Math.min(pageIndex + 1, pageTotal);
	return (
		<>
			<ReaderButton
				label={`${t("previous_page")} — ${pageLabel}`}
				disabled={pageIndex <= 0 || pageTotal === 0}
				onClick={() => onPageChange(pageIndex - 1)}
			>
				<ChevronLeft size={17} />
			</ReaderButton>
			<span
				role="status"
				className="min-w-12 text-center text-xs font-semibold tabular-nums text-text-2"
				aria-live="polite"
			>
				<span className="sr-only">{pageLabel}, </span>
				{current}/{pageTotal}
			</span>
			<ReaderButton
				label={`${t("next_page")} — ${pageLabel}`}
				disabled={pageTotal === 0 || pageIndex >= pageTotal - 1}
				onClick={() => onPageChange(pageIndex + 1)}
			>
				<ChevronRight size={17} />
			</ReaderButton>
		</>
	);
}

export function readerPageName(
	doc: Document,
	view: PageView | undefined,
	logicalIndex: number,
	emptyLabel: string,
): string {
	if (!view) return emptyLabel;
	return (
		view.generatedLabel ??
		doc.pages[view.pageIndex]?.name ??
		`${logicalIndex + 1}`
	);
}

function ReaderButton({
	label,
	disabled = false,
	onClick,
	children,
	className = "",
}: {
	label: string;
	disabled?: boolean;
	onClick: () => void;
	children: ReactNode;
	className?: string;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className={`size-11 shrink-0 items-center justify-center rounded-full text-text-3 transition-colors hover:bg-input hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30 disabled:hover:bg-transparent ${className || "flex"}`}
		>
			{children}
		</button>
	);
}

function useVisiblePage({
	doc,
	rootRef,
	onVisiblePage,
}: {
	doc: Document;
	rootRef: RefObject<HTMLDivElement | null>;
	onVisiblePage?: (logicalIndex: number, sourcePageIndex: number) => void;
}) {
	useEffect(() => {
		const root = rootRef.current;
		if (!root || !onVisiblePage || typeof IntersectionObserver === "undefined")
			return;
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
				const element = visible[0] as HTMLElement;
				const logicalIndex = Number(element.dataset.readerPageIndex);
				const sourcePageIndex = Number(element.dataset.pageView);
				if (
					Number.isInteger(logicalIndex) &&
					Number.isInteger(sourcePageIndex)
				) {
					onVisiblePage(logicalIndex, sourcePageIndex);
				}
			},
			{ root, threshold: [0.15, 0.35, 0.55, 0.75] },
		);
		for (const page of pages) observer.observe(page);
		return () => observer.disconnect();
	}, [doc.name, onVisiblePage, rootRef]);
}

export function useReadingKeyboard({
	pageCount,
	pageIndex,
	onPageChange,
	onExit,
}: {
	pageCount: number;
	pageIndex: number;
	onPageChange: (pageIndex: number) => void;
	onExit?: () => void;
}) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (readingShortcutBlocked(event.target)) return;
			let nextPage: number | null = null;
			switch (event.key) {
				case "PageUp":
					if (pageCount === 0) return;
					nextPage = Math.max(0, pageIndex - 1);
					break;
				case "PageDown":
					if (pageCount === 0) return;
					nextPage = Math.min(pageCount - 1, pageIndex + 1);
					break;
				case "Home":
					if (pageCount === 0) return;
					nextPage = 0;
					break;
				case "End":
					if (pageCount === 0) return;
					nextPage = Math.max(0, pageCount - 1);
					break;
				case "Escape":
					if (!onExit) return;
					event.preventDefault();
					onExit();
					return;
				default:
					return;
			}
			event.preventDefault();
			onPageChange(nextPage);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onExit, onPageChange, pageCount, pageIndex]);
}

export function readingShortcutBlocked(target: EventTarget | null): boolean {
	return (
		target instanceof Element &&
		Boolean(
			target.closest(
				"input, textarea, select, button, a, [contenteditable='true'], [role='dialog'], [role='listbox']",
			),
		)
	);
}

function readingPageElements(root: ParentNode, docName: string): HTMLElement[] {
	return [
		...root.querySelectorAll<HTMLElement>(
			"[data-doc] [data-reader-page-index]",
		),
	].filter(
		(element) =>
			element.closest<HTMLElement>("[data-doc]")?.dataset.doc === docName,
	);
}

export function scrollToReadingPage(
	docName: string,
	logicalPageIndex: number,
	behavior: ScrollBehavior = "smooth",
): void {
	const root = document.querySelector<HTMLElement>("[data-reading-workspace]");
	const page = root
		? readingPageElements(root, docName).find(
				(element) =>
					Number(element.dataset.readerPageIndex) === logicalPageIndex,
			)
		: undefined;
	if (page && typeof page.scrollIntoView === "function") {
		page.scrollIntoView({ behavior, block: "start" });
	}
}

export function preferredScroll(behavior: ScrollBehavior): ScrollBehavior {
	if (behavior !== "smooth") return behavior;
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches
		? "auto"
		: "smooth";
}

export function returnToCanvas(
	docName: string,
	pageIndex: number,
	setWorkspaceView: (view: "canvas" | "reading") => void,
): void {
	setWorkspaceView("canvas");
	requestFit({ docName, pageIndex });
}
