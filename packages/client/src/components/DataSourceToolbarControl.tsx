import {
	type Collection,
	type CollectionCursorMode,
	listCollectionFields,
	listCollectionPlaceholders,
	type PageCollectionCursor,
} from "@maket/shared";
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
import {
	cursorForPage,
	sortedCollectionMembers,
	useFocusedDoc,
	useStore,
} from "../store/useStore";
import { wsSend } from "../store/ws";

const ADDON_ID = "data-source-toolbar-addon";

type Translate = ReturnType<typeof useT>;

type FieldUsage = "used" | "available";

interface FieldState {
	key: string;
	usage: FieldUsage;
}

interface DataSourceActions {
	toggle: () => void;
	close: () => void;
	bind: (collectionName: string) => void;
	detach: () => void;
	showCollections: () => void;
	showBoundCollection: () => void;
	setMode: (mode: CollectionCursorMode) => void;
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
	cursor: PageCollectionCursor | null;
	memberPosition: number;
	fields: FieldState[];
	unknownFields: string[];
	missingCollection: boolean;
	draftDirty: boolean;
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
// This hook is the toolbar adapter over Zustand and WS commands; cursor ownership stays on the server while the hook only derives view state and dispatches user intent.
function useDataSourceControlModel(): DataSourceControlModel | null {
	const t = useT();
	const focusedDoc = useFocusedDoc();
	const pageIndex = useStore((s) => s.focusedPageIndex);
	const collections = useStore((s) => s.collections);
	const collectionDrafts = useStore((s) => s.collectionDrafts);
	const collectionCursors = useStore((s) => s.collectionCursors);
	const docs = useStore((s) => s.docs);
	const setCursorMode = useStore((s) => s.setCursorMode);
	const setCursorMember = useStore((s) => s.setCursorMember);
	const moveCursorMember = useStore((s) => s.moveCursorMember);
	const openCollection = useStore((s) => s.setFocusedCollection);
	const dataViewPinned = useStore((s) => s.dataViewPinned);
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
	const serverCollection =
		collections.find((collection) => collection.name === boundName) ?? null;
	const members = useMemo(
		() => sortedCollectionMembers(serverCollection),
		[serverCollection],
	);
	const cursor = focusedDoc
		? cursorForPage(
				{ docs, collections, collectionDrafts, collectionCursors },
				focusedDoc.name,
				pageIndex,
			)
		: null;
	const memberPosition = cursor?.memberId
		? members.findIndex((member) => member.id === cursor.memberId) + 1
		: 0;
	const { fields, unknownFields } = useMemo(
		() => fieldStates(page?.html, boundCollection),
		[page?.html, boundCollection],
	);
	const missingCollection = Boolean(boundName && !boundCollection);
	const draftDirty = Boolean(boundName && collectionDrafts[boundName]);

	useEffect(() => {
		setOpen(false);
	}, [focusedDoc?.name, pageIndex]);

	useCloseAddonOnOutsideInteraction(open, rootRef, addonRef, close);
	useToolbarAnchor(open, position, rootRef, setAnchorOffset);

	if (!focusedDoc || !page) return null;

	const toggleAddon = () =>
		setOpen((wasOpen) => {
			const willOpen = !wasOpen;
			if (willOpen && !dataViewPinned) openCollection(null);
			return willOpen;
		});

	const actions: DataSourceActions = {
		toggle: toggleAddon,
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
		setMode: (mode) => setCursorMode(focusedDoc.name, pageIndex, mode),
		setMember: (memberId) =>
			setCursorMember(focusedDoc.name, pageIndex, memberId),
		moveMember: (delta) => moveCursorMember(focusedDoc.name, pageIndex, delta),
	};

	return {
		t,
		doc: focusedDoc,
		pageIndex,
		sources,
		boundName,
		boundCollection,
		members,
		cursor,
		memberPosition,
		fields,
		unknownFields,
		missingCollection,
		draftDirty,
		position,
		readOnly,
		open,
		anchorOffset,
		rootRef,
		addonRef,
		triggerLabel: triggerLabel(
			t,
			boundName,
			boundCollection,
			cursor,
			memberPosition,
			members.length,
		),
		actions,
	};
}

/** Schema fields tagged used/available against the page template, plus
 * placeholder names that reference no schema field at all. */
function fieldStates(
	html: string | undefined,
	collection: Collection | null,
): { fields: FieldState[]; unknownFields: string[] } {
	if (!collection) return { fields: [], unknownFields: [] };
	const knownKeys = new Set(
		listCollectionFields(collection).map((field) => field.key),
	);
	const usedNames = new Set<string>();
	for (const occurrence of safePlaceholders(html ?? "")) {
		if (occurrence.placeholder?.kind === "collectionField") {
			usedNames.add(occurrence.placeholder.field);
		}
	}
	return {
		fields: [...knownKeys].map((key) => ({
			key,
			usage: usedNames.has(key) ? "used" : "available",
		})),
		unknownFields: [...usedNames].filter((name) => !knownKeys.has(name)),
	};
}

function safePlaceholders(html: string) {
	try {
		return listCollectionPlaceholders(html);
	} catch {
		return [];
	}
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

/** Plain toolbar icon like its siblings; state lives in a corner dot —
 * accent when a source is bound, danger when the binding is broken. The
 * detailed label stays available to tooltips and screen readers. */
function ToolbarTrigger({ model }: { model: DataSourceControlModel }) {
	const {
		open,
		boundName,
		missingCollection,
		unknownFields,
		rootRef,
		triggerLabel,
		actions,
	} = model;
	const warning = missingCollection || unknownFields.length > 0;
	return (
		<div ref={rootRef} className="relative shrink-0">
			<button
				type="button"
				aria-expanded={open}
				aria-controls={ADDON_ID}
				aria-label={triggerLabel}
				title={triggerLabel}
				onClick={actions.toggle}
				className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors relative ${
					open
						? "bg-accent text-white"
						: "text-text-3 hover:text-text-1 hover:bg-input"
				}`}
			>
				<Database size={16} />
				{boundName && (
					<span
						className={`absolute top-0.5 right-0.5 w-2 h-2 rounded-full ring-2 ring-panel ${
							warning ? "bg-danger" : "bg-accent"
						}`}
					/>
				)}
			</button>
		</div>
	);
}

/** Compact popover: three dense rows (source, fields, cursor) so the
 * document behind stays visible. Context labels live in tooltips. */
function DataSourceAddon({ model }: { model: DataSourceControlModel }) {
	const { t, boundCollection, draftDirty, addonRef } = model;
	return (
		<div
			ref={addonRef}
			id={ADDON_ID}
			role="dialog"
			aria-label={t("collection_data_source")}
			data-side={model.position}
			style={addonStyle(model.position, model.anchorOffset)}
			className="fixed left-1/2 -translate-x-1/2 z-[var(--z-popover)] w-[min(440px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-border bg-panel p-2.5 space-y-2 shadow-[0_16px_48px_rgba(0,0,0,0.18)]"
		>
			<SourceRow model={model} />
			{boundCollection && <FieldsRow model={model} />}
			{boundCollection && <CursorRow model={model} />}
			{draftDirty && (
				<p className="text-2xs text-text-3">
					{t("collection_draft_export_note")}
				</p>
			)}
		</div>
	);
}

function SourceRow({ model }: { model: DataSourceControlModel }) {
	const { boundName, readOnly } = model;
	return (
		<div>
			<div className="flex items-center gap-1.5">
				<PageScope model={model} />
				<SourceSelect model={model} />
				{boundName && !readOnly && (
					<>
						<OpenDataButton model={model} />
						<DetachButton model={model} />
					</>
				)}
			</div>
			<NoSourcesHint model={model} />
			<MissingSourceNotice model={model} />
		</div>
	);
}

function PageScope({ model }: { model: DataSourceControlModel }) {
	const { t, doc, pageIndex } = model;
	if (doc.pages.length <= 1) return null;
	return (
		<span className="shrink-0 text-2xs font-semibold text-text-3">
			{t("collection_page_scope", {
				page: pageIndex + 1,
				total: doc.pages.length,
			})}
		</span>
	);
}

function SourceSelect({ model }: { model: DataSourceControlModel }) {
	const { t, boundName, missingCollection, readOnly, sources, actions } = model;
	return (
		<>
			<label className="sr-only" htmlFor="page-data-source">
				{t("collection_binding")}
			</label>
			<select
				id="page-data-source"
				value={boundName}
				disabled={readOnly || sources.length === 0}
				onChange={(event) => actions.bind(event.target.value)}
				className="h-8 min-w-0 flex-1 rounded-md border border-border bg-input px-2 text-xs font-semibold text-text-1 outline-none transition-shadow focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-55"
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
		</>
	);
}

function OpenDataButton({ model }: { model: DataSourceControlModel }) {
	const { t, actions } = model;
	return (
		<IconButton
			label={t("collection_open_data")}
			onClick={actions.showBoundCollection}
			icon={<Table size={14} />}
		/>
	);
}

function DetachButton({ model }: { model: DataSourceControlModel }) {
	const { t, actions } = model;
	return (
		<IconButton
			label={t("collection_detach")}
			onClick={actions.detach}
			danger
			icon={<Link2Off size={14} />}
		/>
	);
}

function NoSourcesHint({ model }: { model: DataSourceControlModel }) {
	const { t, readOnly, sources, actions } = model;
	if (sources.length > 0 || readOnly) return null;
	return (
		<div className="mt-1.5 flex items-center justify-between gap-2 text-2xs">
			<span className="text-text-3">{t("collection_no_sources")}</span>
			<button
				type="button"
				onClick={actions.showCollections}
				className="shrink-0 font-bold text-accent hover:underline"
			>
				{t("collection_open_library")}
			</button>
		</div>
	);
}

function MissingSourceNotice({ model }: { model: DataSourceControlModel }) {
	const { t, boundName, missingCollection } = model;
	if (!missingCollection) return null;
	return (
		<p className="mt-1.5 inline-flex items-center gap-1 text-2xs font-semibold text-danger">
			<AlertTriangle size={12} />
			{t("collection_missing_source", { name: boundName })}
		</p>
	);
}

function FieldsRow({ model }: { model: DataSourceControlModel }) {
	const { t, fields, unknownFields } = model;
	if (fields.length === 0 && unknownFields.length === 0) return null;
	return (
		<div
			role="group"
			aria-label={t("collection_fields_section")}
			className="flex flex-wrap items-center gap-1"
		>
			{fields.map((field) => (
				<span
					key={field.key}
					title={
						field.usage === "used"
							? t("collection_field_used")
							: t("collection_field_available")
					}
					className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-px font-mono text-2xs font-semibold ${
						field.usage === "used"
							? "bg-accent-soft text-accent"
							: "border border-border text-text-3"
					}`}
				>
					{field.key}
					{field.usage === "used" && <span aria-hidden>✓</span>}
				</span>
			))}
			{unknownFields.map((name) => (
				<span
					key={`unknown-${name}`}
					title={t("collection_issue_unknown_field", { field: name })}
					className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-danger/60 px-1.5 py-px font-mono text-2xs font-bold text-danger"
				>
					<AlertTriangle size={10} />
					{name}
				</span>
			))}
		</div>
	);
}

