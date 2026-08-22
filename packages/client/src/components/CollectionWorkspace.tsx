import {
	type Collection,
	type CollectionField,
	listCollectionFields,
	validateCollection,
} from "@maket/shared";
import {
	AlertTriangle,
	Columns3,
	Copy,
	Database,
	Plus,
	RotateCcw,
	Save,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type Column,
	DataGrid,
	type RenderCellProps,
	type RenderEditCellProps,
} from "react-data-grid";
import { useShallow } from "zustand/shallow";
import { useT } from "../i18n/useT";
import {
	applyPastedTable,
	parseTabularClipboard,
} from "../lib/tabular-clipboard";
import { previewCursorForPage, useStore } from "../store/useStore";
import { wsSend } from "../store/ws";
import { BottomDockResizeHandle, useBottomDockHeight } from "./BottomDock";
import { CollectionRenderControls } from "./CollectionDataControls";

const fieldKeyPattern = /^[a-z][a-z0-9_]*$/;
type SetCollectionDraft = React.Dispatch<React.SetStateAction<Collection>>;
export type StoreState = ReturnType<typeof useStore.getState>;
export type CollectionWorkspaceLayout =
	| "closed"
	| "split"
	| "expanded-linked"
	| "expanded-data";

const DOCK_HEIGHT_KEYS = {
	split: "maket-collection-height-split",
	expanded: "maket-collection-height-expanded",
} as const;

/** Field types the schema toolbar can create; cells render by declared type. */
type FieldType = "string" | "number" | "boolean";
const fieldTypes: readonly FieldType[] = ["string", "number", "boolean"];

interface FieldMessages {
	invalid: string;
	duplicate: string;
}

/** The table drives the focused page's cursor when that page is bound to
 * this collection — clicking a row moves the shared preview cursor. */
function selectCollectionWorkspaceState(state: StoreState) {
	const focusedCollectionName = state.focusedCollectionName;
	const collection = state.collections.find(
		(item) => item.name === focusedCollectionName,
	);
	const cursor = state.focusedDocName
		? previewCursorForPage(state, state.focusedDocName, state.focusedPageIndex)
		: null;
	const cursorOnThisCollection =
		cursor !== null && cursor.collection === focusedCollectionName;
	return {
		collection,
		collectionDraft: focusedCollectionName
			? (state.collectionDrafts[focusedCollectionName] ?? null)
			: null,
		previewMemberId: cursorOnThisCollection ? cursor.memberId : null,
		cursorDocName: cursorOnThisCollection ? state.focusedDocName : null,
		cursorPageIndex: state.focusedPageIndex,
		readOnly: state.readOnly,
		dataDockMode: state.dataDockMode,
		setFocusedCollection: state.setFocusedCollection,
		setCursorMember: state.setCursorMember,
		setDraftCursorOverride: state.setDraftCursorOverride,
	};
}

export function selectCollectionWorkspaceLayout(
	state: StoreState,
): CollectionWorkspaceLayout {
	if (state.readOnly || !state.focusedCollectionName) return "closed";
	if (state.dataDockMode === "split") return "split";
	const document = state.focusedDocName
		? state.docs.get(state.focusedDocName)
		: null;
	const page = document?.pages[state.focusedPageIndex];
	return page?.collection?.name === state.focusedCollectionName
		? "expanded-linked"
		: "expanded-data";
}

/** Only saved rows exist server-side — a draft-only row cannot become the
 * shared cursor until the collection is saved. */
function isSavedRow(collection: Collection, memberId: string): boolean {
	return collection.members.some((member) => member.id === memberId);
}

