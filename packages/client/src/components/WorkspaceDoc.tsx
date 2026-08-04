import {
	type Collection,
	collectionCursorKey,
	type PageCollectionCursor,
} from "@maket/shared";
import { History, X } from "lucide-react";
import { memo, useMemo } from "react";
import { useT } from "../i18n/useT";
import type { DraftCursorOverride } from "../store/useStore";
import { useDocByName, useStore } from "../store/useStore";
import { type CollectionPagePreview, PageCanvas } from "./PageCanvas";
import { DraftPill } from "./shared/DraftPill";

const PAGE_GAP = 12;

interface PageView {
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
}

function collectionPageViews(
	doc: NonNullable<ReturnType<typeof useDocByName>>,
	collections: readonly Collection[],
	cursors: Record<string, PageCollectionCursor>,
	overrides: Record<string, DraftCursorOverride>,
	labels: PageLabels,
): PageView[] {
	const entries = doc.pages.flatMap<PageViewEntry>((page, pageIndex) => {
		const collection = page.collection?.name
			? (collections.find((item) => item.name === page.collection?.name) ??
				null)
			: null;
		if (!page.collection?.name || !collection) {
			const view: PageViewEntry = {
				key: page.id,
				pageIndex,
				collection: null,
			};
			return [view];
		}
		const members = sortedMembers(collection);
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
		mode: cursor?.collection === collection.name ? cursor.mode : "template",
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
	const isFocused = useStore((s) => s.focusedDocName === docName);
	const focusedPageIndex = useStore((s) => s.focusedPageIndex);
	const t = useT();
	const pendingCount = useStore(
		(s) => s.pending.filter((m) => m.docName === docName).length,
	);
	const removeDoc = useStore((s) => s.removeDocFromWorkspace);
	const setFocused = useStore((s) => s.setFocusedDoc);
	const setFocusedPage = useStore((s) => s.setFocusedPage);
	const pageViews = useMemo(
		() =>
			doc
				? collectionPageViews(
						doc,
						effectiveCollections,
						collectionCursors,
						draftCursorOverrides,
						{
							page: t("page"),
							row: t("collection_row_lower"),
						},
					)
				: [],
		[effectiveCollections, collectionCursors, draftCursorOverrides, doc, t],
	);

	if (!doc) return null;

	const docWidthPx = doc.canvas.w * 3.78;
	const labelScale = 1 / Math.max(zoomK, 0.1);
	// Chip tracks the doc's on-screen width, but never below a readable floor
	// (a narrow doc at far zoom would crush the name span to 0px) and never
	// above the doc's natural width (the floor must not balloon tiny docs).
	const labelMaxWidth = Math.min(
		docWidthPx,
		Math.max(160, docWidthPx / labelScale),
	);

	return (
		<div
			data-doc={docName}
			onClick={() => setFocused(docName)}
			className="flex flex-col items-center shrink-0 select-none"
			style={{ gap: PAGE_GAP }}
		>
			{pageViews.map((view) => (
				<div
					key={view.key}
					data-page-view={view.pageIndex}
					data-active-page={
						isFocused && view.pageIndex === focusedPageIndex
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
					/>
					{(doc.pages.length > 1 || view.generatedLabel) && (
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

			<div
				className="doc-label relative"
				style={{
					transform: `scale(${labelScale})`,
					transformOrigin: "top center",
				}}
			>
				<div
					className={`flex items-center gap-1.5 px-3 py-1 rounded-xl whitespace-nowrap overflow-hidden transition-colors ${
						isFocused ? "bg-accent-soft" : "bg-black/[0.03]"
					}`}
					style={{ maxWidth: labelMaxWidth }}
				>
					{isFocused && (
						<div className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
					)}
					<span
						className={`doc-label-name text-base overflow-hidden ${isFocused ? "font-bold text-accent" : "font-medium text-text-2"}`}
					>
						{doc.name}
					</span>
					<span className="text-2xs text-text-3 shrink-0">
						{doc.canvas.format} · {doc.pages.length}p
					</span>
					{doc.dataModel === "state" && (
						<span
							title={t("state_document_read_only")}
							className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-2xs font-bold text-accent shrink-0"
						>
							<History size={10} />
							{t("state_document_badge")}
						</span>
					)}
					{doc.meta?.emailDraftUrl && (
						<DraftPill
							kind={
								doc.meta?.emailDraftRole === "attachment"
									? "attachment"
									: "body"
							}
							url={doc.meta.emailDraftUrl}
						/>
					)}
					{pendingCount > 0 && (
						<span className="text-2xs font-bold text-white bg-accent rounded-full px-1.5 py-px min-w-[18px] text-center shrink-0">
							{pendingCount}
						</span>
					)}
					<button
						type="button"
						title={t("close")}
						aria-label={t("close")}
						onClick={(e) => {
							e.stopPropagation();
							removeDoc(docName);
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
						{doc.canvas.h}mm · {doc.pages.length} page
						{doc.pages.length > 1 ? "s" : ""}
					</div>
				</div>
			</div>
		</div>
	);
});