function CursorRow({ model }: { model: DataSourceControlModel }) {
	const { t, cursor, members, memberPosition, actions } = model;
	if (!cursor) return null;
	return (
		<div
			className="flex items-center gap-1"
			title={t("collection_cursor_shared")}
		>
			<div className="flex shrink-0 items-center rounded-md bg-input p-0.5">
				<ModeButton
					active={cursor.mode === "template"}
					title={t("collection_mode_template")}
					onClick={() => actions.setMode("template")}
					icon={<Code2 size={14} />}
				/>
				<ModeButton
					active={cursor.mode === "rendered"}
					title={t("collection_mode_rendered")}
					disabled={members.length === 0}
					onClick={() => actions.setMode("rendered")}
					icon={<Eye size={14} />}
				/>
				<ModeButton
					active={cursor.mode === "all"}
					title={t("collection_mode_all")}
					disabled={members.length === 0}
					onClick={() => actions.setMode("all")}
					icon={<FileStack size={14} />}
				/>
			</div>
			<div className="h-5 w-px shrink-0 bg-border" />
			<button
				type="button"
				title={t("collection_previous_row")}
				aria-label={t("collection_previous_row")}
				disabled={memberPosition <= 1}
				onClick={() => actions.moveMember(-1)}
				className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-input disabled:opacity-30 disabled:hover:bg-transparent"
			>
				<ChevronLeft size={14} />
			</button>
			<select
				value={cursor.memberId ?? ""}
				aria-label={t("collection_preview_row")}
				disabled={members.length === 0}
				onChange={(event) => actions.setMember(event.target.value || null)}
				className="h-7 min-w-0 flex-1 rounded-md bg-input px-1.5 text-xs font-semibold text-text-1 outline-none focus:ring-2 focus:ring-accent/25"
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
			<span className="shrink-0 text-2xs tabular-nums text-text-3">
				{memberPosition}/{members.length}
			</span>
			<button
				type="button"
				title={t("collection_next_row")}
				aria-label={t("collection_next_row")}
				disabled={memberPosition === 0 || memberPosition >= members.length}
				onClick={() => actions.moveMember(1)}
				className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-input disabled:opacity-30 disabled:hover:bg-transparent"
			>
				<ChevronRight size={14} />
			</button>
		</div>
	);
}