/** Bottom dock: zoom-independent, resizable, and shared by web and Electron. */
export function CollectionWorkspace({
	layout: requestedLayout,
}: {
	layout?: CollectionWorkspaceLayout;
} = {}) {
	const t = useT();
	const {
		collection,
		collectionDraft,
		previewMemberId,
		cursorDocName,
		cursorPageIndex,
		readOnly,
		dataDockMode,
		setFocusedCollection,
		setCursorMember,
		setDraftCursorOverride,
	} = useStore(useShallow((state) => selectCollectionWorkspaceState(state)));
	const inferredLayout = useStore(selectCollectionWorkspaceLayout);
	const layout = requestedLayout ?? inferredLayout;
	const dockStorageKey = DOCK_HEIGHT_KEYS[dataDockMode];
	const [height, setHeight] = useBottomDockHeight(
		dockStorageKey,
		dataDockMode === "expanded" ? expandedDockHeight() : splitDockHeight(),
	);

	if (!collection || readOnly || layout === "closed") return null;
	const selectMember = (memberId: string) => {
		if (!cursorDocName) return;
		if (isSavedRow(collection, memberId)) {
			setDraftCursorOverride(cursorDocName, cursorPageIndex, null);
			setCursorMember(cursorDocName, cursorPageIndex, memberId);
			return;
		}
		setDraftCursorOverride(cursorDocName, cursorPageIndex, memberId);
	};

	return (
		<section
			data-collection-dock
			data-collection-layout={layout}
			style={{ height: layout === "expanded-data" ? "100%" : height }}
			className={`relative z-[var(--z-panel)] flex w-full flex-col overflow-hidden border-t border-border bg-panel shadow-[0_-8px_24px_rgba(0,0,0,0.08)] ${layout === "expanded-data" ? "min-h-0 flex-1" : "shrink-0"}`}
		>
			{layout !== "expanded-data" && (
				<BottomDockResizeHandle
					height={height}
					setHeight={setHeight}
					storageKey={dockStorageKey}
					label={t("resize_collection_panel")}
				/>
			)}
			<CollectionEditor
				key={collection.name}
				model={{
					collection,
					initialDraft: collectionDraft ?? collection,
					previewMemberId,
				}}
				actions={{
					close: () => setFocusedCollection(null),
					selectMember,
				}}
			/>
		</section>
	);
}

function splitDockHeight(): number {
	return Math.max(220, Math.min(340, Math.round(window.innerHeight * 0.34)));
}

function expandedDockHeight(): number {
	return Math.max(360, Math.min(620, Math.round(window.innerHeight * 0.68)));
}

interface CollectionEditorProps {
	model: {
		collection: Collection;
		initialDraft: Collection;
		previewMemberId: string | null;
	};
	actions: {
		close: () => void;
		selectMember: (memberId: string) => void;
	};
}

function CollectionEditor(props: CollectionEditorProps) {
	const { collection, initialDraft, previewMemberId } = props.model;
	const { close, selectMember } = props.actions;
	const [draft, setDraftState] = useState(initialDraft);
	const [activeView, setActiveView] = useState<"data" | "schema">("data");
	const [fieldName, setFieldName] = useState("");
	const [fieldError, setFieldError] = useState("");
	const setCollectionDraft = useStore((s) => s.setCollectionDraft);
	const clearCollectionDraft = useStore((s) => s.clearCollectionDraft);
	const setDraft = useCallback<SetCollectionDraft>(
		(action) => {
			setDraftState((current) => {
				const next = typeof action === "function" ? action(current) : action;
				setCollectionDraft(next);
				return next;
			});
		},
		[setCollectionDraft],
	);
	const fields = useMemo(() => listCollectionFields(draft), [draft]);
	const members = useMemo(() => sortedMembers(draft), [draft]);
	const savedMemberIds = useMemo(
		() => new Set(collection.members.map((member) => member.id)),
		[collection],
	);
	const issues = useMemo(() => validateCollection(draft), [draft]);
	const dirty = useMemo(
		() => hasChanged(collection, draft),
		[collection, draft],
	);
	const canSave = dirty && issues.length === 0;

	useEffect(() => {
		setDraftState(initialDraft);
		setFieldName("");
		setFieldError("");
	}, [initialDraft]);

	return (
		<div className="flex min-h-0 flex-col overflow-hidden">
			<CollectionEditorHeader draft={draft} close={close} />
			{issues.length > 0 && <ValidationIssues issues={issues} />}
			<CollectionEditorToolbar
				model={{ draft, dirty, canSave, activeView }}
				actions={{
					setView: setActiveView,
					addRow: () => addRow(draft, fields, setDraft),
					reset: () => {
						clearCollectionDraft(collection.name);
						setDraftState(collection);
					},
				}}
			/>
			{activeView === "data" ? (
				<CollectionGrid
					draft={draft}
					fields={fields}
					members={members}
					savedMemberIds={savedMemberIds}
					previewMemberId={previewMemberId}
					setDraft={setDraft}
					onSelectMember={selectMember}
				/>
			) : (
				<div className="flex min-h-0 flex-1 flex-col">
					<SchemaToolbar
						draft={draft}
						fieldName={fieldName}
						fieldError={fieldError}
						setDraft={setDraft}
						setFieldName={setFieldName}
						setFieldError={setFieldError}
					/>
					<SchemaFieldList draft={draft} fields={fields} setDraft={setDraft} />
				</div>
			)}
		</div>
	);
}

