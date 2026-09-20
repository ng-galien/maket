import {
	type Collection,
	collectionCursorKey,
	type PageCollectionCursor,
} from "@maket/shared";
import { X } from "lucide-react";
import { memo, useMemo } from "react";
import { useT } from "../i18n/useT";
import { displayWorkspaceCategorySegment } from "../lib/workspaceCategoryDisplay";
import type { Document } from "../store/types";
import type { DraftCursorOverride } from "../store/useStore";
import { useDocByName, useStore } from "../store/useStore";
import { type CollectionPagePreview, PageCanvas } from "./PageCanvas";
import {
	type PresentationDataSource,
	type PresentationSurface,
	presentationPolicy,
} from "./presentation-policy";

const PAGE_GAP = 12;
const DOCUMENT_LABEL_SCREEN_GAP = 8;
const DOCUMENT_LABEL_HORIZONTAL_PADDING = 24;
const DOCUMENT_LABEL_ITEM_GAP = 6;
const DOCUMENT_LABEL_CLOSE_WIDTH = 20;
const DOCUMENT_LABEL_PENDING_WIDTH = 18;
const DOCUMENT_LABEL_MIN_NAME_WIDTH = 24;
const DOCUMENT_LABEL_AVERAGE_CHARACTER_WIDTH = 8;
const DOCUMENT_LABEL_CLOSE_ONLY_WIDTH =
	DOCUMENT_LABEL_HORIZONTAL_PADDING + DOCUMENT_LABEL_CLOSE_WIDTH;
const DOCUMENT_LABEL_PENDING_THRESHOLD =
	DOCUMENT_LABEL_CLOSE_ONLY_WIDTH +
	DOCUMENT_LABEL_ITEM_GAP +
	DOCUMENT_LABEL_PENDING_WIDTH;

export interface PageView {
	key: string;
	pageIndex: number;
	collection: Collection | null;
	preview?: CollectionPagePreview;
	generatedLabel?: string;
}

interface PageViewEntry extends PageView {
	previewMode?: CollectionPagePreview["mode"];
	memberId?: string | null;
	memberIndex?: number;
	members?: readonly Collection["members"][number][];
}

interface PageLabels {
	page: string;
	row: string;
}

interface Props {
	docName: string;
	zoomK: number;
	showDocumentLabel?: boolean;
	showPageLabels?: boolean;
	surface?: PresentationSurface;
	dataSource?: PresentationDataSource;
}

export function collectionPageViews(
	doc: Document,
	collections: readonly Collection[],
	cursors: Record<string, PageCollectionCursor>,
	overrides: Record<string, DraftCursorOverride>,
	labels: PageLabels,
	surface: PresentationSurface = "canvas",
): PageView[] {
	const entries = doc.pages.flatMap<PageViewEntry>((page, pageIndex) => {
		const collectionName = page.collection?.name;
		const collection = collectionName
			? (collections.find((item) => item.name === page.collection?.name) ??
				null)
			: null;
		if (!collectionName) {
			const view: PageViewEntry = {
				key: page.id,
				pageIndex,
				collection: null,
			};
			return [view];
		}
		if (!collection)
			return surface === "reader"
				? []
				: [
						{
							key: page.id,
							pageIndex,
							collection: null,
						},
					];
		const members = sortedMembers(collection);
		if (surface === "reader") {
			return members.map<PageViewEntry>((member, memberIndex) => ({
				key: `${page.id}:${collection.name}:${member.id}`,
				pageIndex,
				collection,
				previewMode: "rendered",
				memberId: member.id,
				memberIndex,
				members,
				generatedLabel: `${page.name || labels.page} - ${labels.row} ${memberIndex + 1}`,
			}));
		}
		const key = collectionCursorKey(doc.name, pageIndex);
		const preview = previewStateFor(
			collection,
			withDraftOverride(cursors[key], overrides[key], members),
		);
		if (preview.mode === "all") {
			return members.map<PageViewEntry>((member, memberIndex) => ({
				key: `${page.id}:${collection.name}:${member.id}`,
				pageIndex,
				collection,
				previewMode: "rendered",
				memberId: member.id,
				memberIndex,
				members,
				generatedLabel: `${page.name || labels.page} - ${labels.row} ${memberIndex + 1}`,
			}));
		}
		const memberIndex = Math.max(
			0,
			members.findIndex((member) => member.id === preview.memberId),
		);
		const view: PageViewEntry = {
			key: page.id,
			pageIndex,
			collection,
			previewMode: preview.mode === "rendered" ? "rendered" : "template",
			memberId: preview.memberId,
			memberIndex,
			members,
		};
		return [view];
	});
	return entries.map((entry, outputIndex) =>
		pageViewFromEntry(entry, outputIndex, entries.length),
	);
}

