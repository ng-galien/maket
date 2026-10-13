import { BookOpen, MousePointer2, Pin, Scan, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useT } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { sendPinDoc } from "../store/ws";
import { AnnotationToggle } from "./AnnotationToggle";
import {
	fitReadingDocument,
	type ReaderFit,
	ReaderSurface,
	scrollToReadingPage,
} from "./ReadingWorkspace";
import { ResizeHandleFeedback } from "./shared/ResizeHandleFeedback";
import { collectionPageViews } from "./WorkspaceDoc";

type StoreState = ReturnType<typeof useStore.getState>;

const DEFAULT_INDEX_RATIO = 28;
const SPLIT_RATIO_KEY = "maket-structured-reader-split-ratio";

export function selectStructuredCollectionNavigation(state: StoreState) {
	const focused = state.docs.get(state.focusedDocName ?? "");
	const ownership = focused?.meta?.structuredWorkspace;
	if (!ownership || ownership.role === "template") return null;
	const workspace = state.structuredWorkspaces.find(
		(candidate) => candidate.id === ownership.workspaceId,
	);
	if (workspace?.integrity.status !== "ready") return null;
	const index = workspace.collectionDocuments.find(
		(candidate) => candidate.collectionId === ownership.collectionId,
	);
	if (!index) return null;
	const item = workspace.items.find(
		(candidate) =>
			candidate.collectionId === index.collectionId &&
			state.workspaceDocNames.includes(candidate.documentName),
	);
	return {
		indexName: index.documentName,
		index: state.docs.get(index.documentName),
		item: item ? state.docs.get(item.documentName) : undefined,
	};
}