function CollectionEditorHeader({
	draft,
	close,
}: {
	draft: Collection;
	close: () => void;
}) {
	const t = useT();
	return (
		<header className="flex h-10 items-center gap-3 border-b border-border px-3">
			<span
				className="text-sm font-bold text-text-1 truncate shrink-0 max-w-44"
				title={draft.name}
			>
				{draft.name}
			</span>
			<CollectionRenderControls />
			<div className="min-w-0 flex-1" />
			<div className="flex items-center gap-0.5 shrink-0">
				<button
					type="button"
					title={t("close")}
					aria-label={t("close")}
					onClick={close}
					className="flex h-7 w-7 items-center justify-center rounded-sm text-text-3 transition-colors hover:bg-input hover:text-text-1"
				>
					<X size={13} />
				</button>
			</div>
		</header>
	);
}

function CollectionEditorToolbar({
	model,
	actions,
}: {
	model: {
		draft: Collection;
		dirty: boolean;
		canSave: boolean;
		activeView: "data" | "schema";
	};
	actions: {
		setView: (view: "data" | "schema") => void;
		addRow: () => void;
		reset: () => void;
	};
}) {
	const { draft, dirty, canSave, activeView } = model;
	const t = useT();
	return (
		<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-input/15 px-3">
			<div
				role="tablist"
				aria-label={t("collection_editor_view")}
				className="flex shrink-0 items-center rounded-sm border border-border bg-panel p-0.5"
			>
				<EditorViewButton
					active={activeView === "data"}
					label={t("collection_data")}
					onClick={() => actions.setView("data")}
					icon={<Database size={13} />}
				/>
				<EditorViewButton
					active={activeView === "schema"}
					label={t("collection_schema")}
					onClick={() => actions.setView("schema")}
					icon={<Columns3 size={13} />}
				/>
			</div>
			<div className="min-w-0 flex-1" />
			{activeView === "data" && (
				<button
					type="button"
					title={t("collection_add_row")}
					aria-label={t("collection_add_row")}
					onClick={actions.addRow}
					className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs font-semibold text-text-2 transition-colors hover:bg-panel hover:text-text-1"
				>
					<Plus size={13} />
					<span>{t("collection_add_row")}</span>
				</button>
			)}
			<button
				type="button"
				title={t("collection_reset_changes")}
				aria-label={t("collection_reset_changes")}
				disabled={!dirty}
				onClick={actions.reset}
				className="flex h-7 w-7 items-center justify-center rounded-sm text-text-3 transition-colors hover:bg-panel hover:text-text-1 disabled:opacity-30"
			>
				<RotateCcw size={13} />
			</button>
			<button
				type="button"
				title={`${t("save")} — ${t("collection_draft_export_note")}`}
				aria-label={t("save")}
				disabled={!canSave}
				onClick={() => wsSend({ type: "collection_save", collection: draft })}
				className="flex h-7 items-center gap-1.5 rounded-sm bg-accent px-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-30"
			>
				<Save size={13} />
				<span>{t("save")}</span>
			</button>
		</div>
	);
}

function EditorViewButton({
	active,
	label,
	icon,
	onClick,
}: {
	active: boolean;
	label: string;
	icon: React.ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			aria-label={label}
			title={label}
			onClick={onClick}
			className={`flex h-6 items-center gap-1 rounded-[2px] px-2 text-2xs font-semibold transition-colors ${
				active
					? "bg-panel text-text-1 shadow-xs"
					: "text-text-3 hover:text-text-1"
			}`}
		>
			{icon}
			<span>{label}</span>
		</button>
	);
}

