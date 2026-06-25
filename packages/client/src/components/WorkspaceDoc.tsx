import type { Collection } from "@maket/shared";
import {
	ChevronLeft,
	ChevronRight,
	Code2,
	Database,
	Eye,
	FileStack,
	X,
} from "lucide-react";
import { memo, useMemo } from "react";
import { useT } from "../i18n/useT";
import type {
	CollectionPreviewMode,
	CollectionPreviewState,
} from "../store/useStore";
import { useDocByName, useStore } from "../store/useStore";
import { wsSend } from "../store/ws";
import { type CollectionPagePreview, PageCanvas } from "./PageCanvas";
import { DraftPill } from "./shared/DraftPill";

const PAGE_GAP = 12;

interface PageCollectionControlsData {
	collection: Collection | null;
	preview: CollectionPreviewState;
	memberPosition: number | null;
}

interface PageView {
	key: string;
	pageIndex: number;
	collection: Collection | null;
	preview?: CollectionPagePreview;
	generatedLabel?: string;
	controls?: PageCollectionControlsData;
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
	previewByCollection: Record<string, CollectionPreviewState>,
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
				controls:
					collections.length > 0
						? {
								collection: null,
								preview: { mode: "template", memberId: null },
								memberPosition: null,
							}
						: undefined,
			};
			return [view];
		}
		const members = sortedMembers(collection);
		const preview = previewStateFor(collection, previewByCollection);
		const controls = {
			collection,
			preview,
			memberPosition: memberPosition(members, preview.memberId),
		};
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
				controls: memberIndex === 0 ? controls : undefined,
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
			controls,
		};
		return [view];
	});
	return entries.map((entry, outputIndex) =>
		pageViewFromEntry(entry, outputIndex, entries.length),
	);
}

function previewStateFor(
	collection: Collection,
	previewByCollection: Record<string, CollectionPreviewState>,
): CollectionPreviewState {
	const preview = previewByCollection[collection.name];
	const members = sortedMembers(collection);
	const member = members.find((item) => item.id === preview?.memberId);
	return {
		mode: preview?.mode ?? "template",
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
		controls: entry.controls,
	};
}

