import { appendJsonPointer, type DocumentStateClientView } from "@maket/shared";
import { AlertTriangle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n/useT";
import {
	hasPendingStatePatchForDocument,
	statePatchKey,
	useFocusedDoc,
	useStore,
} from "../store/useStore";
import { sendStateValuePatch } from "../store/ws";
import { BottomDock, useBottomDockHeight } from "./BottomDock";
import { StateRenderControls } from "./StateDataControls";

const STATE_DOCK_HEIGHT_KEY = "maket-state-height";

type StateValue = null | string | number | boolean;

interface StateField {
	label: string;
	pointer: string;
	value: StateValue;
	schema: Record<string, unknown>;
}

/** Composes the persistent state model with the shared bottom-dock controls. */
// Store selectors and render controls intentionally meet at this shell boundary.
// code-moniker: ignore[smell-feature-envy-local]
export function StateWorkspace() {
	const t = useT();
	const focusedDoc = useFocusedDoc();
	const open = useStore((state) => state.stateDockOpen);
	const setOpen = useStore((state) => state.setStateDockOpen);
	const stateView = useStore((state) =>
		focusedDoc ? state.documentStates[focusedDoc.name] : undefined,
	);
	const pendingByPointer = useStore((state) => state.statePatchPending);
	const errorsByPointer = useStore((state) => state.statePatchErrors);
	const [height, setHeight] = useBottomDockHeight(
		STATE_DOCK_HEIGHT_KEY,
		Math.max(220, Math.min(360, Math.round(window.innerHeight * 0.34))),
	);
	const fields = useMemo(
		() => (stateView ? flattenStateFields(stateView) : []),
		[stateView],
	);

	if (!open || focusedDoc?.dataModel !== "state" || !stateView) return null;
	const documentPending = hasPendingStatePatchForDocument(
		pendingByPointer,
		focusedDoc.name,
	);

	return (
		<BottomDock
			data-state-dock
			height={height}
			resize={{
				height,
				setHeight,
				storageKey: STATE_DOCK_HEIGHT_KEY,
				label: t("resize_state_panel"),
			}}
			className="shrink-0"
		>
			<header className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
				<span className="truncate text-sm font-bold text-text-1">
					{t("state_data_title")}
				</span>
				<StateRenderControls />
				<span className="min-w-0 flex-1" />
				<span className="shrink-0 text-2xs text-text-3">
					{t("state_revision", { revision: stateView.revision })}
				</span>
				<button
					type="button"
					aria-label={t("close")}
					title={t("close")}
					onClick={() => setOpen(false)}
					className="flex h-7 w-7 items-center justify-center rounded-sm text-text-3 transition-colors hover:bg-input hover:text-text-1"
				>
					<X size={13} />
				</button>
			</header>
			<div className="min-h-0 flex-1 overflow-auto">
				<table className="w-full border-collapse text-xs">
					<thead className="sticky top-0 z-10 border-b border-border bg-panel text-left text-2xs font-semibold text-text-3">
						<tr>
							<th className="w-[38%] px-3 py-2">{t("state_field")}</th>
							<th className="px-3 py-2">{t("state_value")}</th>
						</tr>
					</thead>
					<tbody>
						{fields.map((field) => {
							const key = statePatchKey(focusedDoc.name, field.pointer);
							return (
								<StateFieldRow
									key={field.pointer}
									field={field}
									docName={focusedDoc.name}
									revision={stateView.revision}
									pending={Boolean(pendingByPointer[key])}
									disabled={documentPending}
									error={errorsByPointer[key]}
								/>
							);
						})}
						{fields.length === 0 && (
							<tr>
								<td colSpan={2} className="px-3 py-8 text-center text-text-3">
									{t("state_no_values")}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</BottomDock>
	);
}

function StateFieldRow({
	field,
	docName,
	revision,
	pending,
	disabled,
	error,
}: {
	field: StateField;
	docName: string;
	revision: number;
	pending: boolean;
	disabled: boolean;
	error?: string;
}) {
	return (
		<tr className="border-b border-border/70 last:border-b-0">
			<td className="px-3 py-2 align-top">
				<div className="font-mono text-xs font-semibold text-text-1">
					{field.label}
				</div>
				<div className="mt-0.5 truncate font-mono text-2xs text-text-3">
					{field.pointer}
				</div>
			</td>
			<td className="px-3 py-2">
				<div className="flex items-center gap-2">
					<StateValueInput
						field={field}
						disabled={disabled}
						onCommit={(value) =>
							sendStateValuePatch(docName, field.pointer, revision, value)
						}
					/>
					{pending && (
						<span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-r-transparent" />
					)}
					{error && (
						<span
							className="inline-flex min-w-0 items-center gap-1 text-2xs text-danger"
							title={error}
						>
							<AlertTriangle size={12} className="shrink-0" />
							<span className="truncate">{error}</span>
						</span>
					)}
				</div>
			</td>
		</tr>
	);
}

function StateValueInput({
	field,
	disabled,
	onCommit,
}: {
	field: StateField;
	disabled: boolean;
	onCommit: (value: StateValue) => void;
}) {
	const enumValues = Array.isArray(field.schema.enum)
		? field.schema.enum.filter(isStateValue)
		: [];
	if (enumValues.length > 0) {
		return (
			<select
				value={String(field.value ?? "")}
				disabled={disabled}
				onChange={(event) => {
					const value = enumValues.find(
						(candidate) => String(candidate ?? "") === event.target.value,
					);
					if (value !== undefined && value !== field.value) onCommit(value);
				}}
				className="h-8 min-w-48 rounded-sm border border-border bg-input px-2 text-xs text-text-1 outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60"
			>
				{enumValues.map((value) => (
					<option key={String(value)} value={String(value ?? "")}>
						{String(value)}
					</option>
				))}
			</select>
		);
	}
	if (typeof field.value === "boolean") {
		return (
			<input
				type="checkbox"
				checked={field.value}
				disabled={disabled}
				onChange={(event) => onCommit(event.target.checked)}
				className="h-4 w-4 accent-accent"
			/>
		);
	}
	return (
		<StateTextInput field={field} disabled={disabled} onCommit={onCommit} />
	);
}

function StateTextInput({
	field,
	disabled,
	onCommit,
}: {
	field: StateField;
	disabled: boolean;
	onCommit: (value: StateValue) => void;
}) {
	const [value, setValue] = useState(String(field.value ?? ""));
	useEffect(() => setValue(String(field.value ?? "")), [field.value]);
	const commit = () => {
		const next = typeof field.value === "number" ? Number(value) : value;
		if (typeof next === "number" && !Number.isFinite(next)) {
			setValue(String(field.value));
			return;
		}
		if (next !== field.value) onCommit(next);
	};
	return (
		<input
			type={typeof field.value === "number" ? "number" : "text"}
			value={value}
			disabled={disabled || field.value === null}
			onChange={(event) => setValue(event.target.value)}
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === "Enter") event.currentTarget.blur();
				if (event.key === "Escape") {
					setValue(String(field.value ?? ""));
					event.currentTarget.blur();
				}
			}}
			className="h-8 min-w-48 max-w-xl flex-1 rounded-sm border border-border bg-input px-2 text-xs text-text-1 outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60"
		/>
	);
}