function SchemaToolbar({
	draft,
	fieldName,
	fieldError,
	setDraft,
	setFieldName,
	setFieldError,
}: {
	draft: Collection;
	fieldName: string;
	fieldError: string;
	setDraft: SetCollectionDraft;
	setFieldName: (name: string) => void;
	setFieldError: (message: string) => void;
}) {
	const t = useT();
	const [fieldType, setFieldType] = useState<FieldType>("string");
	const submitField = () =>
		addField(
			fieldName,
			fieldType,
			draft,
			{
				invalid: t("collection_field_invalid"),
				duplicate: t("collection_field_duplicate"),
			},
			setDraft,
			setFieldError,
			setFieldName,
		);
	return (
		<div className="flex items-center gap-2 border-b border-border bg-input/20 px-3 py-2">
			<input
				value={draft.description ?? ""}
				onChange={(event) => updateDescription(event.target.value, setDraft)}
				placeholder={t("collection_description_placeholder")}
				title={draft.description ?? ""}
				className="h-7 min-w-36 flex-1 rounded-sm border border-border bg-panel px-2 text-xs text-text-2 outline-none focus:ring-2 focus:ring-accent/25"
			/>
			<div className="flex items-center gap-1.5 min-w-0">
				<Columns3
					size={13}
					className="text-text-3 shrink-0"
					aria-label={t("collection_schema")}
				/>
				<input
					value={fieldName}
					onChange={(event) => {
						setFieldName(event.target.value);
						setFieldError("");
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") submitField();
					}}
					placeholder={t("collection_new_field_placeholder")}
					className="w-32 h-7 bg-panel rounded-md px-2 text-xs text-text-1 outline-none focus:ring-2 focus:ring-accent/25"
				/>
				<FieldTypeSelect value={fieldType} onChange={setFieldType} />
				<button
					type="button"
					title={t("collection_add_field")}
					aria-label={t("collection_add_field")}
					onClick={submitField}
					className="w-7 h-7 rounded-md flex items-center justify-center text-text-2 hover:bg-panel transition-colors"
				>
					<Plus size={13} />
				</button>
				{fieldError && (
					<span className="text-2xs text-danger truncate">{fieldError}</span>
				)}
			</div>
		</div>
	);
}

function FieldTypeSelect({
	value,
	onChange,
}: {
	value: FieldType;
	onChange: (type: FieldType) => void;
}) {
	const t = useT();
	const typeLabels: Record<FieldType, string> = {
		string: t("collection_type_string"),
		number: t("collection_type_number"),
		boolean: t("collection_type_boolean"),
	};
	return (
		<select
			value={value}
			title={t("collection_field_type")}
			aria-label={t("collection_field_type")}
			onChange={(event) => onChange(event.target.value as FieldType)}
			className="h-7 bg-panel rounded-md px-1.5 text-xs text-text-2 outline-none focus:ring-2 focus:ring-accent/25"
		>
			{fieldTypes.map((type) => (
				<option key={type} value={type}>
					{typeLabels[type]}
				</option>
			))}
		</select>
	);
}

type CollectionMember = Collection["members"][number];

