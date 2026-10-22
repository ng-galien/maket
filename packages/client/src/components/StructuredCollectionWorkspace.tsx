import {
	ArrowLeft,
	BookOpen,
	MousePointer2,
	Pin,
	Scan,
	Search,
	X,
} from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useT } from "../i18n/useT";
import { useMobileReader } from "../lib/mobileReader";
import type { Document } from "../store/types";
import { structuredWindowKey, useStore } from "../store/useStore";
import {
	sendPinDoc,
	sendStructuredCollectionMore,
	sendStructuredCollectionQuery,
} from "../store/ws";
import { AnnotationToggle } from "./AnnotationToggle";
import {
	fitReadingDocument,
	type ReaderFit,
	ReaderSurface,
	scrollToReadingPage,
	useReadingOffsetMemory,
} from "./ReadingWorkspace";
import { ResizeHandleFeedback } from "./shared/ResizeHandleFeedback";
import { collectionPageViews } from "./WorkspaceDoc";

type StoreState = ReturnType<typeof useStore.getState>;

/** Below this pane width, preserve the desktop preference but show one readable pane. */
const COLLECTION_SPLIT_MIN_WIDTH = 900;
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
	const item = state.mobileReading
		? ownership.role === "item"
			? focused?.name
			: undefined
		: state.workspaceDocNames.find((name) => {
				const owner = state.docs.get(name)?.meta?.structuredWorkspace;
				return (
					owner?.role === "item" &&
					owner.workspaceId === workspace.id &&
					owner.collectionId === index.collectionId
				);
			});
	return {
		workspaceId: workspace.id,
		collectionId: index.collectionId,
		indexName: index.documentName,
		index: state.docs.get(index.documentName),
		item: item ? state.docs.get(item) : undefined,
	};
}

