import {
	type Collection,
	type CollectionField,
	listCollectionFields,
	validateCollection,
} from "@maket/shared";
import {
	AlertTriangle,
	Columns3,
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
import { useStore } from "../store/useStore";
import { wsSend } from "../store/ws";

const fieldKeyPattern = /^[a-z][a-z0-9_]*$/;
type SetCollectionDraft = React.Dispatch<React.SetStateAction<Collection>>;
type StoreState = ReturnType<typeof useStore.getState>;

interface FieldMessages {
	invalid: string;
	duplicate: string;
}

function selectCollectionWorkspaceState(state: StoreState) {
	const focusedCollectionName = state.focusedCollectionName;
	const collection = state.collections.find(
		(item) => item.name === focusedCollectionName,
	);
	return {
		collection,
		collectionDraft: focusedCollectionName
			? (state.collectionDrafts[focusedCollectionName] ?? null)
			: null,
		previewMemberId: focusedCollectionName
			? (state.collectionPreview[focusedCollectionName]?.memberId ?? null)
			: null,
		setFocusedCollection: state.setFocusedCollection,
		setPreviewMember: state.setCollectionPreviewMember,
	};
}

function collectionSummary(collection: Collection): {
	fieldCount: number;
	rowCount: number;
} {
	return {
		fieldCount: Object.keys(collection.schema.properties ?? {}).length,
		rowCount: collection.members.length,
	};
}

function labelScaleStyle(zoomK: number): React.CSSProperties {
	return {
		transform: `scale(${1 / Math.max(zoomK, 0.1)})`,
		transformOrigin: "top center",
	};
}

export function CollectionWorkspace({ zoomK }: { zoomK: number }) {
	const {
		collection,
		collectionDraft,
		previewMemberId,
		setFocusedCollection,
		setPreviewMember,
	} = useStore(useShallow((state) => selectCollectionWorkspaceState(state)));
	const t = useT();

	if (!collection) return null;

	const displayCollection = collectionDraft ?? collection;
	const summary = collectionSummary(displayCollection);

	return (
		<div className="flex flex-col items-center shrink-0 select-none">
			<CollectionEditor
				collection={collection}
				initialDraft={collectionDraft ?? collection}
				previewMemberId={previewMemberId}
				onSelectMember={(memberId) =>
					setPreviewMember(collection.name, memberId)
				}
			/>
			<div className="doc-label relative mt-3" style={labelScaleStyle(zoomK)}>
				<div className="flex items-center gap-1.5 px-3 py-1 rounded-xl whitespace-nowrap overflow-hidden bg-accent-soft">
					<span className="text-base font-bold text-accent truncate">
						{displayCollection.name}
					</span>
					<span className="text-2xs text-text-3 shrink-0">
						{t("collection_summary_counts", {
							fields: summary.fieldCount,
							rows: summary.rowCount,
						})}
					</span>
					<button
						type="button"
						title={t("close")}
						aria-label={t("close")}
						onClick={() => setFocusedCollection(null)}
						className="w-5 h-5 rounded-md flex items-center justify-center text-text-3 p-0 border-none bg-transparent cursor-pointer shrink-0"
					>
						<X size={12} />
					</button>
				</div>
			</div>
		</div>
	);
}

function CollectionEditor({
	collection,
	initialDraft,
	previewMemberId,
	onSelectMember,
}: {
	collection: Collection;
	initialDraft: Collection;
	previewMemberId: string | null;
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
		<div className="w-[960px] max-w-[86vw] bg-panel border border-border rounded-lg shadow-xl overflow-hidden">
			<CollectionEditorHeader
				draft={draft}
				dirty={dirty}
				canSave={canSave}
				onDescription={(description) =>
					updateDescription(description, setDraft)
				}
				onReset={() => {
					clearCollectionDraft(collection.name);
					setDraftState(collection);
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
				previewMemberId={previewMemberId}
				setDraft={setDraft}
				onSelectMember={onSelectMember}
			/>
		</div>
	);
}

function CollectionEditorHeader({
	draft,
	dirty,
	canSave,
	onDescription,
	onReset,
}: {
	draft: Collection;
	dirty: boolean;
	canSave: boolean;
	onDescription: (description: string) => void;
	onReset: () => void;
}) {
	const t = useT();
	return (
		<header className="flex items-start justify-between gap-4 px-4 py-3 border-b border-border">
			<div className="min-w-0">
				<div className="flex items-center gap-2">
					<div className="text-lg font-bold text-text-1 truncate">
						{draft.name}
					</div>
					{dirty && (
						<span className="text-2xs font-semibold text-accent bg-accent-soft rounded px-1.5 py-0.5">
							{t("modified")}
						</span>
					)}
				</div>
				<input
					value={draft.description ?? ""}
					onChange={(event) => onDescription(event.target.value)}
					placeholder={t("collection_description_placeholder")}
					className="w-full bg-transparent text-sm text-text-3 outline-none"
				/>
			</div>
			<div className="flex items-center gap-2 shrink-0">
				<button
					type="button"
					title={t("collection_reset_changes")}
					aria-label={t("collection_reset_changes")}
					disabled={!dirty}
					onClick={onReset}
					className="w-9 h-9 rounded-full flex items-center justify-center text-text-2 hover:bg-input transition-colors disabled:opacity-35 disabled:hover:bg-transparent"
				>
					<RotateCcw size={16} />
				</button>
				<button
					type="button"
					title={t("save")}
					aria-label={t("save")}
					disabled={!canSave}
					onClick={() => wsSend({ type: "collection_save", collection: draft })}
					className="w-9 h-9 rounded-full flex items-center justify-center text-white bg-accent hover:opacity-90 transition-opacity disabled:opacity-35"
				>
					<Save size={16} />
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
	const fieldMessages = {
		invalid: t("collection_field_invalid"),
		duplicate: t("collection_field_duplicate"),
	};
	return (
		<div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-input/35">
			<div className="flex items-center gap-2 min-w-0">
				<Columns3 size={15} className="text-text-3 shrink-0" />
				<span className="text-xs font-semibold text-text-3 shrink-0">
					{t("collection_schema")}
				</span>
				<input
					value={fieldName}
					onChange={(event) => {
						setFieldName(event.target.value);
						setFieldError("");
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter")
							addField(
								fieldName,
								draft,
								fieldMessages,
								setDraft,
								setFieldError,
								setFieldName,
							);
					}}
					placeholder={t("collection_new_field_placeholder")}
					className="w-40 bg-panel rounded-md px-2 py-1.5 text-sm text-text-1 outline-none focus:ring-2 focus:ring-accent/25"
				/>
				<button
					type="button"
					title={t("collection_add_field")}
					aria-label={t("collection_add_field")}
					onClick={() =>
						addField(
							fieldName,
							draft,
							fieldMessages,
							setDraft,
							setFieldError,
							setFieldName,
						)
					}
					className="w-8 h-8 rounded-md flex items-center justify-center text-text-2 hover:bg-panel transition-colors"
				>
					<Plus size={15} />
				</button>
				{fieldError && (
					<span className="text-xs text-danger truncate">{fieldError}</span>
				)}
			</div>
			<button
				type="button"
				title={t("collection_add_row")}
				aria-label={t("collection_add_row")}
				onClick={() => addRow(draft, fields, setDraft)}
				className="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-sm font-medium text-text-2 hover:bg-panel transition-colors"
			>
				<Plus size={15} />
				<span>{t("collection_row")}</span>
			</button>
		</div>
	);
}

function CollectionTable({
	draft,
	fields,
	members,
	previewMemberId,
	setDraft,
	onSelectMember,
}: {
	draft: Collection;
	fields: CollectionField[];
	members: Collection["members"];
	previewMemberId: string | null;
	setDraft: SetCollectionDraft;
	onSelectMember: (memberId: string) => void;
}) {
	const t = useT();
	return (
		<div className="overflow-auto max-h-[580px]">
			<table className="w-full text-sm border-collapse">
				<thead className="sticky top-0 bg-panel border-b border-border z-10">
					<tr>
						<th className="text-left font-semibold text-text-3 px-3 py-2 w-20">
							{t("collection_row")}
						</th>
						{fields.map((field) => (
							<FieldHeader
								key={field.key}
								field={field}
								draft={draft}
								setDraft={setDraft}
							/>
						))}
						<th className="w-12 px-2 py-2" />
					</tr>
				</thead>
				<tbody>
					{members.length === 0 ? (
						<EmptyRows colSpan={fields.length + 2} />
					) : (
						members.map((member, index) => (
							<DataRow
								key={member.id}
								member={member}
								index={index}
								fields={fields}
								selected={member.id === previewMemberId}
								setDraft={setDraft}
								onSelectMember={onSelectMember}
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
				className="px-4 py-8 text-center text-sm text-text-3"
			>
				{t("collection_empty_rows")}
			</td>
		</tr>
	);
}

function DataRow({
	member,
	index,
	fields,
	selected,
	setDraft,
	onSelectMember,
}: {
	member: Collection["members"][number];
	index: number;
	fields: CollectionField[];
	selected: boolean;
	setDraft: SetCollectionDraft;
	onSelectMember: (memberId: string) => void;
}) {
	const t = useT();
	return (
		<tr
			className={`border-b border-border/60 transition-colors ${selected ? "bg-accent-soft" : ""}`}
			onClick={() => onSelectMember(member.id)}
		>
			<td className="px-3 py-2 text-text-3 whitespace-nowrap">
				<button
					type="button"
					title={t("collection_preview_row")}
					aria-label={t("collection_preview_row")}
					onClick={(event) => {
						event.stopPropagation();
						onSelectMember(member.id);
					}}
					className={`w-7 h-7 rounded-md inline-flex items-center justify-center text-xs font-bold ${
						selected
							? "bg-accent text-white"
							: "bg-input text-text-3 hover:text-text-1"
					}`}
				>
					{index + 1}
				</button>
			</td>
			{fields.map((field) => (
				<td key={field.key} className="px-2 py-1 min-w-40">
					<input
						value={String(member.data[field.key] ?? "")}
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
						className="w-full bg-input rounded-md px-2 py-1.5 text-text-1 outline-none focus:ring-2 focus:ring-accent/25"
					/>
				</td>
			))}
			<td className="px-2 py-1 text-right">
				<button
					type="button"
					title={t("collection_delete_row")}
					aria-label={t("collection_delete_row")}
					onClick={(event) => {
						event.stopPropagation();
						removeRow(member.id, setDraft);
					}}
					className="w-8 h-8 rounded-md inline-flex items-center justify-center text-text-3 hover:text-danger hover:bg-input transition-colors"
				>
					<Trash2 size={14} />
				</button>
			</td>
		</tr>
	);
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
		<th className="text-left font-semibold text-text-2 px-2 py-2 min-w-40">
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<div className="truncate">{field.title ?? field.key}</div>
					<div className="text-2xs font-normal text-text-3 truncate">
						{field.key} · {field.type}
						{field.required ? ` · ${t("collection_required")}` : ""}
					</div>
				</div>
				<div className="flex items-center gap-1 shrink-0">
					<label className="inline-flex items-center gap-1 text-2xs font-normal text-text-3">
						<input
							type="checkbox"
							checked={field.required}
							onChange={(event) =>
								setDraft(withRequired(draft, field.key, event.target.checked))
							}
							className="w-3 h-3 accent-accent"
						/>
					</label>
					<button
						type="button"
						title={t("collection_delete_field")}
						aria-label={t("collection_delete_field")}
						onClick={() => setDraft(removeField(draft, field.key))}
						className="w-7 h-7 rounded-md inline-flex items-center justify-center text-text-3 hover:text-danger hover:bg-input transition-colors"
					>
						<Trash2 size={13} />
					</button>
				</div>
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
		<div className="flex items-start gap-2 px-4 py-2 border-b border-danger/30 bg-danger/10 text-danger">
			<AlertTriangle size={15} className="mt-0.5 shrink-0" />
			<div className="space-y-1 text-xs">
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
	setDraft(withAddedField(draft, key));
	setFieldName("");
	setFieldError("");
}

function addRow(
	draft: Collection,
	fields: CollectionField[],
	setDraft: SetCollectionDraft,
): void {
	setDraft({
		...draft,
		members: [
			...draft.members,
			{
				id: nextMemberId(draft),
				position: nextMemberPosition(draft),
				data: Object.fromEntries(fields.map((field) => [field.key, ""])),
			},
		],
	});
}

function updateValue(
	memberId: string,
	key: string,
	value: string,
	setDraft: SetCollectionDraft,
): void {
	setDraft((current) => ({
		...current,
		members: current.members.map((member) =>
			member.id === memberId
				? { ...member, data: { ...member.data, [key]: value } }
				: member,
		),
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

function withAddedField(collection: Collection, key: string): Collection {
	return {
		...collection,
		schema: {
			...collection.schema,
			type: "object",
			properties: {
				...schemaProperties(collection),
				[key]: { type: "string", title: fieldTitle(key) },
			},
		},
		members: collection.members.map((member) => ({
			...member,
			data: { ...member.data, [key]: "" },
		})),
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