// code-moniker: ignore[smell-long-callable]
// The grid columns, keyboard clipboard contract, and editable cell renderers
// stay together because react-data-grid exposes them as one cohesive adapter.
function CollectionGrid({
	draft,
	fields,
	members,
	savedMemberIds,
	previewMemberId,
	setDraft,
	onSelectMember,
}: {
	draft: Collection;
	fields: CollectionField[];
	members: CollectionMember[];
	savedMemberIds: ReadonlySet<string>;
	previewMemberId: string | null;
	setDraft: SetCollectionDraft;
	onSelectMember: (memberId: string) => void;
}) {
	const t = useT();
	const activeCell = useRef<{ memberId: string; fieldKey: string } | null>(
		null,
	);
	const columns = useMemo<Column<CollectionMember>[]>(
		() => [
			{
				key: "__row__",
				name: "#",
				width: 48,
				minWidth: 48,
				maxWidth: 48,
				frozen: true,
				renderCell: ({ row, rowIdx }) => (
					<button
						type="button"
						title={
							savedMemberIds.has(row.id)
								? t("collection_preview_row")
								: t("collection_row_unsaved")
						}
						onClick={() => onSelectMember(row.id)}
						className={`mx-auto flex h-5 min-w-5 items-center justify-center rounded px-1 text-2xs font-bold ${
							row.id === previewMemberId
								? "bg-accent text-white"
								: savedMemberIds.has(row.id)
									? "bg-input text-text-3"
									: "border border-dashed border-accent text-accent"
						}`}
					>
						{rowIdx + 1}
					</button>
				),
			},
			...fields.map(
				(field): Column<CollectionMember> => ({
					key: field.key,
					name: (
						<span title={`${field.key} · ${field.type}`}>
							<span className="font-mono font-semibold">{field.key}</span>{" "}
							<span className="font-normal text-text-3">
								{field.type.slice(0, 3)}
							</span>
						</span>
					),
					minWidth: 120,
					width: "minmax(140px, 1fr)",
					resizable: true,
					editable: true,
					renderCell: (props) => (
						<CollectionGridValue {...props} field={field} />
					),
					renderEditCell: (props) => (
						<CollectionGridEditor
							{...props}
							field={field}
							options={enumOptions(draft, field.key)}
						/>
					),
				}),
			),
			{
				key: "__actions__",
				name: "",
				width: 70,
				minWidth: 70,
				maxWidth: 70,
				renderCell: ({ row }) => (
					<div className="flex h-full items-center justify-center gap-1">
						<button
							type="button"
							title={t("collection_duplicate_row")}
							aria-label={t("collection_duplicate_row")}
							onClick={() => duplicateRow(row.id, setDraft)}
							className="flex h-6 w-6 items-center justify-center rounded-sm text-text-3 transition-colors hover:bg-input hover:text-text-1"
						>
							<Copy size={12} />
						</button>
						<button
							type="button"
							title={t("collection_delete_row")}
							aria-label={t("collection_delete_row")}
							onClick={() => removeRow(row.id, setDraft)}
							className="flex h-6 w-6 items-center justify-center rounded-sm text-text-3 transition-colors hover:bg-danger-soft hover:text-danger"
						>
							<Trash2 size={12} />
						</button>
					</div>
				),
			},
		],
		[
			draft,
			fields,
			onSelectMember,
			previewMemberId,
			savedMemberIds,
			setDraft,
			t,
		],
	);

	return (
		<div
			className="min-h-0 flex-1"
			onPasteCapture={(event) => {
				const target = activeCell.current;
				if (!target) return;
				const pasted = parseTabularClipboard(
					event.clipboardData.getData("text/plain"),
				);
				if (pasted.length === 0) return;
				event.preventDefault();
				event.stopPropagation();
				setDraft((current) => applyPastedTable(current, target, pasted));
			}}
		>
			<DataGrid
				aria-label={t("collection_data_grid")}
				className="maket-collection-grid h-full"
				columns={columns}
				rows={members}
				rowKeyGetter={(row) => row.id}
				rowHeight={32}
				headerRowHeight={32}
				onRowsChange={(rows) =>
					setDraft((current) => ({
						...current,
						members: rows.map((member, position) => ({
							...member,
							position,
						})),
					}))
				}
				onActivePositionChange={({ row, column }) => {
					if (!row) return;
					onSelectMember(row.id);
					if (!column || column.key.startsWith("__")) return;
					activeCell.current = { memberId: row.id, fieldKey: column.key };
				}}
				onCellCopy={({ row, column }, event) => {
					if (column.key.startsWith("__")) return;
					event.clipboardData.setData(
						"text/plain",
						String(row.data[column.key] ?? ""),
					);
					event.preventDefault();
				}}
				rowClass={(row) =>
					row.id === previewMemberId ? "maket-collection-grid-row-active" : ""
				}
				renderers={{
					noRowsFallback: (
						<div className="flex h-full items-center justify-center text-xs text-text-3">
							{t("collection_empty_rows")}
						</div>
					),
				}}
			/>
		</div>
	);
}