/** A collection is a navigation context, not a growing board of documents. */
export function StructuredCollectionWorkspace() {
	const navigation = useStore(useShallow(selectStructuredCollectionNavigation));
	const mobileReader = useMobileReader();
	const layout = useStore((state) => state.structuredWorkspaceLayout);
	const close = useStore((state) => state.closeWorkspaceDocuments);
	const t = useT();
	const gridRef = useRef<HTMLDivElement>(null);
	const [narrow, setNarrow] = useState(
		window.innerWidth - 56 < COLLECTION_SPLIT_MIN_WIDTH,
	);
	useLayoutEffect(() => {
		const grid = gridRef.current;
		if (!grid) return;
		const measure = () =>
			setNarrow(grid.clientWidth < COLLECTION_SPLIT_MIN_WIDTH);
		measure();
		const observer =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(measure);
		observer?.observe(grid);
		window.addEventListener("resize", measure);
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, [navigation?.workspaceId]);
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
	const split = layout === "split" && !narrow && !mobileReader;
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
							collection={{
								workspaceId: navigation.workspaceId,
								collectionId: navigation.collectionId,
							}}
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
								onClose={() =>
									mobileReader
										? useStore
												.getState()
												.openWorkspaceDocument(navigation.indexName, {
													workspaceId: navigation.workspaceId,
													collectionId: navigation.collectionId,
												})
										: close([navigation.item?.name ?? ""])
								}
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
	collection,
}: {
	doc: Document;
	fit: ReaderFit;
	onClose?: () => void;
	/** The collection whose window this index renders. */
	collection?: { workspaceId: string; collectionId: string };
}) {
	const t = useT();
	const mobileReader = useMobileReader();
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
	const readingPageIndex = Math.max(
		0,
		pageViews.findIndex((view) => view.pageIndex === focusedPageIndex),
	);
	const { initialPageOffset, onReadingOffset } = useReadingOffsetMemory(
		doc.name,
	);
	const rememberVisiblePage = useCallback(
		(_logicalIndex: number, sourcePageIndex: number) =>
			setFocusedPage(doc.name, sourcePageIndex, { focus: false }),
		[doc.name, setFocusedPage],
	);
	const readOnly = useStore((state) => state.readOnly);
	const pinned = useStore((state) =>
		state.structuredWorkspaces.some((workspace) =>
			workspace.pinnedItems.some((item) => item.documentName === doc.name),
		),
	);
	return (
		<div
			onPointerDownCapture={() => setFocusedDoc(doc.name)}
			data-collection-document-mode={
				!mobileReader && canvasNavigation ? "canvas" : "reader"
			}
			className="flex h-full min-h-0 flex-col"
		>
			<div
				data-collection-toolbar
				className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel px-3 text-sm"
			>
				<div className="flex min-w-0 items-center gap-1">
					<span
						data-collection-document-title
						className="min-w-0 truncate font-semibold"
						title={doc.name}
					>
						{doc.name}
					</span>
					{onClose && (
						<button
							type="button"
							onClick={onClose}
							aria-label={
								mobileReader
									? t("mobile_back_to_list")
									: t("structured_item_close", { document: doc.name })
							}
							className="grid h-7 w-7 shrink-0 place-items-center rounded text-text-2 hover:bg-input"
						>
							{mobileReader ? <ArrowLeft size={20} /> : <X size={15} />}
						</button>
					)}
					{onClose && !readOnly && !mobileReader && (
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
				{onClose && !mobileReader && <AnnotationToggle doc={doc} />}
				{!mobileReader && (
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
				)}
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
			{collection && <CollectionWindowSearch {...collection} />}
			<div className="relative min-h-0 flex-1" style={{ contain: "layout" }}>
				<ReaderSurface
					doc={doc}
					dataSource="connected"
					canvasNavigation={!mobileReader && canvasNavigation}
					zoomControls={mobileReader}
					rememberZoom={false}
					fit={fit}
					onZoomChange={setZoom}
					initialPageIndex={readingPageIndex}
					readingMemory={{
						initialPageOffset,
						pageIndex: readingPageIndex,
						onOffset: onReadingOffset,
					}}
					onVisiblePage={rememberVisiblePage}
					onNavigatePage={(index) => {
						setFocusedPage(doc.name, pageViews[index]?.pageIndex ?? 0);
						scrollToReadingPage(doc.name, index, "auto");
					}}
				/>
			</div>
			{collection && <CollectionWindowMore {...collection} />}
		</div>
	);
}

function useCollectionWindow(workspaceId: string, collectionId: string) {
	return useStore(
		(state) =>
			state.structuredWindows[structuredWindowKey(workspaceId, collectionId)],
	);
}

/** The search of the collection window: applied on Enter and when cleared;
 * the server answers every client with the first batch. */
function CollectionWindowSearch({
	workspaceId,
	collectionId,
}: {
	workspaceId: string;
	collectionId: string;
}) {
	const t = useT();
	const held = useCollectionWindow(workspaceId, collectionId);
	const applied = held?.query.text ?? "";
	const [text, setText] = useState(applied);
	const [heldApplied, setHeldApplied] = useState(applied);
	if (applied !== heldApplied) {
		setHeldApplied(applied);
		setText(applied);
	}
	const apply = (value: string) =>
		sendStructuredCollectionQuery(workspaceId, collectionId, value);
	return (
		<div
			data-structured-index-search
			className="flex shrink-0 items-center gap-2 border-b border-border bg-panel px-3 py-1.5 text-sm"
		>
			<div className="relative min-w-0 flex-1">
				<Search
					size={14}
					aria-hidden
					className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3"
				/>
				<input
					type="search"
					value={text}
					onChange={(event) => {
						setText(event.target.value);
						if (event.target.value === "" && applied !== "") apply("");
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") apply(text);
						if (event.key === "Escape" && text !== "") {
							setText("");
							if (applied !== "") apply("");
						}
					}}
					placeholder={t("structured_index_search")}
					aria-label={t("structured_index_search")}
					className="h-8 w-full rounded-md border border-border bg-input pl-8 pr-8 text-sm text-text-1 outline-none transition focus:border-accent"
				/>
				{text && (
					<button
						type="button"
						onClick={() => {
							setText("");
							if (applied !== "") apply("");
						}}
						aria-label={t("structured_index_search_clear")}
						className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-panel hover:text-text-1"
					>
						<X size={13} />
					</button>
				)}
			</div>
			{held?.total !== undefined && (
				<span
					data-structured-index-count
					aria-live="polite"
					className="shrink-0 text-xs tabular-nums text-text-3"
				>
					{t("structured_index_count", {
						shown: held.items.length,
						total: held.total,
					})}
				</span>
			)}
		</div>
	);
}

/** Extends the collection window with the batch after its cursor. */
function CollectionWindowMore({
	workspaceId,
	collectionId,
}: {
	workspaceId: string;
	collectionId: string;
}) {
	const t = useT();
	const next = useCollectionWindow(workspaceId, collectionId)?.next;
	if (next === undefined) return null;
	return (
		<div className="flex shrink-0 justify-center border-t border-border bg-panel px-3 py-1.5">
			<button
				type="button"
				data-structured-index-more
				onClick={() =>
					sendStructuredCollectionMore(workspaceId, collectionId, next)
				}
				className="h-8 rounded-md px-3 text-sm text-accent hover:bg-input"
			>
				{t("structured_index_load_more")}
			</button>
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
