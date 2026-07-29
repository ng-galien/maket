import type { Collection } from "@maket/shared";
import {
	AlertTriangle,
	ChevronLeft,
	ChevronRight,
	Code2,
	Database,
	Eye,
	FileStack,
	Link2Off,
	Table,
	X,
} from "lucide-react";
import {
	type CSSProperties,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import type { Document } from "../store/types";
import type {
	CollectionPreviewMode,
	CollectionPreviewState,
} from "../store/useStore";
import { useFocusedDoc, useStore } from "../store/useStore";
import { wsSend } from "../store/ws";

const ADDON_ID = "data-source-toolbar-addon";
const BINDING_TITLE_ID = "collection-binding-title";
const PREVIEW_TITLE_ID = "collection-preview-title";

type Translate = ReturnType<typeof useT>;

interface DataSourceActions {
	toggle: () => void;
	close: () => void;
	bind: (collectionName: string) => void;
	detach: () => void;
	showCollections: () => void;
	showBoundCollection: () => void;
	setMode: (mode: CollectionPreviewMode) => void;
	setMember: (memberId: string | null) => void;
	moveMember: (delta: number) => void;
}

interface DataSourceControlModel {
	t: Translate;
	doc: Document;
	pageIndex: number;
	sources: Collection[];
	boundName: string;
	boundCollection: Collection | null;
	members: Collection["members"];
	preview: CollectionPreviewState | null;
	memberPosition: number;
	missingCollection: boolean;
	position: "top" | "bottom";
	readOnly: boolean;
	open: boolean;
	anchorOffset: number;
	rootRef: RefObject<HTMLDivElement | null>;
	addonRef: RefObject<HTMLDivElement | null>;
	triggerLabel: string;
	actions: DataSourceActions;
}

export function DataSourceToolbarControl() {
	const model = useDataSourceControlModel();
	if (!model) return null;
	return <DataSourceToolbarView model={model} />;
}

// code-moniker: ignore[smell-feature-envy-local]
// This hook is the toolbar adapter over Zustand and WS commands; collection ownership remains in the store while the hook only derives view state and dispatches user intent.
function useDataSourceControlModel(): DataSourceControlModel | null {
	const t = useT();
	const focusedDoc = useFocusedDoc();
	const pageIndex = useStore((s) => s.focusedPageIndex);
	const collections = useStore((s) => s.collections);
	const collectionDrafts = useStore((s) => s.collectionDrafts);
	const previewByCollection = useStore((s) => s.collectionPreview);
	const setPreviewMode = useStore((s) => s.setCollectionPreviewMode);
	const setPreviewMember = useStore((s) => s.setCollectionPreviewMember);
	const movePreviewMember = useStore((s) => s.moveCollectionPreviewMember);
	const openCollection = useStore((s) => s.setFocusedCollection);
	const setActivePanel = useStore((s) => s.setActivePanel);
	const position = useStore((s) => s.barPosition);
	const readOnly = useStore((s) => s.readOnly);
	const [open, setOpen] = useState(false);
	const [anchorOffset, setAnchorOffset] = useState(76);
	const rootRef = useRef<HTMLDivElement>(null);
	const addonRef = useRef<HTMLDivElement>(null);
	const close = useCallback(() => setOpen(false), []);

	const sources = useMemo(
		() =>
			collections.map(
				(collection) => collectionDrafts[collection.name] ?? collection,
			),
		[collectionDrafts, collections],
	);
	const page = focusedDoc?.pages[pageIndex];
	const boundName = page?.collection?.name ?? "";
	const boundCollection =
		sources.find((collection) => collection.name === boundName) ?? null;
	const members = useMemo(
		() => sortedMembers(boundCollection),
		[boundCollection],
	);
	const preview = previewFor(boundCollection, members, previewByCollection);
	const memberPosition = preview
		? members.findIndex((member) => member.id === preview.memberId) + 1
		: 0;
	const missingCollection = Boolean(boundName && !boundCollection);

	useEffect(() => {
		setOpen(false);
	}, [focusedDoc?.name, pageIndex]);

	useCloseAddonOnOutsideInteraction(open, rootRef, addonRef, close);
	useToolbarAnchor(open, position, rootRef, setAnchorOffset);

	if (!focusedDoc || !page) return null;

	const actions: DataSourceActions = {
		toggle: () => setOpen((value) => !value),
		close,
		bind: (collectionName) =>
			bindCollection(focusedDoc.name, pageIndex, collectionName),
		detach: () => detachCollection(focusedDoc.name, pageIndex),
		showCollections: () => {
			setActivePanel("collections");
			close();
		},
		showBoundCollection: () => {
			if (!boundCollection) return;
			openCollection(boundCollection.name);
			close();
		},
		setMode: (mode) => {
			if (boundCollection) setPreviewMode(boundCollection.name, mode);
		},
		setMember: (memberId) => {
			if (boundCollection) setPreviewMember(boundCollection.name, memberId);
		},
		moveMember: (delta) => {
			if (boundCollection) movePreviewMember(boundCollection.name, delta);
		},
	};

	return {
		t,
		doc: focusedDoc,
		pageIndex,
		sources,
		boundName,
		boundCollection,
		members,
		preview,
		memberPosition,
		missingCollection,
		position,
		readOnly,
		open,
		anchorOffset,
		rootRef,
		addonRef,
		triggerLabel: triggerLabel(t, boundName, boundCollection, members.length),
		actions,
	};
}

function useCloseAddonOnOutsideInteraction(
	open: boolean,
	rootRef: RefObject<HTMLDivElement | null>,
	addonRef: RefObject<HTMLDivElement | null>,
	close: () => void,
) {
	useEffect(() => {
		if (!open) return;
		const closeOnOutsidePointer = (event: PointerEvent) => {
			const target = event.target as Node;
			if (
				!rootRef.current?.contains(target) &&
				!addonRef.current?.contains(target)
			) {
				close();
			}
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		document.addEventListener("pointerdown", closeOnOutsidePointer);
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("pointerdown", closeOnOutsidePointer);
			window.removeEventListener("keydown", closeOnEscape);
		};
	}, [addonRef, close, open, rootRef]);
}

function useToolbarAnchor(
	open: boolean,
	position: "top" | "bottom",
	rootRef: RefObject<HTMLDivElement | null>,
	setAnchorOffset: (offset: number) => void,
) {
	useLayoutEffect(() => {
		if (!open) return;
		const toolbar = rootRef.current?.closest(
			"[data-toolbar-shell]",
		) as HTMLElement | null;
		if (!toolbar) return;
		const updateAnchor = () => {
			const rect = toolbar.getBoundingClientRect();
			setAnchorOffset(
				position === "bottom"
					? window.innerHeight - rect.top + 12
					: rect.bottom + 12,
			);
		};
		updateAnchor();
		window.addEventListener("resize", updateAnchor);
		return () => window.removeEventListener("resize", updateAnchor);
	}, [open, position, rootRef, setAnchorOffset]);
}

function DataSourceToolbarView({ model }: { model: DataSourceControlModel }) {
	return (
		<>
			<ToolbarTrigger model={model} />
			{model.open &&
				createPortal(<DataSourceAddon model={model} />, document.body)}
		</>
	);
}

function ToolbarTrigger({ model }: { model: DataSourceControlModel }) {
	const { t, open, missingCollection, rootRef, triggerLabel, actions } = model;
	return (
		<div ref={rootRef} className="relative shrink-0">
			<button
				type="button"
				aria-expanded={open}
				aria-controls={ADDON_ID}
				aria-label={triggerLabel}
				title={t("collection_data_source")}
				onClick={actions.toggle}
				className={`h-8 max-w-44 rounded-full px-2.5 inline-flex items-center gap-1.5 border transition-colors max-sm:w-8 max-sm:justify-center max-sm:px-0 ${
					open
						? "border-accent/40 bg-accent-soft text-accent"
						: missingCollection
							? "border-danger/30 bg-danger/10 text-danger"
							: "border-border bg-input/45 text-text-2 hover:text-text-1 hover:bg-input"
				}`}
			>
				{missingCollection ? (
					<AlertTriangle size={14} className="shrink-0" />
				) : (
					<Database size={14} className="shrink-0" />
				)}
				<span className="truncate text-xs font-semibold max-sm:hidden">
					{triggerLabel}
				</span>
			</button>
		</div>
	);
}

function DataSourceAddon({ model }: { model: DataSourceControlModel }) {
	const { t, readOnly, boundCollection, preview, addonRef } = model;
	return (
		<div
			ref={addonRef}
			id={ADDON_ID}
			role="dialog"
			aria-label={t("collection_data_source")}
			data-side={model.position}
			style={addonStyle(model.position, model.anchorOffset)}
			className="fixed left-1/2 -translate-x-1/2 z-[var(--z-popover)] w-[min(620px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-border bg-panel shadow-[0_22px_70px_rgba(0,0,0,0.2)]"
		>
			<AddonHeader model={model} />
			<div className="space-y-4 p-4">
				<BindingSection model={model} />
				{boundCollection && preview && (
					<>
						<div className="h-px bg-border" />
						<PreviewSection model={model} />
						{!readOnly && (
							<button
								type="button"
								onClick={model.actions.showBoundCollection}
								className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90"
							>
								<Table size={14} />
								{t("collection_open_data")}
							</button>
						)}
					</>
				)}
			</div>
		</div>
	);
}

function AddonHeader({ model }: { model: DataSourceControlModel }) {
	const { t, doc, pageIndex, actions } = model;
	return (
		<header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
			<div className="flex min-w-0 items-start gap-2.5">
				<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
					<Database size={16} />
				</div>
				<div className="min-w-0">
					<h2 className="text-sm font-bold text-text-1">
						{t("collection_data_source")}
					</h2>
					<p className="truncate text-2xs text-text-3">
						{doc.name} ·{" "}
						{t("collection_page_scope", {
							page: pageIndex + 1,
							total: doc.pages.length,
						})}
					</p>
				</div>
			</div>
			<button
				type="button"
				title={t("close")}
				aria-label={t("close")}
				onClick={actions.close}
				className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-3 transition-colors hover:bg-input hover:text-text-1"
			>
				<X size={15} />
			</button>
		</header>
	);
}

// code-moniker: ignore[smell-feature-envy-local]
// This is a pure presentation boundary: its external calls are translations and intent callbacks already owned by the toolbar model.
function BindingSection({ model }: { model: DataSourceControlModel }) {
	const {
		t,
		boundCollection,
		boundName,
		members,
		missingCollection,
		readOnly,
		sources,
		actions,
	} = model;
	return (
		<section aria-labelledby={BINDING_TITLE_ID}>
			<div className="mb-2 flex items-center justify-between gap-3">
				<h3 id={BINDING_TITLE_ID} className="text-xs font-bold text-text-1">
					{t("collection_binding")}
				</h3>
				{boundCollection && (
					<span className="text-2xs text-text-3">
						{t("collection_rows_count", { count: members.length })}
					</span>
				)}
			</div>

			<div className="flex flex-col gap-2 sm:flex-row">
				<label className="sr-only" htmlFor="page-data-source">
					{t("collection_binding")}
				</label>
				<select
					id="page-data-source"
					value={boundName}
					disabled={readOnly || sources.length === 0}
					onChange={(event) => actions.bind(event.target.value)}
					className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-input px-3 text-sm font-semibold text-text-1 outline-none transition-shadow focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-55"
				>
					{!boundName && (
						<option value="" disabled>
							{t("collection_link_data")}
						</option>
					)}
					{missingCollection && (
						<option value={boundName} disabled>
							{t("collection_missing_source", { name: boundName })}
						</option>
					)}
					{sources.map((collection) => (
						<option key={collection.name} value={collection.name}>
							{collection.name}
						</option>
					))}
				</select>

				{boundName && !readOnly && (
					<button
						type="button"
						onClick={actions.detach}
						className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-text-2 transition-colors hover:border-danger/30 hover:bg-danger/10 hover:text-danger"
					>
						<Link2Off size={14} />
						{t("collection_detach")}
					</button>
				)}
			</div>

			{sources.length === 0 && !readOnly && (
				<div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-input/55 px-3 py-2">
					<p className="text-xs text-text-3">{t("collection_no_sources")}</p>
					<button
						type="button"
						onClick={actions.showCollections}
						className="shrink-0 text-xs font-bold text-accent hover:underline"
					>
						{t("collection_open_library")}
					</button>
				</div>
			)}

			{missingCollection && (
				<p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-danger">
					<AlertTriangle size={13} />
					{t("collection_missing_source", { name: boundName })}
				</p>
			)}
		</section>
	);
}

function PreviewSection({ model }: { model: DataSourceControlModel }) {
	return (
		<section
			aria-labelledby={PREVIEW_TITLE_ID}
			className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
		>
			<PreviewModeSelector model={model} />
			<PreviewRowSelector model={model} />
		</section>
	);
}

function PreviewModeSelector({ model }: { model: DataSourceControlModel }) {
	const { t, preview, members, actions } = model;
	if (!preview) return null;
	return (
		<div>
			<h3 id={PREVIEW_TITLE_ID} className="mb-2 text-xs font-bold text-text-1">
				{t("collection_preview_section")}
			</h3>
			<div className="grid grid-cols-3 rounded-lg bg-input p-1">
				<ModeButton
					active={preview.mode === "template"}
					title={t("collection_mode_template")}
					onClick={() => actions.setMode("template")}
					icon={<Code2 size={14} />}
				/>
				<ModeButton
					active={preview.mode === "rendered"}
					title={t("collection_mode_rendered")}
					onClick={() => actions.setMode("rendered")}
					icon={<Eye size={14} />}
				/>
				<ModeButton
					active={preview.mode === "all"}
					title={t("collection_mode_all")}
					disabled={members.length === 0}
					onClick={() => actions.setMode("all")}
					icon={<FileStack size={14} />}
				/>
			</div>
		</div>
	);
}

function PreviewRowSelector({ model }: { model: DataSourceControlModel }) {
	const { t, preview, members, memberPosition, actions } = model;
	if (!preview) return null;
	return (
		<div>
			<h3 className="mb-2 text-xs font-bold text-text-1">
				{t("collection_preview_row")}
			</h3>
			<div className="flex items-center gap-1 rounded-lg bg-input p-1">
				<button
					type="button"
					title={t("collection_previous_row")}
					aria-label={t("collection_previous_row")}
					disabled={memberPosition <= 1}
					onClick={() => actions.moveMember(-1)}
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-panel disabled:opacity-30 disabled:hover:bg-transparent"
				>
					<ChevronLeft size={15} />
				</button>
				<select
					value={preview.memberId ?? ""}
					aria-label={t("collection_preview_row")}
					disabled={members.length === 0}
					onChange={(event) => actions.setMember(event.target.value || null)}
					className="h-8 min-w-0 flex-1 rounded-md border-0 bg-transparent px-1 text-xs font-semibold text-text-1 outline-none"
				>
					{members.length === 0 && (
						<option value="">{t("collection_empty_rows")}</option>
					)}
					{members.map((member, index) => (
						<option key={member.id} value={member.id}>
							{t("collection_row_option", {
								index: index + 1,
								label: rowLabel(member),
							})}
						</option>
					))}
				</select>
				<span className="shrink-0 text-2xs text-text-3">
					{memberPosition} / {members.length}
				</span>
				<button
					type="button"
					title={t("collection_next_row")}
					aria-label={t("collection_next_row")}
					disabled={memberPosition === 0 || memberPosition >= members.length}
					onClick={() => actions.moveMember(1)}
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-panel disabled:opacity-30 disabled:hover:bg-transparent"
				>
					<ChevronRight size={15} />
				</button>
			</div>
		</div>
	);
}

function ModeButton({
	active,
	title,
	icon,
	disabled = false,
	onClick,
}: {
	active: boolean;
	title: string;
	icon: React.ReactNode;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			title={title}
			aria-label={title}
			aria-pressed={active}
			disabled={disabled}
			onClick={onClick}
			className={`inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-md px-2 text-2xs font-semibold transition-colors disabled:opacity-35 ${
				active
					? "bg-panel text-accent shadow-sm"
					: "text-text-3 hover:bg-panel/60 hover:text-text-1"
			}`}
		>
			{icon}
			<span className="truncate">{title}</span>
		</button>
	);
}

function addonStyle(
	position: "top" | "bottom",
	anchorOffset: number,
): CSSProperties {
	const maxHeight = Math.max(160, window.innerHeight - anchorOffset - 12);
	return position === "bottom"
		? { bottom: anchorOffset, maxHeight }
		: { top: anchorOffset, maxHeight };
}

function previewFor(
	collection: Collection | null,
	members: Collection["members"],
	previewByCollection: Record<string, CollectionPreviewState>,
): CollectionPreviewState | null {
	if (!collection) return null;
	return (
		previewByCollection[collection.name] ?? {
			mode: "template",
			memberId: members[0]?.id ?? null,
		}
	);
}

function bindCollection(
	docName: string,
	pageIndex: number,
	collectionName: string,
) {
	if (!collectionName) return;
	wsSend({
		type: "collection_bind_page",
		docName,
		pageIndex,
		collectionName,
	});
}

function detachCollection(docName: string, pageIndex: number) {
	wsSend({
		type: "collection_clear_page",
		docName,
		pageIndex,
	});
}

function triggerLabel(
	t: Translate,
	boundName: string,
	boundCollection: Collection | null,
	memberCount: number,
): string {
	if (boundCollection) return `${boundCollection.name} · ${memberCount}`;
	return boundName || t("collection_link_data");
}

function sortedMembers(collection: Collection | null): Collection["members"] {
	return collection
		? [...collection.members].sort((a, b) => a.position - b.position)
		: [];
}

function rowLabel(member: Collection["members"][number]): string {
	const value = Object.values(member.data).find(
		(item) => typeof item === "string" && item.trim(),
	);
	return typeof value === "string" ? value : member.id;
}