function memberPosition(
	members: readonly Collection["members"][number][],
	memberId: string | null,
): number | null {
	const index = members.findIndex((member) => member.id === memberId);
	return index >= 0 ? index + 1 : null;
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
	const collectionPreview = useStore((s) => s.collectionPreview);
	const setPreviewMode = useStore((s) => s.setCollectionPreviewMode);
	const setPreviewMember = useStore((s) => s.setCollectionPreviewMember);
	const movePreviewMember = useStore((s) => s.moveCollectionPreviewMember);
	const openCollection = useStore((s) => s.setFocusedCollection);
	const isFocused = useStore((s) => s.focusedDocName === docName);
	const t = useT();
	const pendingCount = useStore(
		(s) => s.pending.filter((m) => m.docName === docName).length,
	);
	const removeDoc = useStore((s) => s.removeDocFromWorkspace);
	const setFocused = useStore((s) => s.setFocusedDoc);
	const pageViews = useMemo(
		() =>
			doc
				? collectionPageViews(doc, effectiveCollections, collectionPreview, {
						page: t("page"),
						row: t("collection_row_lower"),
					})
				: [],
		[effectiveCollections, collectionPreview, doc, t],
	);

	if (!doc) return null;

	const docWidthPx = doc.canvas.w * 3.78;
	const labelScale = 1 / Math.max(zoomK, 0.1);
	const labelMaxWidth = docWidthPx / labelScale;

	return (
		<div
			data-doc={docName}
			onClick={() => setFocused(docName)}
			className="flex flex-col items-center shrink-0 select-none"
			style={{ gap: PAGE_GAP }}
		>
			{pageViews.map((view) => (
				<div key={view.key} className="flex flex-col items-center">
					{view.controls && isFocused && (
						<PageCollectionControls
							context={{
								docName,
								pageIndex: view.pageIndex,
								collections: effectiveCollections,
								boundCollection: view.controls.collection,
								preview: view.controls.preview,
								memberPosition: view.controls.memberPosition,
							}}
							actions={{
								setMode: setPreviewMode,
								setMember: setPreviewMember,
								moveMember: movePreviewMember,
								openCollection,
							}}
						/>
					)}
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

interface PageCollectionContext {
	docName: string;
	pageIndex: number;
	collections: readonly Collection[];
	boundCollection: Collection | null;
	preview: CollectionPreviewState;
	memberPosition: number | null;
}

interface PageCollectionActions {
	setMode: (collectionName: string, mode: CollectionPreviewMode) => void;
	setMember: (collectionName: string, memberId: string | null) => void;
	moveMember: (collectionName: string, delta: number) => void;
	openCollection: (collectionName: string | null) => void;
}

function PageCollectionControls({
	context,
	actions,
}: {
	context: PageCollectionContext;
	actions: PageCollectionActions;
}) {
	const {
		docName,
		pageIndex,
		collections,
		boundCollection,
		preview,
		memberPosition,
	} = context;
	const members = boundCollection ? sortedMembers(boundCollection) : [];
	const canNavigate = Boolean(boundCollection && members.length > 0);
	const collectionName = boundCollection?.name ?? "";
	return (
		<div className="mb-2 w-[min(520px,86vw)] rounded-lg border border-border bg-panel shadow-sm overflow-hidden">
			<PageCollectionBindingBar
				context={{
					docName,
					pageIndex,
					collections,
					boundCollection,
					collectionName,
					memberCount: members.length,
					preview,
				}}
				actions={actions}
			/>
			{boundCollection && (
				<PageCollectionRowBar
					collection={boundCollection}
					members={members}
					preview={preview}
					memberPosition={memberPosition}
					canNavigate={canNavigate}
					actions={actions}
				/>
			)}
		</div>
	);
}

interface PageCollectionBindingContext {
	docName: string;
	pageIndex: number;
	collections: readonly Collection[];
	boundCollection: Collection | null;
	collectionName: string;
	memberCount: number;
	preview: CollectionPreviewState;
}

function PageCollectionBindingBar({
	context,
	actions,
}: {
	context: PageCollectionBindingContext;
	actions: PageCollectionActions;
}) {
	const t = useT();
	const {
		docName,
		pageIndex,
		collections,
		boundCollection,
		collectionName,
		memberCount,
		preview,
	} = context;
	return (
		<div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-input/35">
			<div className="flex items-center gap-2 min-w-0">
				<Database size={14} className="text-text-3 shrink-0" />
				<select
					value={collectionName}
					onChange={(event) =>
						bindCollection(docName, pageIndex, event.target.value)
					}
					className="min-w-0 max-w-44 rounded-md bg-panel border border-border px-2 py-1 text-xs font-semibold text-text-1 outline-none focus:ring-2 focus:ring-accent/25"
				>
					<option value="">{t("collection_static_page")}</option>
					{collections.map((collection) => (
						<option key={collection.name} value={collection.name}>
							{collection.name}
						</option>
					))}
				</select>
				{boundCollection && (
					<span className="text-2xs text-text-3 whitespace-nowrap">
						{t("collection_rows_count", { count: memberCount })}
					</span>
				)}
			</div>
			{boundCollection && (
				<div className="flex items-center gap-1 shrink-0">
					<button
						type="button"
						title={t("collection_open_data")}
						aria-label={t("collection_open_data")}
						onClick={() => actions.openCollection(boundCollection.name)}
						className="h-7 px-2 rounded-md inline-flex items-center gap-1 text-2xs font-semibold text-text-2 bg-panel hover:text-text-1 hover:bg-input transition-colors"
					>
						<Database size={12} />
						<span>{t("collection_data")}</span>
					</button>
					<ModeButton
						active={preview.mode === "template"}
						title={t("collection_mode_template")}
						onClick={() => actions.setMode(boundCollection.name, "template")}
					>
						<Code2 size={13} />
					</ModeButton>
					<ModeButton
						active={preview.mode === "rendered"}
						title={t("collection_mode_rendered")}
						onClick={() => actions.setMode(boundCollection.name, "rendered")}
					>
						<Eye size={13} />
					</ModeButton>
					<ModeButton
						active={preview.mode === "all"}
						title={t("collection_mode_all")}
						onClick={() => actions.setMode(boundCollection.name, "all")}
					>
						<FileStack size={13} />
					</ModeButton>
				</div>
			)}
		</div>
	);
}

function PageCollectionRowBar({
	collection,
	members,
	preview,
	memberPosition,
	canNavigate,
	actions,
}: {
	collection: Collection;
	members: Collection["members"];
	preview: CollectionPreviewState;
	memberPosition: number | null;
	canNavigate: boolean;
	actions: PageCollectionActions;
}) {
	const t = useT();
	return (
		<div className="flex items-center justify-between gap-2 px-3 py-2">
			<div className="flex items-center gap-1">
				<button
					type="button"
					title={t("collection_previous_row")}
					aria-label={t("collection_previous_row")}
					disabled={!canNavigate || memberPosition === 1}
					onClick={() => actions.moveMember(collection.name, -1)}
					className="w-7 h-7 rounded-md inline-flex items-center justify-center text-text-2 hover:bg-input disabled:opacity-35 disabled:hover:bg-transparent"
				>
					<ChevronLeft size={15} />
				</button>
				<select
					value={preview.memberId ?? ""}
					disabled={!canNavigate}
					onChange={(event) =>
						actions.setMember(collection.name, event.target.value || null)
					}
					className="h-7 max-w-40 rounded-md bg-input border border-transparent px-2 text-xs font-semibold text-text-1 outline-none focus:ring-2 focus:ring-accent/25"
				>
					{members.map((member, index) => (
						<option key={member.id} value={member.id}>
							{t("collection_row_option", {
								index: index + 1,
								label: rowLabel(member),
							})}
						</option>
					))}
				</select>
				<button
					type="button"
					title={t("collection_next_row")}
					aria-label={t("collection_next_row")}
					disabled={!canNavigate || memberPosition === members.length}
					onClick={() => actions.moveMember(collection.name, 1)}
					className="w-7 h-7 rounded-md inline-flex items-center justify-center text-text-2 hover:bg-input disabled:opacity-35 disabled:hover:bg-transparent"
				>
					<ChevronRight size={15} />
				</button>
				<span className="text-2xs text-text-3 whitespace-nowrap">
					{memberPosition ?? 0} / {members.length}
				</span>
			</div>
		</div>
	);
}

function ModeButton({
	active,
	title,
	children,
	onClick,
}: {
	active: boolean;
	title: string;
	children: React.ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			title={title}
			aria-label={title}
			onClick={onClick}
			className={`w-7 h-7 rounded-md inline-flex items-center justify-center transition-colors ${
				active
					? "bg-accent text-white"
					: "text-text-3 hover:text-text-1 hover:bg-panel"
			}`}
		>
			{children}
		</button>
	);
}

function bindCollection(
	docName: string,
	pageIndex: number,
	collectionName: string,
): void {
	wsSend(
		collectionName
			? {
					type: "collection_bind_page",
					docName,
					pageIndex,
					collectionName,
				}
			: {
					type: "collection_clear_page",
					docName,
					pageIndex,
				},
	);
}

function rowLabel(member: Collection["members"][number]): string {
	const value = Object.values(member.data).find(
		(item) => typeof item === "string" && item.trim(),
	);
	return typeof value === "string" ? value : member.id;
}
