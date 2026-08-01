import {
	type Collection,
	type CollectionField,
	listCollectionFields,
	validateCollection,
} from "@maket/shared";
import {
	AlertTriangle,
	Columns3,
	Pin,
	Plus,
	RotateCcw,
	Save,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useT } from "../i18n/useT";
import {
	applyPastedTable,
	parseTabularClipboard,
} from "../lib/tabular-clipboard";
import { previewCursorForPage, useStore } from "../store/useStore";
import { wsSend } from "../store/ws";

const fieldKeyPattern = /^[a-z][a-z0-9_]*$/;
type SetCollectionDraft = React.Dispatch<React.SetStateAction<Collection>>;
type StoreState = ReturnType<typeof useStore.getState>;

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
		barPosition: state.barPosition,
		pinned: state.dataViewPinned,
		setFocusedCollection: state.setFocusedCollection,
		togglePinned: state.toggleDataViewPinned,
		setCursorMember: state.setCursorMember,
		setDraftCursorOverride: state.setDraftCursorOverride,
	};
}

/** Only saved rows exist server-side — a draft-only row cannot become the
 * shared cursor until the collection is saved. */
function isSavedRow(collection: Collection, memberId: string): boolean {
	return collection.members.some((member) => member.id === memberId);
}

/** Fixed overlay like MessagesPanel: zoom-independent, anchored to the
 * toolbar-free side, internal scroll. */
export function CollectionWorkspace() {
	const {
		collection,
		collectionDraft,
		previewMemberId,
		cursorDocName,
		cursorPageIndex,
		readOnly,
		barPosition,
		pinned,
		setFocusedCollection,
		togglePinned,
		setCursorMember,
		setDraftCursorOverride,
	} = useStore(useShallow((state) => selectCollectionWorkspaceState(state)));

	if (!collection || readOnly) return null;

	const barSide = 68;
	const freeSide = 8;
	const panelStyle =
		barPosition === "top"
			? { top: barSide, maxHeight: `calc(100vh - ${barSide + freeSide}px)` }
			: { bottom: barSide, maxHeight: `calc(100vh - ${barSide + freeSide}px)` };
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
		<div
			style={panelStyle}
			className="fixed right-4 z-[var(--z-panel)] w-[min(680px,calc(100vw-2rem))] flex flex-col overflow-hidden bg-panel border border-border rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.15)]"
		>
			<CollectionEditor
				key={collection.name}
				collection={collection}
				initialDraft={collectionDraft ?? collection}
				previewMemberId={previewMemberId}
				pinned={pinned}
				onTogglePinned={togglePinned}
				onClose={() => setFocusedCollection(null)}
				onSelectMember={selectMember}
			/>
		</div>
	);
}

function CollectionEditor({
	collection,
	initialDraft,
	previewMemberId,
	pinned,
	onTogglePinned,
	onClose,
	onSelectMember,
}: {
	collection: Collection;
	initialDraft: Collection;
	previewMemberId: string | null;
	pinned: boolean;
	onTogglePinned: () => void;
	onClose: () => void;
	onSelectMember: (memberId: string) => void;
}) {
	const [draft, setDraftState] = useState(initialDraft);
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
			<CollectionEditorHeader
				model={{ draft, dirty, canSave, pinned }}
				actions={{
					togglePinned: onTogglePinned,
					close: onClose,
					setDescription: (description) =>
						updateDescription(description, setDraft),
					reset: () => {
						clearCollectionDraft(collection.name);
						setDraftState(collection);
					},
				}}
			/>
			<SchemaToolbar
				draft={draft}
				fields={fields}
				fieldName={fieldName}
				fieldError={fieldError}
				setDraft={setDraft}
				setFieldName={setFieldName}
				setFieldError={setFieldError}
			/>
			{issues.length > 0 && <ValidationIssues issues={issues} />}
			<CollectionTable
				draft={draft}
				fields={fields}
				members={members}
				savedMemberIds={savedMemberIds}
				previewMemberId={previewMemberId}
				setDraft={setDraft}
				onSelectMember={onSelectMember}
			/>
		</div>
	);
}