function flattenStateFields(view: DocumentStateClientView): StateField[] {
	return flattenValue(view.data, view.schema, "", []);
}

function flattenValue(
	value: unknown,
	schema: Record<string, unknown>,
	pointer: string,
	segments: string[],
): StateField[] {
	if (isStateValue(value)) {
		return [
			{
				label: segments.join(".") || "/",
				pointer: pointer || "",
				value,
				schema,
			},
		];
	}
	if (Array.isArray(value)) {
		const itemSchema = asSchema(schema.items);
		return value.flatMap((item, index) =>
			flattenValue(item, itemSchema, appendJsonPointer(pointer, index), [
				...segments,
				String(index),
			]),
		);
	}
	if (value && typeof value === "object") {
		const properties = asSchemaMap(schema.properties);
		return Object.entries(value).flatMap(([key, child]) =>
			flattenValue(
				child,
				properties[key] ?? {},
				appendJsonPointer(pointer, key),
				[...segments, key],
			),
		);
	}
	return [];
}

function isStateValue(value: unknown): value is StateValue {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

function asSchema(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function asSchemaMap(value: unknown): Record<string, Record<string, unknown>> {
	const schema = asSchema(value);
	return Object.fromEntries(
		Object.entries(schema).map(([key, child]) => [key, asSchema(child)]),
	);
}