function CollectionGridValue({
	row,
	field,
}: RenderCellProps<CollectionMember> & { field: CollectionField }) {
	const value = row.data[field.key];
	if (field.type === "boolean") {
		return <span className="text-text-2">{value === true ? "✓" : ""}</span>;
	}
	return <span className="truncate">{String(value ?? "")}</span>;
}

function CollectionGridEditor({
	row,
	field,
	options,
	onRowChange,
	onClose,
}: RenderEditCellProps<CollectionMember> & {
	field: CollectionField;
	options: string[] | null;
}) {
	const value = row.data[field.key];
	const focusEditor = useCallback(
		(element: HTMLInputElement | HTMLSelectElement | null) => element?.focus(),
		[],
	);
	const commit = (nextValue: unknown, close = false) => {
		onRowChange(withMemberValue(row, field.key, nextValue), close);
	};
	if (options) {
		const raw = value === undefined ? "" : String(value ?? "");
		return (
			<select
				ref={focusEditor}
				value={raw}
				onChange={(event) => {
					commit(event.target.value || undefined, true);
					onClose(true);
				}}
				className="h-full w-full border-0 bg-panel px-2 text-xs text-text-1 outline-none"
			>
				{(!field.required || raw === "") && <option value="">—</option>}
				{raw !== "" && !options.includes(raw) && (
					<option value={raw}>{raw}</option>
				)}
				{options.map((option) => (
					<option key={option} value={option}>
						{option}
					</option>
				))}
			</select>
		);
	}
	if (field.type === "boolean") {
		return (
			<label className="flex h-full items-center justify-center bg-panel">
				<input
					ref={focusEditor}
					type="checkbox"
					checked={value === true}
					onChange={(event) => commit(event.target.checked)}
					onBlur={() => onClose(true)}
					className="h-4 w-4 accent-accent"
				/>
			</label>
		);
	}
	const numeric = field.type === "number" || field.type === "integer";
	return (
		<input
			ref={focusEditor}
			type={numeric ? "number" : "text"}
			step={field.type === "integer" ? 1 : "any"}
			value={String(value ?? "")}
			onChange={(event) => {
				const raw = event.target.value;
				commit(
					numeric
						? raw === ""
							? field.required
								? ""
								: undefined
							: Number(raw)
						: raw,
				);
			}}
			onBlur={() => onClose(true)}
			className="h-full w-full border-0 bg-panel px-2 text-xs text-text-1 outline-none"
		/>
	);
}

function withMemberValue(
	member: CollectionMember,
	key: string,
	value: unknown,
): CollectionMember {
	return {
		...member,
		data:
			value === undefined
				? withoutKey(member.data, key)
				: { ...member.data, [key]: value },
	};
}

function enumOptions(collection: Collection, key: string): string[] | null {
	const property = schemaProperties(collection)[key];
	if (!property || typeof property !== "object") return null;
	const values = (property as { enum?: unknown }).enum;
	if (!Array.isArray(values)) return null;
	const options = values.filter(
		(item): item is string => typeof item === "string",
	);
	return options.length > 0 ? options : null;
}