/** A collection is a navigation context, not a growing board of documents. */
export function StructuredCollectionWorkspace() {
	const navigation = useStore(useShallow(selectStructuredCollectionNavigation));
	const layout = useStore((state) => state.structuredWorkspaceLayout);
	const close = useStore((state) => state.closeWorkspaceDocuments);
	const t = useT();
	const gridRef = useRef<HTMLDivElement>(null);
	const [ratio, setRatio] = useState(() => {
		const saved = Number(localStorage.getItem(SPLIT_RATIO_KEY));
		return saved >= 20 && saved <= 80 ? saved : DEFAULT_INDEX_RATIO;
	});
	const resize = (value: number) => {
		const bounded = Math.max(20, Math.min(80, value));
		setRatio(bounded);
		localStorage.setItem(SPLIT_RATIO_KEY, String(bounded));
	};
	if (!navigation) return null;
	const split = layout === "split";
	return (
		<div
			data-structured-navigation
			data-layout={split ? "split" : "single"}
			className="absolute inset-0 flex min-h-0 flex-col"
		>
			<div
				ref={gridRef}
				className="relative grid min-h-0 flex-1"
				style={{
					gridTemplateColumns: split
						? `${ratio}% minmax(0, 1fr)`
						: "minmax(0, 1fr)",
				}}
			>
				<section
					data-structured-index-pane
					aria-label={t("structured_navigation_index")}
					className={`relative min-h-0 min-w-0 ${split ? "border-r border-border" : ""} ${navigation.item && !split ? "hidden" : ""}`}
				>
					{navigation.index && (
						<CollectionDocument
							key={navigation.index.id}
							doc={navigation.index}
							fit={split ? "fill" : "shrink"}
						/>
					)}
				</section>
				{split && (
					<CollectionSplitHandle
						ratio={ratio}
						resize={resize}
						gridRef={gridRef}
					/>
				)}
				{(split || navigation.item) && (
					<section
						data-structured-item-pane
						aria-label={t("structured_navigation_item")}
						className="relative min-h-0 min-w-0"
					>
						{navigation.item ? (
							<CollectionDocument
								key={navigation.item.id}
								doc={navigation.item}
								fit={split ? "fill" : "shrink"}
								onClose={() => close([navigation.item?.name ?? ""])}
							/>
						) : (
							<div className="flex h-full items-center justify-center p-6 text-center text-sm text-text-3">
								{t("structured_navigation_select_item")}
							</div>
						)}
					</section>
				)}
			</div>
		</div>
	);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// This pane is the connected UI adapter: it binds store cursors and commands
// to ReaderSurface, which owns rendering, scrolling and gesture behavior.
function CollectionDocument({
	doc,
	fit,
	onClose,
}: {
	doc: Document;
	fit: ReaderFit;
	onClose?: () => void;
}) {
	const t = useT();
	const [zoom, setZoom] = useState(1);
	const [canvasNavigation, setCanvasNavigation] = useState(false);
	const setFocusedDoc = useStore((state) => state.setFocusedDoc);
	const setFocusedPage = useStore((state) => state.setFocusedPage);
	const focusedPageIndex = useStore((state) =>
		state.focusedDocName === doc.name ? state.focusedPageIndex : doc.activePage,
	);
	const collections = useStore((state) => state.collections);
	const pageLabel = t("page");
	const rowLabel = t("collection_row_lower");
	const pageViews = useMemo(
		() =>
			collectionPageViews(
				doc,
				collections,
				{},
				{},
				{ page: pageLabel, row: rowLabel },
				"reader",
			),
		[doc, collections, pageLabel, rowLabel],
	);
	const rememberVisiblePage = useCallback(
		(_logicalIndex: number, sourcePageIndex: number) =>
			setFocusedPage(doc.name, sourcePageIndex, { focus: false }),
		[doc.name, setFocusedPage],
	);
	const readOnly = useStore((state) => state.readOnly);
	const pinned = useStore((state) =>
		state.structuredWorkspaces.some((workspace) =>
			workspace.items.some(
				(item) => item.documentName === doc.name && item.pinnedAt,
			),
		),
	);
	return (
		<div
			onPointerDownCapture={() => setFocusedDoc(doc.name)}
			data-collection-document-mode={canvasNavigation ? "canvas" : "reader"}
			className="flex h-full min-h-0 flex-col"
		>
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel px-3 text-sm">
				<div className="flex min-w-0 items-center gap-1">
					<span className="min-w-0 truncate font-semibold" title={doc.name}>
						{doc.name}
					</span>
					{onClose && (
						<button
							type="button"
							onClick={onClose}
							aria-label={t("structured_item_close", { document: doc.name })}
							className="grid h-7 w-7 shrink-0 place-items-center rounded text-text-2 hover:bg-input"
						>
							<X size={15} />
						</button>
					)}
					{onClose && !readOnly && (
						<button
							type="button"
							aria-label={t(pinned ? "unpin_document" : "pin_document", {
								name: doc.name,
							})}
							aria-pressed={pinned}
							onClick={() => sendPinDoc(doc.name, !pinned)}
							className={`grid h-7 w-7 shrink-0 place-items-center rounded hover:bg-input ${pinned ? "text-accent" : "text-text-2"}`}
						>
							<Pin size={15} fill={pinned ? "currentColor" : "none"} />
						</button>
					)}
				</div>
				{onClose && <AnnotationToggle doc={doc} />}
				<button
					type="button"
					onClick={() => {
						setCanvasNavigation(!canvasNavigation);
						fitReadingDocument(doc.name);
					}}
					aria-label={t(canvasNavigation ? "reading_view" : "canvas_view")}
					title={t(canvasNavigation ? "reading_view" : "canvas_view")}
					className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded text-text-2 hover:bg-input"
				>
					{canvasNavigation ? (
						<BookOpen size={15} />
					) : (
						<MousePointer2 size={15} />
					)}
				</button>
				<button
					type="button"
					onClick={() => fitReadingDocument(doc.name)}
					aria-label={`${t("fit")} — ${Math.round(zoom * 100)}%`}
					title={t("fit")}
					className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded px-1.5 text-xs tabular-nums text-text-3 hover:bg-input hover:text-text-1"
				>
					<span>{Math.round(zoom * 100)}%</span>
					<Scan size={14} />
				</button>
			</div>
			<div className="relative min-h-0 flex-1" style={{ contain: "layout" }}>
				<ReaderSurface
					doc={doc}
					dataSource="connected"
					canvasNavigation={canvasNavigation}
					zoomControls={false}
					rememberZoom={false}
					fit={fit}
					onZoomChange={setZoom}
					initialPageIndex={Math.max(
						0,
						pageViews.findIndex((view) => view.pageIndex === focusedPageIndex),
					)}
					onVisiblePage={rememberVisiblePage}
					onNavigatePage={(index) => {
						setFocusedPage(doc.name, pageViews[index]?.pageIndex ?? 0);
						scrollToReadingPage(doc.name, index, "auto");
					}}
				/>
			</div>
		</div>
	);
}

function CollectionSplitHandle({
	ratio,
	resize,
	gridRef,
}: {
	ratio: number;
	resize: (ratio: number) => void;
	gridRef: React.RefObject<HTMLDivElement | null>;
}) {
	const t = useT();
	const [dragging, setDragging] = useState(false);
	return (
		<div
			role="separator"
			tabIndex={0}
			aria-orientation="vertical"
			aria-label={t("structured_navigation_resize")}
			aria-valuemin={20}
			aria-valuemax={80}
			aria-valuenow={Math.round(ratio)}
			className="group/resize absolute inset-y-0 z-20 flex w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center outline-none focus-visible:bg-accent-soft"
			style={{ left: `${ratio}%` }}
			onDoubleClick={() => resize(DEFAULT_INDEX_RATIO)}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				setDragging(true);
			}}
			onPointerMove={(event) => {
				if (!dragging || !gridRef.current) return;
				const bounds = gridRef.current.getBoundingClientRect();
				resize(((event.clientX - bounds.left) / bounds.width) * 100);
			}}
			onPointerUp={(event) => {
				setDragging(false);
				if (event.currentTarget.hasPointerCapture(event.pointerId))
					event.currentTarget.releasePointerCapture(event.pointerId);
			}}
			onPointerCancel={() => setDragging(false)}
			onLostPointerCapture={() => setDragging(false)}
			onKeyDown={(event) => {
				if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
					event.preventDefault();
					resize(ratio + (event.key === "ArrowLeft" ? -2 : 2));
				} else if (event.key === "Home" || event.key === "End") {
					event.preventDefault();
					resize(event.key === "Home" ? 20 : 80);
				}
			}}
		>
			<ResizeHandleFeedback orientation="vertical" active={dragging} />
		</div>
	);
}