function IconButton({
	label,
	icon,
	onClick,
	danger = false,
}: {
	label: string;
	icon: React.ReactNode;
	onClick: () => void;
	danger?: boolean;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			onClick={onClick}
			className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-text-2 transition-colors ${
				danger
					? "hover:border-danger/30 hover:bg-danger/10 hover:text-danger"
					: "hover:bg-input hover:text-text-1"
			}`}
		>
			{icon}
		</button>
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
			className={`flex h-7 w-8 items-center justify-center rounded transition-colors disabled:opacity-35 ${
				active
					? "bg-panel text-accent shadow-sm"
					: "text-text-3 hover:bg-panel/60 hover:text-text-1"
			}`}
		>
			{icon}
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

/** Chip copy: the source, then where the cursor is — "Clients · Row 3/12",
 * "Clients · Template", "Clients · All rows". */
function triggerLabel(
	t: Translate,
	boundName: string,
	boundCollection: Collection | null,
	cursor: PageCollectionCursor | null,
	memberPosition: number,
	memberCount: number,
): string {
	if (!boundCollection) return boundName || t("collection_link_data");
	if (cursor?.mode === "rendered" && memberPosition > 0) {
		return `${boundCollection.name} · ${t("collection_cursor_position", {
			index: memberPosition,
			total: memberCount,
		})}`;
	}
	if (cursor?.mode === "all") {
		return `${boundCollection.name} · ${t("collection_mode_all")}`;
	}
	return `${boundCollection.name} · ${t("collection_mode_template")}`;
}

function rowLabel(member: Collection["members"][number]): string {
	const value = Object.values(member.data).find(
		(item) => typeof item === "string" && item.trim(),
	);
	return typeof value === "string" ? value : member.id;
}
