import { Check, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import type {
	FocusEvent as ReactFocusEvent,
	KeyboardEvent as ReactKeyboardEvent,
	ReactNode,
	RefObject,
} from "react";
import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useT } from "../i18n/useT";
import { exitReadingSession } from "../store/readingSession";
import type { Document } from "../store/types";
import { useFocusedDoc, useStore } from "../store/useStore";
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
				barPosition="top"
				initialPageIndex={model.initialReaderPageIndex}
				onVisiblePage={model.onVisiblePage}
			/>
			<ReaderBar model={model.bar} />
		</div>
	);
}

interface ReaderBarModel {
	position: "top" | "bottom";
	documents: DocumentPickerItem[];
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
	const setFocusedDoc = useStore((state) => state.setFocusedDoc);
	const setFocusedPage = useStore((state) => state.setFocusedPage);
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
		exitReadingSession();
	}, []);
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
	const documents = workspaceDocNames.flatMap((name) => {
		const workspaceDoc = docs.get(name);
		return workspaceDoc
			? [{ name: workspaceDoc.name, category: workspaceDoc.category }]
			: [];
	});
	return {
		doc,
		initialReaderPageIndex,
		onVisiblePage: handleVisiblePage,
		bar: {
			position: "top",
			documents,
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
			? "pt-16 pb-6 sm:pt-20 sm:pb-8"
			: "pt-6 pb-16 sm:pt-8 sm:pb-20"
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
	const documentNames = model.documents.map((document) => document.name);
	const documentIndex = documentNames.indexOf(model.docName);
	return (
		<nav
			aria-label={t("reader_navigation")}
			className={`fixed left-1/2 z-[var(--z-bar)] flex h-12 w-[calc(100%-1rem)] max-w-max -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border/80 bg-panel/95 p-1 shadow-[0_10px_30px_rgba(0,0,0,0.12)] backdrop-blur-lg sm:w-auto ${model.position === "top" ? "top-[max(0.5rem,env(safe-area-inset-top))]" : "bottom-[max(0.5rem,env(safe-area-inset-bottom))]"}`}
		>
			<ReaderButton
				label={t("previous_document")}
				disabled={documentIndex <= 0}
				className="hidden sm:flex"
				onClick={() =>
					model.onDocumentChange(
						documentNames[documentIndex - 1] ?? model.docName,
					)
				}
			>
				<ChevronLeft size={17} />
			</ReaderButton>
			<ReaderDocumentPicker
				documents={model.documents}
				docName={model.docName}
				position={model.position}
				onDocumentChange={model.onDocumentChange}
				className="min-w-0 flex-1 sm:w-[clamp(13rem,28vw,19rem)] sm:flex-none"
			/>
			<ReaderButton
				label={t("next_document")}
				disabled={
					documentIndex < 0 || documentIndex >= documentNames.length - 1
				}
				onClick={() =>
					model.onDocumentChange(
						documentNames[documentIndex + 1] ?? model.docName,
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
			<div className="mx-0.5 hidden h-6 w-px shrink-0 bg-border sm:block" />
			<ReaderButton label={t("close_reader")} onClick={model.onExit}>
				<X size={17} strokeWidth={1.8} />
			</ReaderButton>
		</nav>
	);
}

export function ReaderDocumentPicker({
	documents,
	docName,
	position,
	onDocumentChange,
	onCloseDocument,
	onCloseAll,
	className = "",
	title,
	variant = "reader",
}: {
	documents: DocumentPickerItem[];
	docName: string;
	position: "top" | "bottom";
	onDocumentChange: (name: string) => void;
	onCloseDocument?: (name: string) => void;
	onCloseAll?: () => void;
	className?: string;
	title?: string;
	variant?: "reader" | "header";
}) {
	const t = useT();
	const documentNames = documents.map((document) => document.name);
	const model = useReaderDocumentPicker({
		documentNames,
		docName,
		onDocumentChange,
	});
	return (
		<div
			ref={model.rootRef}
			className={`relative ${className}`}
			onBlur={model.closeOnBlur}
		>
			<button
				ref={model.triggerRef}
				type="button"
				title={title}
				aria-label={t("reader_document")}
				aria-haspopup="listbox"
				aria-expanded={model.open}
				aria-controls={model.open ? model.listboxId : undefined}
				onClick={model.toggle}
				onKeyDown={model.onTriggerKeyDown}
				className={
					variant === "header"
						? "group flex h-6 max-w-full min-w-0 items-center gap-1 rounded-sm text-left text-base font-semibold text-text-1 outline-none transition-colors duration-100 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/30"
						: "group flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md border border-transparent bg-input/70 px-3 text-left text-sm font-semibold text-text-1 outline-none transition-[background-color,border-color,box-shadow] duration-150 hover:border-border hover:bg-input focus-visible:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent/30"
				}
			>
				<span className="min-w-0 flex-1 truncate">{docName}</span>
				<ChevronDown
					size={variant === "header" ? 14 : 16}
					strokeWidth={2}
					className={`shrink-0 text-text-3 transition-transform duration-150 group-hover:text-text-2 ${model.open ? "rotate-180" : ""}`}
				/>
			</button>
			{model.open && (
				<ReaderDocumentList
					model={model}
					documents={documents}
					docName={docName}
					position={position}
					label={t("reader_document")}
					variant={variant}
					onCloseDocument={onCloseDocument}
					onCloseAll={onCloseAll}
				/>
			)}
		</div>
	);
}

export interface DocumentPickerItem {
	name: string;
	category: string;
}

interface ReaderDocumentPickerModel {
	open: boolean;
	activeIndex: number;
	listboxId: string;
	rootRef: RefObject<HTMLDivElement | null>;
	triggerRef: RefObject<HTMLButtonElement | null>;
	optionRefs: RefObject<Array<HTMLButtonElement | null>>;
	toggle: () => void;
	closeOnBlur: (event: ReactFocusEvent<HTMLDivElement>) => void;
	onTriggerKeyDown: (event: ReactKeyboardEvent) => void;
	onOptionKeyDown: (event: ReactKeyboardEvent, index: number) => void;
	choose: (name: string) => void;
}

function useReaderDocumentPicker({
	documentNames,
	docName,
	onDocumentChange,
}: {
	documentNames: string[];
	docName: string;
	onDocumentChange: (name: string) => void;
}): ReaderDocumentPickerModel {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const typeaheadRef = useRef<{ query: string; timer: number | null }>({
		query: "",
		timer: null,
	});
	const listboxId = useId();
	const selectedIndex = Math.max(0, documentNames.indexOf(docName));
	const [activeIndex, setActiveIndex] = useState(selectedIndex);

	useEffect(() => setOpen(false), [docName]);
	useEffect(() => {
		if (open) return;
		const state = typeaheadRef.current;
		state.query = "";
		if (state.timer !== null) window.clearTimeout(state.timer);
		state.timer = null;
	}, [open]);
	useEffect(
		() => () => {
			if (typeaheadRef.current.timer !== null) {
				window.clearTimeout(typeaheadRef.current.timer);
			}
		},
		[],
	);
	useEffect(() => {
		if (!open) return;
		const closeOutside = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("pointerdown", closeOutside);
		return () => document.removeEventListener("pointerdown", closeOutside);
	}, [open]);
	useEffect(() => {
		if (!open) return;
		setActiveIndex(selectedIndex);
		optionRefs.current[selectedIndex]?.focus();
	}, [open, selectedIndex]);

	const closeAndFocus = () => {
		setOpen(false);
		requestAnimationFrame(() => triggerRef.current?.focus());
	};
	const choose = (name: string) => {
		onDocumentChange(name);
		closeAndFocus();
	};
	const moveFocus = (index: number) => {
		const bounded = Math.max(0, Math.min(documentNames.length - 1, index));
		setActiveIndex(bounded);
		optionRefs.current[bounded]?.focus();
	};
	const typeahead = (event: ReactKeyboardEvent, fromIndex: number) => {
		if (
			documentNames.length === 0 ||
			event.key.length !== 1 ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey
		) {
			return false;
		}
		const state = typeaheadRef.current;
		state.query += event.key.toLocaleLowerCase();
		if (state.timer !== null) window.clearTimeout(state.timer);
		state.timer = window.setTimeout(() => {
			state.query = "";
			state.timer = null;
		}, 500);
		const orderedIndexes = documentNames.map(
			(_, offset) => (fromIndex + offset + 1) % documentNames.length,
		);
		const match = orderedIndexes.find((index) =>
			documentNames[index]?.toLocaleLowerCase().startsWith(state.query),
		);
		if (match === undefined) return true;
		event.preventDefault();
		setOpen(true);
		setActiveIndex(match);
		if (open) optionRefs.current[match]?.focus();
		else requestAnimationFrame(() => optionRefs.current[match]?.focus());
		return true;
	};
	return {
		open,
		activeIndex,
		listboxId,
		rootRef,
		triggerRef,
		optionRefs,
		toggle: () => setOpen((value) => !value),
		closeOnBlur: (event) => {
			if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
		},
		onTriggerKeyDown: (event) => {
			if (event.key === "Tab") {
				setOpen(false);
				return;
			}
			if (typeahead(event, selectedIndex)) return;
			if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
			event.preventDefault();
			setOpen(true);
		},
		onOptionKeyDown: (event, index) => {
			if (typeahead(event, index)) return;
			if (event.key === "ArrowDown") moveFocus(index + 1);
			else if (event.key === "ArrowUp") moveFocus(index - 1);
			else if (event.key === "Home") moveFocus(0);
			else if (event.key === "End") moveFocus(documentNames.length - 1);
			else if (event.key === "Escape") closeAndFocus();
			else if (event.key === "Tab") {
				setOpen(false);
				return;
			} else return;
			event.preventDefault();
		},
		choose,
	};
}

interface ReaderDocumentListProps {
	model: ReaderDocumentPickerModel;
	documents: DocumentPickerItem[];
	docName: string;
	position: "top" | "bottom";
	label: string;
	variant: "reader" | "header";
	onCloseDocument?: (name: string) => void;
	onCloseAll?: () => void;
}

function ReaderDocumentList(props: ReaderDocumentListProps) {
	const {
		model,
		documents,
		docName,
		position,
		label,
		variant,
		onCloseDocument,
		onCloseAll,
	} = props;
	const t = useT();
	return (
		<div
			data-reader-menu
			className={`absolute left-0 z-[var(--z-popover)] min-w-full w-[min(22rem,calc(100vw-1rem))] overflow-hidden border border-border bg-panel shadow-[0_18px_56px_rgba(0,0,0,0.2)] ${
				variant === "header" ? "rounded-lg p-1" : "rounded-xl p-1.5"
			} ${
				position === "top"
					? variant === "header"
						? "top-full mt-2"
						: "top-full mt-2"
					: "bottom-full mb-2"
			}`}
			style={{ animation: "popoverIn 140ms cubic-bezier(0.16, 1, 0.3, 1)" }}
		>
			<div className="flex items-center justify-between gap-4 border-b border-border px-2.5 py-2">
				<span className="text-sm font-semibold text-text-1">
					{t("open_documents_title")}
				</span>
				<div className="flex shrink-0 items-center gap-2">
					<span className="text-xs text-text-3">
						{t("open_documents_summary", { count: documents.length })}
					</span>
					{onCloseAll && (
						<button
							type="button"
							onClick={onCloseAll}
							className="rounded-sm px-1.5 py-1 text-xs font-medium text-text-2 transition-colors hover:bg-input hover:text-text-1"
						>
							{t("close_all_documents")}
						</button>
					)}
				</div>
			</div>
			<div
				id={model.listboxId}
				role="listbox"
				aria-label={label}
				className="max-h-72 overflow-y-auto py-1"
			>
				{documents.map((document, index) => {
					const { name, category } = document;
					const selected = name === docName;
					const categoryId = `${model.listboxId}-category-${index}`;
					return (
						<div key={name} className="group/document relative">
							<button
								ref={(element) => {
									model.optionRefs.current[index] = element;
								}}
								type="button"
								role="option"
								aria-selected={selected}
								aria-label={name}
								aria-describedby={categoryId}
								tabIndex={index === model.activeIndex ? 0 : -1}
								onClick={() => model.choose(name)}
								onKeyDown={(event) => model.onOptionKeyDown(event, index)}
								className={`relative flex min-h-12 w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors ${onCloseDocument ? "pr-10" : ""} ${selected ? "bg-accent-soft text-text-1" : "text-text-2 hover:bg-input focus-visible:bg-input focus-visible:text-text-1"}`}
							>
								{selected && (
									<span className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-accent" />
								)}
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm font-semibold text-text-1">
										{name}
									</span>
									<span
										id={categoryId}
										className="mt-0.5 block truncate text-xs text-text-3"
									>
										{documentCategoryLabel(category)}
									</span>
								</span>
								{selected && !onCloseDocument && (
									<Check size={16} className="shrink-0 text-accent" />
								)}
							</button>
							{onCloseDocument && (
								<button
									type="button"
									onClick={() => onCloseDocument(name)}
									aria-label={t("close_document", { name })}
									title={t("close_document", { name })}
									className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-text-3 opacity-70 transition-colors hover:bg-black/[0.05] hover:text-text-1 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/30 group-hover/document:opacity-100"
								>
									<X size={14} strokeWidth={1.75} />
								</button>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function documentCategoryLabel(category: string): string {
	return ["Maket", ...category.split("/").filter(Boolean)].join(" / ");
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
		<div className="flex shrink-0 items-center rounded-md bg-input/55 p-0.5">
			<ReaderButton
				label={`${t("previous_page")} — ${pageLabel}`}
				disabled={pageIndex <= 0 || pageTotal === 0}
				onClick={() => onPageChange(pageIndex - 1)}
			>
				<ChevronLeft size={16} />
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
				<ChevronRight size={16} />
			</ReaderButton>
		</div>
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
			className={`size-9 shrink-0 items-center justify-center rounded-md text-text-3 transition-[background-color,color,opacity] hover:bg-input hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-25 disabled:hover:bg-transparent ${className || "flex"}`}
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