/** A draft-only row being previewed locally replaces the server cursor's
 * member — the collection here is the drafts overlay, so it can render it. */
function withDraftOverride(
	cursor: PageCollectionCursor | undefined,
	override: DraftCursorOverride | undefined,
	members: Collection["members"],
): PageCollectionCursor | undefined {
	if (!cursor || !override) return cursor;
	return members.some((member) => member.id === override.memberId)
		? { ...cursor, memberId: override.memberId }
		: cursor;
}

function previewStateFor(
	collection: Collection,
	cursor: PageCollectionCursor | undefined,
): { mode: PageCollectionCursor["mode"]; memberId: string | null } {
	const members = sortedMembers(collection);
	const member = members.find((item) => item.id === cursor?.memberId);
	return {
		mode:
			cursor?.collection === collection.name
				? cursor.mode
				: members.length > 0
					? "rendered"
					: "template",
		memberId: member?.id ?? members[0]?.id ?? null,
	};
}

function pagePreview(
	mode: "template" | "rendered",
	memberId: string | null,
	memberIndex: number,
	members: readonly Collection["members"][number][],
	outputIndex: number,
	pageTotal: number,
): CollectionPagePreview {
	return {
		mode,
		memberId,
		memberNumber: Math.max(0, memberIndex) + 1,
		memberTotal: members.length,
		pageNumber: outputIndex + 1,
		pageTotal,
	};
}

function pageViewFromEntry(
	entry: PageViewEntry,
	outputIndex: number,
	pageTotal: number,
): PageView {
	return {
		key: entry.key,
		pageIndex: entry.pageIndex,
		collection: entry.collection,
		preview:
			entry.previewMode && entry.members
				? pagePreview(
						entry.previewMode,
						entry.memberId ?? null,
						entry.memberIndex ?? 0,
						entry.members,
						outputIndex,
						pageTotal,
					)
				: undefined,
		generatedLabel: entry.generatedLabel,
	};
}

function sortedMembers(collection: Collection): Collection["members"] {
	return [...collection.members].sort((a, b) => a.position - b.position);
}