function SchemaFieldList({
	fields,
	draft,
	setDraft,
}: {
	fields: CollectionField[];
	draft: Collection;
	setDraft: SetCollectionDraft;
}) {
	const t = useT();
	return (
		<div className="min-h-0 flex-1 overflow-auto">
			<table className="w-full border-collapse text-xs">
				<thead className="sticky top-0 border-b border-border bg-panel text-left text-2xs font-semibold text-text-3">
					<tr>
						<th className="px-3 py-2">{t("collection_schema_field")}</th>
						<th className="w-40 px-3 py-2">{t("collection_field_type")}</th>
						<th className="w-28 px-3 py-2">{t("collection_required")}</th>
						<th className="w-12 px-2 py-2" />
					</tr>
				</thead>
				<tbody>
					{fields.map((field) => (
						<tr key={field.key} className="border-b border-border/70">
							<td className="px-3 py-2">
								<div className="font-mono font-semibold text-text-1">
									{field.key}
								</div>
								<div className="text-2xs text-text-3">{field.title}</div>
							</td>
							<td className="px-3 py-2 text-text-2">{field.type}</td>
							<td className="px-3 py-2">
								<input
									type="checkbox"
									checked={field.required}
									aria-label={`${t("collection_required")} ${field.key}`}
									onChange={(event) =>
										setDraft(
											withRequired(draft, field.key, event.target.checked),
										)
									}
									className="h-3.5 w-3.5 accent-accent"
								/>
							</td>
							<td className="px-2 py-2 text-right">
								<button
									type="button"
									title={`${t("collection_delete_field")} — ${field.key}`}
									aria-label={`${t("collection_delete_field")} — ${field.key}`}
									onClick={() => setDraft(removeField(draft, field.key))}
									className="inline-flex h-6 w-6 items-center justify-center rounded text-text-3 transition-colors hover:bg-input hover:text-danger"
								>
									<Trash2 size={12} />
								</button>
							</td>
						</tr>
					))}
					{fields.length === 0 && (
						<tr>
							<td colSpan={4} className="px-3 py-6 text-center text-text-3">
								{t("collection_no_fields")}
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

function ValidationIssues({
	issues,
}: {
	issues: ReturnType<typeof validateCollection>;
}) {
	const t = useT();
	return (
		<div className="flex items-start gap-1.5 px-2.5 py-1.5 border-b border-danger/30 bg-danger/10 text-danger">
			<AlertTriangle size={13} className="mt-0.5 shrink-0" />
			<div className="space-y-0.5 text-2xs">
				{issues.map((issue, index) => (
					<div key={`${issue.code}-${issue.field ?? issue.memberId ?? index}`}>
						{validationIssueText(issue, t)}
					</div>
				))}
			</div>
		</div>
	);
}

function validationIssueText(
	issue: ReturnType<typeof validateCollection>[number],
	t: ReturnType<typeof useT>,
): string {
	if (issue.code === "invalidSchema") {
		return t("collection_issue_invalid_schema", { message: issue.message });
	}
	if (issue.code === "invalidField") {
		return t("collection_issue_invalid_field", { field: issue.field ?? "" });
	}
	if (issue.code === "invalidMember") {
		return t("collection_issue_invalid_member", {
			member: issue.memberId ?? "",
		});
	}
	if (issue.code === "unknownCollectionField") {
		return t("collection_issue_unknown_field", { field: issue.field ?? "" });
	}
	return validationTemplateIssueText(issue, t);
}

function validationTemplateIssueText(
	issue: ReturnType<typeof validateCollection>[number],
	t: ReturnType<typeof useT>,
): string {
	if (issue.code === "unknownGeneratedValue") {
		return t("collection_issue_unknown_generated", {
			placeholder: issue.placeholder ?? "",
		});
	}
	if (issue.code === "malformedPlaceholder") {
		return t("collection_issue_malformed_placeholder", {
			placeholder: issue.placeholder ?? "",
		});
	}
	if (issue.code === "placeholderInAttribute") {
		return t("collection_issue_placeholder_attribute");
	}
	if (issue.code === "unsupportedCollectionField") {
		return t("collection_issue_unsupported_field", {
			field: issue.field ?? "",
		});
	}
	if (issue.code === "unsupportedTemplateFeature") {
		return t("collection_issue_unsupported_template", {
			placeholder: issue.placeholder ?? "",
		});
	}
	return issue.message;
}

function updateDescription(
	description: string,
	setDraft: SetCollectionDraft,
): void {
	setDraft((current) => ({ ...current, description }));
}

function addField(
	rawName: string,
	type: FieldType,
	draft: Collection,
	messages: FieldMessages,
	setDraft: SetCollectionDraft,
	setFieldError: (message: string) => void,
	setFieldName: (name: string) => void,
): void {
	const key = rawName.trim();
	if (!fieldKeyPattern.test(key)) {
		setFieldError(messages.invalid);
		return;
	}
	if (schemaProperties(draft)[key]) {
		setFieldError(messages.duplicate);
		return;
	}
	setDraft(withOptionalSchemaField(draft, key, type));
	setFieldName("");
	setFieldError("");
}

function addRow(
	draft: Collection,
	fields: CollectionField[],
	setDraft: SetCollectionDraft,
): void {
	const data: Record<string, unknown> = {};
	for (const field of fields) {
		const value = defaultValueFor(draft, field);
		if (value !== undefined) data[field.key] = value;
	}
	setDraft({
		...draft,
		members: [
			...draft.members,
			{
				id: nextMemberId(draft),
				position: nextMemberPosition(draft),
				data,
			},
		],
	});
}

/** Schema-valid starting value for a new row: optional fields stay absent
 * (`undefined`); required fields get a value that validates — first enum
 * option, 0, false, or "". */
function defaultValueFor(
	collection: Collection,
	field: CollectionField,
): unknown {
	if (!field.required) return undefined;
	const options = enumOptions(collection, field.key);
	if (options) return options[0] ?? "";
	if (field.type === "number" || field.type === "integer") return 0;
	if (field.type === "boolean") return false;
	return "";
}

function removeRow(memberId: string, setDraft: SetCollectionDraft): void {
	setDraft((current) => ({
		...current,
		members: current.members
			.filter((member) => member.id !== memberId)
			.map((member, position) => ({ ...member, position })),
	}));
}

function duplicateRow(memberId: string, setDraft: SetCollectionDraft): void {
	setDraft((current) => {
		const sourceIndex = current.members.findIndex(
			(member) => member.id === memberId,
		);
		if (sourceIndex < 0) return current;
		const source = current.members[sourceIndex];
		if (!source) return current;
		const members = [...current.members];
		members.splice(sourceIndex + 1, 0, {
			...source,
			id: nextMemberId(current),
			data: { ...source.data },
		});
		return {
			...current,
			members: members.map((member, position) => ({ ...member, position })),
		};
	});
}

/** Adds a schema property without requiring it on existing rows. */
function withOptionalSchemaField(
	collection: Collection,
	key: string,
	type: FieldType,
): Collection {
	return {
		...collection,
		schema: {
			...collection.schema,
			type: "object",
			properties: {
				...schemaProperties(collection),
				[key]: { type, title: fieldTitle(key) },
			},
		},
	};
}

function removeField(collection: Collection, key: string): Collection {
	const properties = { ...schemaProperties(collection) };
	delete properties[key];
	return {
		...collection,
		schema: {
			...collection.schema,
			properties,
			required: requiredFields(collection).filter((field) => field !== key),
		},
		members: collection.members.map((member) => ({
			...member,
			data: withoutKey(member.data, key),
		})),
	};
}

function withRequired(
	collection: Collection,
	key: string,
	required: boolean,
): Collection {
	const fields = new Set(requiredFields(collection));
	if (required) fields.add(key);
	else fields.delete(key);
	return {
		...collection,
		schema: {
			...collection.schema,
			required: [...fields],
		},
	};
}

function schemaProperties(collection: Collection): Record<string, unknown> {
	const properties = collection.schema.properties;
	return properties && typeof properties === "object" ? properties : {};
}

function requiredFields(collection: Collection): string[] {
	return Array.isArray(collection.schema.required)
		? collection.schema.required.filter(
				(field): field is string => typeof field === "string",
			)
		: [];
}

function withoutKey(
	data: Record<string, unknown>,
	key: string,
): Record<string, unknown> {
	const next = { ...data };
	delete next[key];
	return next;
}

function sortedMembers(collection: Collection): Collection["members"] {
	return [...collection.members].sort((a, b) => a.position - b.position);
}

function nextMemberPosition(collection: Collection): number {
	if (collection.members.length === 0) return 0;
	return Math.max(...collection.members.map((member) => member.position)) + 1;
}

function nextMemberId(collection: Collection): string {
	let index = collection.members.length + 1;
	let id = `member_${index}`;
	while (collection.members.some((member) => member.id === id)) {
		index += 1;
		id = `member_${index}`;
	}
	return id;
}

function fieldTitle(key: string): string {
	return key
		.split("_")
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(" ");
}

function hasChanged(source: Collection, draft: Collection): boolean {
	return JSON.stringify(source) !== JSON.stringify(draft);
}
