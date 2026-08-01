import { LayoutGrid, List, Upload } from "lucide-react";
import { useT } from "../../i18n/useT";
import { buildQueryChips } from "./docsQuery";
import type { DocsToolbarModel, Query, QueryChip, View } from "./types";

export interface ToolbarFactoryArgs {
	search: string;
	setSearch: (value: string) => void;
	query: Query;
	view: View;
	setView: (view: View) => void;
	importState: {
		importInputRef: React.RefObject<HTMLInputElement | null>;
		importError: string | null;
		importDrag: boolean;
		setImportError: (v: string | null) => void;
		setImportDrag: (v: boolean) => void;
		handleImportFile: (file: File) => Promise<void>;
	};
}

export function createToolbarModel(args: ToolbarFactoryArgs): DocsToolbarModel {
	const { importState } = args;
	return {
		search: args.search,
		setSearch: args.setSearch,
		chips: buildQueryChips(args.query, args.search, args.setSearch),
		importInputRef: importState.importInputRef,
		importError: importState.importError,
		importDrag: importState.importDrag,
		clearImportError: () => importState.setImportError(null),
		startImport: () => importState.importInputRef.current?.click(),
		handleImportInput: (event) => {
			const file = event.target.files?.[0];
			if (file) void importState.handleImportFile(file);
			event.target.value = "";
		},
		handleImportDragOver: (event) => {
			if (!event.dataTransfer.types.includes("Files")) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
			if (!importState.importDrag) importState.setImportDrag(true);
		},
		handleImportDragLeave: () => importState.setImportDrag(false),
		handleImportDrop: (event) => handleImportDrop(event, importState),
		view: args.view,
		setView: args.setView,
	};
}

function handleImportDrop(
	event: React.DragEvent,
	importState: ToolbarFactoryArgs["importState"],
) {
	event.preventDefault();
	importState.setImportDrag(false);
	const file = Array.from(event.dataTransfer.files).find((item) =>
		item.name.toLowerCase().endsWith(".maket"),
	);
	if (file) void importState.handleImportFile(file);
	else importState.setImportError("Import failed: .maket");
}

export function DocsToolbar({ model }: { model: DocsToolbarModel }) {
	const t = useT();
	return (
		<div className="px-1 flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5">
				<input
					value={model.search}
					onChange={(event) => model.setSearch(event.target.value)}
					placeholder={t("search_hint")}
					className="flex-1 min-w-0 px-3 py-2 bg-input rounded-lg text-base outline-none placeholder:text-text-3 focus:ring-2 focus:ring-accent/20"
				/>
				<input
					ref={model.importInputRef}
					type="file"
					accept=".maket"
					className="hidden"
					onChange={model.handleImportInput}
				/>
				<ImportButton model={model} />
				<ViewToggle view={model.view} setView={model.setView} />
			</div>
			{model.importError && (
				<button
					type="button"
					onClick={model.clearImportError}
					className="text-left text-2xs text-danger bg-danger-soft rounded-md px-2 py-1"
				>
					{model.importError} ×
				</button>
			)}
			<QueryChips chips={model.chips} />
		</div>
	);
}

function ImportButton({ model }: { model: DocsToolbarModel }) {
	const t = useT();
	return (
		<button
			type="button"
			onClick={model.startImport}
			onDragOver={model.handleImportDragOver}
			onDragLeave={model.handleImportDragLeave}
			onDrop={model.handleImportDrop}
			aria-label={t("import_maket")}
			title={t("import_maket")}
			className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${
				model.importDrag
					? "bg-accent-soft text-accent ring-2 ring-accent/40"
					: "bg-input text-text-3 hover:text-text-1"
			}`}
		>
			<Upload size={14} />
		</button>
	);
}

function ViewToggle({
	view,
	setView,
}: {
	view: View;
	setView: (view: View) => void;
}) {
	const t = useT();
	return (
		<div className="flex rounded-lg bg-input p-0.5">
			<ViewToggleButton
				active={view === "list"}
				label={t("view_list")}
				onClick={() => setView("list")}
				icon={<List size={14} />}
			/>
			<ViewToggleButton
				active={view === "grid"}
				label={t("view_grid")}
				onClick={() => setView("grid")}
				icon={<LayoutGrid size={14} />}
			/>
		</div>
	);
}

function ViewToggleButton({
	active,
	label,
	onClick,
	icon,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
	icon: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className={`w-8 h-8 rounded-md flex items-center justify-center transition ${
				active
					? "bg-panel shadow-sm text-text-1"
					: "text-text-3 hover:text-text-1"
			}`}
		>
			{icon}
		</button>
	);
}

function QueryChips({ chips }: { chips: QueryChip[] }) {
	if (chips.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1 px-1">
			{chips.map((chip) => (
				<button
					key={chip.key}
					type="button"
					onClick={chip.onRemove}
					className="group flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-2xs font-semibold hover:bg-accent/15 transition"
				>
					<span>{chip.label}</span>
					<span
						aria-hidden
						className="opacity-60 group-hover:opacity-100 leading-none"
					>
						×
					</span>
				</button>
			))}
		</div>
	);
}