type CollectionEditorHeaderModel = {
	draft: Collection;
	dirty: boolean;
	canSave: boolean;
	pinned: boolean;
};

type CollectionEditorHeaderActions = {
	togglePinned: () => void;
	close: () => void;
	setDescription: (description: string) => void;
	reset: () => void;
};

function CollectionEditorHeader(props: {
	model: CollectionEditorHeaderModel;
	actions: CollectionEditorHeaderActions;
}) {
	const { model, actions } = props;
	const { draft, dirty, canSave, pinned } = model;
	const t = useT();
	return (
		<header className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border">
			<span
				className="text-sm font-bold text-text-1 truncate shrink-0 max-w-44"
				title={draft.name}
			>
				{draft.name}
			</span>
			<span className="text-2xs text-text-3 shrink-0">
				{t("collection_summary_counts", {
					fields: Object.keys(draft.schema.properties ?? {}).length,
					rows: draft.members.length,
				})}
			</span>
			<input
				value={draft.description ?? ""}
				onChange={(event) => actions.setDescription(event.target.value)}
				placeholder={t("collection_description_placeholder")}
				title={draft.description ?? ""}
				className="min-w-0 flex-1 bg-transparent text-xs text-text-3 outline-none"
			/>
			<div className="flex items-center gap-0.5 shrink-0">
				{dirty && (
					<>
						<button
							type="button"
							title={t("collection_reset_changes")}
							aria-label={t("collection_reset_changes")}
							onClick={actions.reset}
							className="w-7 h-7 rounded-md flex items-center justify-center text-text-2 hover:bg-input transition-colors"
						>
							<RotateCcw size={13} />
						</button>
						<button
							type="button"
							title={`${t("save")} — ${t("collection_draft_export_note")}`}
							aria-label={t("save")}
							disabled={!canSave}
							onClick={() =>
								wsSend({ type: "collection_save", collection: draft })
							}
							className="w-7 h-7 rounded-md flex items-center justify-center text-white bg-accent hover:opacity-90 transition-opacity disabled:opacity-35"
						>
							<Save size={13} />
						</button>
						<div className="h-4 w-px bg-border mx-0.5" />
					</>
				)}
				<button
					type="button"
					title={t("collection_pin_view")}
					aria-label={t("collection_pin_view")}
					aria-pressed={pinned}
					onClick={actions.togglePinned}
					className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
						pinned
							? "bg-accent-soft text-accent"
							: "text-text-3 hover:bg-input hover:text-text-1"
					}`}
				>
					<Pin size={13} className={pinned ? "rotate-45" : ""} />
				</button>
				<button
					type="button"
					title={t("close")}
					aria-label={t("close")}
					onClick={actions.close}
					className="w-7 h-7 rounded-md flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-input transition-colors"
				>
					<X size={13} />
				</button>
			</div>
		</header>
	);
}

function SchemaToolbar({
	draft,
	fields,
	fieldName,
	fieldError,
	setDraft,
	setFieldName,
	setFieldError,
}: {
	draft: Collection;
	fields: CollectionField[];
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
		<div className="flex items-center justify-between gap-2 px-2.5 py-1 border-b border-border bg-input/35">
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
			<button
				type="button"
				title={t("collection_add_row")}
				aria-label={t("collection_add_row")}
				onClick={() => addRow(draft, fields, setDraft)}
				className="h-7 px-2 rounded-md flex items-center gap-1 text-xs font-medium text-text-2 hover:bg-panel transition-colors"
			>
				<Plus size={13} />
				<span>{t("collection_row")}</span>
			</button>
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

function CollectionTable({
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
	members: Collection["members"];
	savedMemberIds: ReadonlySet<string>;
	previewMemberId: string | null;
	setDraft: SetCollectionDraft;
	onSelectMember: (memberId: string) => void;
}) {
	const t = useT();
	return (
		<div className="min-h-0 flex-1 overflow-auto">
			<table className="w-full text-xs border-collapse">
				<thead className="sticky top-0 bg-panel border-b border-border z-10">
					<tr>
						<th
							className="text-left font-semibold text-text-3 px-2 py-1 w-9"
							title={t("collection_row")}
						>
							#
						</th>
						{fields.map((field) => (
							<FieldHeader
								key={field.key}
								field={field}
								draft={draft}
								setDraft={setDraft}
							/>
						))}
						<th className="w-8 px-1 py-1" />
					</tr>
				</thead>
				<tbody>
					{members.length === 0 ? (
						<EmptyRows colSpan={fields.length + 2} />
					) : (
						members.map((member, index) => (
							<DataRow
								key={member.id}
								model={{
									draft,
									member,
									index,
									fields,
									selected: member.id === previewMemberId,
									unsaved: !savedMemberIds.has(member.id),
								}}
								actions={{ setDraft, selectMember: onSelectMember }}
							/>
						))
					)}
				</tbody>
			</table>
		</div>
	);
}

function EmptyRows({ colSpan }: { colSpan: number }) {
	const t = useT();
	return (
		<tr>
			<td
				colSpan={colSpan}
				className="px-3 py-4 text-center text-xs text-text-3"
			>
				{t("collection_empty_rows")}
			</td>
		</tr>
	);
}

type DataRowModel = {
	draft: Collection;
	member: Collection["members"][number];
	index: number;
	fields: CollectionField[];
	selected: boolean;
	unsaved: boolean;
};

type DataRowActions = {
	setDraft: SetCollectionDraft;
	selectMember: (memberId: string) => void;
};

function DataRow(props: { model: DataRowModel; actions: DataRowActions }) {
	const { model, actions } = props;
	const { draft, member, index, fields, selected, unsaved } = model;
	const t = useT();
	return (
		<tr
			className={`border-b border-border/60 transition-colors ${selected ? "bg-accent-soft" : ""}`}
			onClick={() => actions.selectMember(member.id)}
		>
			<td className="px-1.5 py-0.5 text-text-3 whitespace-nowrap">
				<button
					type="button"
					title={
						unsaved ? t("collection_row_unsaved") : t("collection_preview_row")
					}
					aria-label={
						unsaved ? t("collection_row_unsaved") : t("collection_preview_row")
					}
					onClick={(event) => {
						event.stopPropagation();
						actions.selectMember(member.id);
					}}
					className={`w-5 h-5 rounded inline-flex items-center justify-center text-2xs font-bold ${
						unsaved
							? "border border-dashed border-accent text-accent cursor-help"
							: selected
								? "bg-accent text-white"
								: "bg-input text-text-3 hover:text-text-1"
					}`}
				>
					{index + 1}
				</button>
			</td>
			{fields.map((field) => (
				<td key={field.key} className="px-1 py-0.5 min-w-24">
					<CellInput
						draft={draft}
						member={member}
						field={field}
						setDraft={actions.setDraft}
						onSelectMember={actions.selectMember}
					/>
				</td>
			))}
			<td className="px-1 py-0.5 text-right">
				<button
					type="button"
					title={t("collection_delete_row")}
					aria-label={t("collection_delete_row")}
					onClick={(event) => {
						event.stopPropagation();
						removeRow(member.id, actions.setDraft);
					}}
					className="w-6 h-6 rounded inline-flex items-center justify-center text-text-3 hover:text-danger hover:bg-input transition-colors"
				>
					<Trash2 size={12} />
				</button>
			</td>
		</tr>
	);
}

// Cells honour the declared schema type: enum → select, boolean → checkbox,
// number/integer → numeric input, everything else → free text. This keeps the
// draft's values type-correct so Ajv validation passes on save.
function CellInput({
	draft,
	member,
	field,
	setDraft,
	onSelectMember,
}: {
	draft: Collection;
	member: Collection["members"][number];
	field: CollectionField;
	setDraft: SetCollectionDraft;
	onSelectMember: (memberId: string) => void;
}) {
	const value = member.data[field.key];
	const options = enumOptions(draft, field.key);
	if (options) {
		const raw = value === undefined ? "" : String(value ?? "");
		return (
			<select
				value={raw}
				onChange={(event) =>
					// An optional enum left empty must be ABSENT from the data —
					// "" is not part of the enum and would fail validation.
					updateValue(
						member.id,
						field.key,
						event.target.value === "" ? undefined : event.target.value,
						setDraft,
					)
				}
				onFocus={() => onSelectMember(member.id)}
				className="w-full h-7 bg-input rounded px-1.5 text-xs text-text-1 outline-none focus:ring-2 focus:ring-accent/25"
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
			<label className="flex h-7 items-center justify-center">
				<input
					type="checkbox"
					checked={value === true}
					onChange={(event) =>
						updateValue(member.id, field.key, event.target.checked, setDraft)
					}
					onFocus={() => onSelectMember(member.id)}
					className="w-3.5 h-3.5 accent-accent"
				/>
			</label>
		);
	}
	if (field.type === "number" || field.type === "integer") {
		return (
			<input
				type="number"
				step={field.type === "integer" ? 1 : "any"}
				value={typeof value === "number" ? value : String(value ?? "")}
				onChange={(event) => {
					const raw = event.target.value;
					updateValue(
						member.id,
						field.key,
						raw === "" ? (field.required ? "" : undefined) : Number(raw),
						setDraft,
					);
				}}
				onFocus={() => onSelectMember(member.id)}
				className="w-full h-7 bg-input rounded px-1.5 text-xs text-text-1 outline-none focus:ring-2 focus:ring-accent/25"
			/>
		);
	}
	return (
		<input
			value={String(value ?? "")}
			onPaste={(event) => {
				const rows = parseTabularClipboard(
					event.clipboardData.getData("text/plain"),
				);
				if (rows.length === 0) return;
				event.preventDefault();
				setDraft((current) =>
					applyPastedTable(
						current,
						{ memberId: member.id, fieldKey: field.key },
						rows,
					),
				);
			}}
			onChange={(event) =>
				updateValue(member.id, field.key, event.target.value, setDraft)
			}
			onFocus={() => onSelectMember(member.id)}
			className="w-full h-7 bg-input rounded px-1.5 text-xs text-text-1 outline-none focus:ring-2 focus:ring-accent/25"
		/>
	);
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

function FieldHeader({
	field,
	draft,
	setDraft,
}: {
	field: CollectionField;
	draft: Collection;
	setDraft: SetCollectionDraft;
}) {
	const t = useT();
	return (
		<th
			className="text-left px-1.5 py-1 min-w-24"
			title={`${field.key} · ${field.type}${field.required ? ` · ${t("collection_required")}` : ""}`}
		>
			<div className="flex items-center gap-1">
				<span className="min-w-0 truncate font-mono text-2xs font-bold text-text-2">
					{field.key}
				</span>
				<span className="shrink-0 text-2xs font-normal text-text-3">
					{field.type.slice(0, 3)}
				</span>
				<span className="flex-1" />
				<input
					type="checkbox"
					checked={field.required}
					title={t("collection_required")}
					aria-label={t("collection_required")}
					onChange={(event) =>
						setDraft(withRequired(draft, field.key, event.target.checked))
					}
					className="w-3 h-3 accent-accent shrink-0"
				/>
				<button
					type="button"
					title={t("collection_delete_field")}
					aria-label={t("collection_delete_field")}
					onClick={() => setDraft(removeField(draft, field.key))}
					className="w-5 h-5 rounded inline-flex items-center justify-center text-text-3 hover:text-danger hover:bg-input transition-colors shrink-0"
				>
					<Trash2 size={11} />
				</button>
			</div>
		</th>
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

/** `undefined` removes the key — an optional field left empty must be
 * absent from the data, not set to an invalid empty value. */
function updateValue(
	memberId: string,
	key: string,
	value: unknown,
	setDraft: SetCollectionDraft,
): void {
	setDraft((current) => ({
		...current,
		members: current.members.map((member) => {
			if (member.id !== memberId) return member;
			if (value === undefined) {
				return { ...member, data: withoutKey(member.data, key) };
			}
			return { ...member, data: { ...member.data, [key]: value } };
		}),
	}));
}

function removeRow(memberId: string, setDraft: SetCollectionDraft): void {
	setDraft((current) => ({
		...current,
		members: current.members
			.filter((member) => member.id !== memberId)
			.map((member, position) => ({ ...member, position })),
	}));
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