export const WorkspaceDoc = memo(function WorkspaceDoc({
	docName,
	zoomK,
	showDocumentLabel = true,
	showPageLabels = true,
	surface = "canvas",
	dataSource = "connected",
}: Props) {
	const doc = useDocByName(docName);
	const charteCss = useStore((s) => s.chartesCss.get(docName) ?? "");
	const collections = useStore((s) => s.collections);
	const collectionDrafts = useStore((s) => s.collectionDrafts);
	const effectiveCollections = useMemo(
		() =>
			collections.map(
				(collection) => collectionDrafts[collection.name] ?? collection,
			),
		[collectionDrafts, collections],
	);
	const collectionCursors = useStore((s) => s.collectionCursors);
	const draftCursorOverrides = useStore((s) => s.draftCursorOverrides);
	const readOnly = useStore((s) => s.readOnly);
	const isFocused = useStore((s) => s.focusedDocName === docName);
	const focusedPageIndex = useStore((s) => s.focusedPageIndex);
	const documentLabelPosition = useStore((s) => s.documentLabelPosition);
	const t = useT();
	const pendingCount = useStore(
		(s) => s.pending.filter((m) => m.docName === docName).length,
	);
	const closeWorkspaceDocuments = useStore((s) => s.closeWorkspaceDocuments);
	const setFocused = useStore((s) => s.setFocusedDoc);
	const setFocusedPage = useStore((s) => s.setFocusedPage);
	const pageViews = useMemo(
		() =>
			doc
				? collectionPageViews(
						doc,
						surface === "reader" ? collections : effectiveCollections,
						collectionCursors,
						surface === "reader" ? {} : draftCursorOverrides,
						{
							page: t("page"),
							row: t("collection_row_lower"),
						},
						surface,
					)
				: [],
		[
			collections,
			effectiveCollections,
			collectionCursors,
			draftCursorOverrides,
			doc,
			surface,
			t,
		],
	);
	const missingReaderCollections = useMemo(
		() =>
			surface === "reader" && doc
				? doc.pages.flatMap((page) => {
						const name = page.collection?.name;
						return name && !collections.some((item) => item.name === name)
							? [name]
							: [];
					})
				: [],
		[collections, doc, surface],
	);
	const policy = useMemo(
		() =>
			presentationPolicy({
				surface,
				dataSource,
				access:
					surface === "reader" && dataSource === "static"
						? "read-only"
						: doc?.meta?.locked
							? "locked"
							: readOnly
								? "read-only"
								: "writable",
			}),
		[dataSource, doc?.meta?.locked, readOnly, surface],
	);

	if (!doc) return null;

	const docWidthPx = doc.canvas.w * 3.78;
	const safeZoomK = Math.max(zoomK, 0.1);
	const labelScale = 1 / safeZoomK;
	const documentScreenWidth = docWidthPx * safeZoomK;
	const labelWidth = Math.max(
		documentScreenWidth,
		DOCUMENT_LABEL_CLOSE_ONLY_WIDTH,
	);
	const labelMargin = DOCUMENT_LABEL_SCREEN_GAP / safeZoomK - PAGE_GAP;
	const showPendingCount =
		pendingCount > 0 && labelWidth >= DOCUMENT_LABEL_PENDING_THRESHOLD;
	const labelControlsWidth =
		DOCUMENT_LABEL_CLOSE_WIDTH +
		(showPendingCount
			? DOCUMENT_LABEL_ITEM_GAP + DOCUMENT_LABEL_PENDING_WIDTH
			: 0);
	const labelNameMaxWidth = Math.max(
		0,
		labelWidth -
			DOCUMENT_LABEL_HORIZONTAL_PADDING -
			labelControlsWidth -
			DOCUMENT_LABEL_ITEM_GAP,
	);
	const showLabelName = labelNameMaxWidth >= DOCUMENT_LABEL_MIN_NAME_WIDTH;
	const categoryBreadcrumb = doc.category
		?.split("/")
		.filter(Boolean)
		.map((segment) =>
			displayWorkspaceCategorySegment(segment, t("structured_workspaces")),
		)
		.join(" / ");
	const fullLabel = categoryBreadcrumb
		? `${categoryBreadcrumb} / ${doc.name}`
		: doc.name;
	const labelText =
		fullLabel.length * DOCUMENT_LABEL_AVERAGE_CHARACTER_WIDTH <=
		labelNameMaxWidth
			? fullLabel
			: doc.name;

	return (
		<div
			data-doc={docName}
			onClick={() => setFocused(docName)}
			className={`flex flex-col items-center shrink-0 ${surface === "reader" ? "select-text" : "select-none"}`}
			style={{ gap: PAGE_GAP }}
		>
			{missingReaderCollections.map((name) => (
				<div
					key={name}
					role="status"
					className="rounded-xl bg-panel px-4 py-3 text-sm text-text-2"
				>
					{t("reader_missing_collection", { name })}
				</div>
			))}
			{surface === "reader" &&
				pageViews.length === 0 &&
				missingReaderCollections.length === 0 && (
					<div
						role="status"
						className="rounded-xl bg-panel px-4 py-3 text-sm text-text-2"
					>
						{t("reader_empty_collection")}
					</div>
				)}
			{pageViews.map((view, outputIndex) => (
				<div
					key={view.key}
					data-page-view={view.pageIndex}
					data-reader-page-index={
						surface === "reader" ? outputIndex : undefined
					}
					data-active-page={
						surface === "canvas" &&
						isFocused &&
						view.pageIndex === focusedPageIndex
							? "true"
							: undefined
					}
					onClick={() => setFocusedPage(docName, view.pageIndex)}
					className="flex flex-col items-center"
				>
					<PageCanvas
						doc={doc}
						pageIndex={view.pageIndex}
						charteCss={charteCss}
						focused={isFocused}
						collection={view.collection}
						preview={view.preview}
						policy={policy}
					/>
					{showPageLabels && (doc.pages.length > 1 || view.generatedLabel) && (
						<span
							className="text-text-3 mt-1"
							style={{
								fontSize: `${11 / Math.max(zoomK, 0.1)}px`,
								transformOrigin: "top center",
							}}
						>
							{view.generatedLabel ??
								doc.pages[view.pageIndex]?.name ??
								`${view.pageIndex + 1} / ${doc.pages.length}`}
						</span>
					)}
				</div>
			))}

			{showDocumentLabel && (
				<div
					className="doc-label pointer-events-none relative flex justify-center"
					data-position={documentLabelPosition}
					style={{
						width: docWidthPx,
						order: documentLabelPosition === "top" ? -1 : undefined,
						marginTop:
							documentLabelPosition === "bottom" ? labelMargin : undefined,
						marginBottom:
							documentLabelPosition === "top" ? labelMargin : undefined,
						transform: `scale(${labelScale})`,
						transformOrigin:
							documentLabelPosition === "top" ? "bottom center" : "top center",
					}}
				>
					<div
						className={`pointer-events-auto flex shrink-0 items-center justify-center gap-1.5 px-3 py-1 rounded-xl whitespace-nowrap overflow-hidden transition-colors ${
							isFocused ? "bg-accent-soft" : "bg-black/[0.03]"
						}`}
						style={{ width: labelWidth }}
					>
						{showLabelName && (
							<span
								className={`doc-label-name min-w-0 shrink text-base overflow-hidden ${isFocused ? "font-bold text-accent" : "font-medium text-text-2"}`}
								style={{ maxWidth: labelNameMaxWidth }}
							>
								{labelText}
							</span>
						)}
						{showPendingCount && (
							<span
								title={t("pending_count", { count: pendingCount })}
								className="text-2xs font-bold text-accent-contrast bg-accent rounded-full px-1.5 py-px min-w-[18px] text-center shrink-0"
							>
								{pendingCount}
							</span>
						)}
						<button
							type="button"
							title={t("close")}
							aria-label={t("close")}
							onClick={(e) => {
								e.stopPropagation();
								closeWorkspaceDocuments([docName]);
							}}
							className="doc-close-btn w-5 h-5 rounded-md flex items-center justify-center text-text-3 p-0 border-none bg-transparent cursor-pointer shrink-0"
						>
							<X size={12} />
						</button>
					</div>
					<div className="doc-tooltip">
						<div className="font-semibold text-sm">{doc.name}</div>
						<div className="text-2xs text-text-3 mt-0.5">
							{doc.canvas.format} {doc.canvas.orientation} · {doc.canvas.w}×
							{doc.canvas.h}mm ·{" "}
							{t(
								doc.pages.length > 1
									? "doc_page_count_many"
									: "doc_page_count_one",
								{ count: doc.pages.length },
							)}
						</div>
						{pendingCount > 0 && (
							<div className="text-2xs text-text-3 mt-0.5">
								{t("pending_count", { count: pendingCount })}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
});
